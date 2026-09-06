# Structural directives and template type guards

`src/app/shared/directives/` is this application's directive library. It holds two
structural directives and the two adapters one of them needs:

| Export                                  | What it is                                                           |
| --------------------------------------- | -------------------------------------------------------------------- |
| `AsyncDirective` (`*appAsync`)           | Renders the loaded branch of an asynchronous read, with a typed value |
| `RepeatDirective` (`*appRepeat`)         | Renders a template a fixed number of times                            |
| `resourceSnapshot` / `querySnapshot`     | A `resource()` or a TanStack query as an `AsyncSnapshot<T>`           |

Angular 17 moved `*ngIf` and `*ngFor` into the language as `@if` and `@for`, which is why
this library is small and why neither directive here re-implements one of them. A
structural directive still earns its place when it owns a *decision* a template would
otherwise have to repeat — which branch of an async read to render, in `*appAsync` — or when
the built-in control flow has no spelling for what you want, as `@for` has none for
"n times", in `*appRepeat`.

## What a template type guard is for

Under `strictTemplates`, Angular type-checks the `let-` variables of a structural
directive's template against a context type. It gets that type from a static method on the
directive:

```ts
static ngTemplateContextGuard<T>(
  _directive: AsyncDirective<T>,
  _context: unknown,
): _context is AsyncLoadedContext<T> {
  return true;
}
```

It is a compile-time assertion wearing the clothes of a runtime one. The body never runs —
Angular calls the *signature* from generated type-check code and never the function — and it
could not check anything if it did, because the directive chose the template from the
snapshot before a context existed.

The reason to write one is what happens without it. A directive with no context guard does
not get its `let-` variables typed as `unknown`, which would at least fail loudly; they are
typed `any`. Removing the four lines above and building this repo with `{{ data.titel }}` in
`PostDetailComponent` — a typo for `title` — was measured while writing this document:

```
$ pnpm build            # with the guard
✘ [ERROR] TS2551: Property 'titel' does not exist on type 'Post'. Did you mean 'title'?

$ pnpm build            # guard deleted
Application bundle generation complete. [5.4 seconds]
```

The second build ships a page that renders nothing where the title should be. That is the
whole argument for the method: a structural directive without a guard silently switches off
template type-checking inside its own template, for every caller, forever.

### The other guard, and why it is not here

`ngTemplateGuard_<input>` is the second form. Where the context guard types what the
template receives, this one narrows the *bound expression* — it is how `*ngIf="user"` makes
`user` a `User` rather than `User | null` inside the template.

Neither directive here declares one, because there is nothing to narrow. `*appAsync` binds a
`Signal<AsyncSnapshot<T>>`; the branch that survives is a property of the snapshot the
directive read, not of the expression the caller wrote, and the value the template wants
arrives through the context instead. The case that form was invented for — narrowing an
expression a template already holds — is `@if (user; as u)`, which does it natively.

### The limit: templates passed as inputs

`*appAsync` takes `loading:` and `error:` templates, and both are `TemplateRef<void>`.

That is not laziness about the error. Angular derives an `<ng-template>`'s context type from
the directives applied to *that* template, and a bare `<ng-template #failed>` handed to
another directive as an input has none — its `let-` variables are `any` no matter what
`TemplateRef<C>` the receiving input declares. Publishing the error through that channel
would hand back exactly the untyped value the context guard exists to remove, so the
directive does not publish it. A view that needs the message already holds the snapshot
signal, where the union still discriminates:

```ts
readonly message = computed(() => {
  const snapshot = this.post();
  return snapshot.kind === 'error' ? describe(snapshot.error) : null;
});
```

## `*appAsync`

```html
<ng-template #skeleton>…</ng-template>
<ng-template #failed>Could not load this post.</ng-template>

<article *appAsync="post; let data; loading: skeleton; error: failed">
  {{ data.title }}
</article>
```

`post` is a `Signal<AsyncSnapshot<Post>>`, built in the component:

```ts
readonly post = resourceSnapshot(injectPostResource(this.id));
```

### What the snapshot is worth

`AsyncSnapshot<T>` is a three-armed discriminated union — `loading`, `error`, `value` —
and the two adapters are where the ordering hazards of each library are handled once.

For `resource()`, `value()` **throws** in the error state. `PostDetailComponent` used to
carry a comment saying so, above a template whose branch order was the only thing keeping it
true. `resourceSnapshot` reads `status()` first and returns before anything touches the
value, and `resourceSnapshot`'s spec asserts that by *getting to* its expectation: a version
that read the value first fails on the line before.

For TanStack Query, a failed refetch keeps the previous `data()`. `querySnapshot` reads
`status()` first for the same reason — a view that asked "is there data?" first would go on
showing a stale row under a failure nobody mentioned.

`QueryLike<T>` is declared structurally, with three members, so nothing under `shared/`
imports the query library: a UI primitive that names one server-state library is a primitive
the other one cannot use, and this repo deliberately ships both (see
[`signals.md`](./signals.md)). It asks for `status` rather than the `isError` beside it
because TanStack types `isPending`/`isError`/`isSuccess` as narrowing predicates whose `this`
is the concrete query result — a shape only that library can produce — while `status` is an
ordinary `Signal`.

### The loaded view is not recreated on a new value

A new value updates the existing view in place; only a change of *branch* destroys it.
Recreating it on every value would reset the DOM state the user owns — scroll position,
focus, a half-typed input — on a refetch that changed one field.

The mechanism is worth naming because it is easy to leave half-finished: the view holds the
directive's context object, so writing `$implicit` is the update. What the view then lacks is
a reason to re-read it, since context properties are not signals and nothing notified the
scheduler. `EmbeddedViewRef.markForCheck()` is that reason, and deleting it turns
`async.directive.spec.ts`'s "updates it in place" red — checked, not assumed.

## `*appRepeat`

```html
<div class="h-4 animate-pulse rounded bg-gray-200" *appRepeat="6"></div>
```

`@for` needs something to iterate, so repeating markup a fixed number of times means
`Array.from({ length: 6 })`, and since a template cannot call it, that array becomes a
component field — view scaffolding parked in the class, named after what it is made of
rather than what it is for. Both components that draw a loading skeleton here carried one.

Its context has exactly one member, the index, so `let i` reads the way `@for`'s `$index`
does. There is no `$count`, and that absence is what keeps the directive honest: `$count` can
only change when views are added or removed, so writing it into the surviving contexts would
need a `markForCheck` no spec could make fail. A one-member context is fixed at creation, and
the directive is add-and-remove with nothing to update.

A negative, fractional or `NaN` count renders nothing rather than throwing. The values that
produce one arrive from arithmetic on a signal, and a frame of zero rows is a smaller failure
than a view that stops rendering.

## Adding a directive here

- **Give it a caller in the same change.** Both of these replaced code that existed. A
  directive with no call site is a decision table nothing follows.
- **Write the context guard.** Not writing one is not "leaving it out" — it turns template
  type-checking off inside the directive's own template.
- **Keep the context minimal.** Every member is one more thing to keep in step with the
  views, and the ones that can change after creation need a `markForCheck` you should be
  able to make a spec fail without.
- **Prefer `@if` / `@for`.** They are checked by the compiler with no ceremony at all. Reach
  for a directive when you are encapsulating a decision, not a shape.
