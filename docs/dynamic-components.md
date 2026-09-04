# Dynamic components with typed inputs

A dashboard that renders whatever widgets are registered cannot name them in a template.
Angular's answer is `ViewContainerRef.createComponent()`, and since v20 the values a
dynamically-created component receives come from `bindings` — `inputBinding`,
`outputBinding`, `twoWayBinding` — evaluated by the framework the same way a template's
`[input]`, `(output)` and `[(model)]` are.

What the framework does not do is check any of it:

```ts
declare function inputBinding(publicName: string, value: () => unknown): Binding;
declare function outputBinding<T>(eventName: string, listener: (event: T) => unknown): Binding;
declare function twoWayBinding(publicName: string, value: WritableSignal<unknown>): Binding;
```

Three `string`s and an `unknown`. `ComponentRef.setInput(name: string, value: unknown)` and
`NgComponentOutlet`'s `inputs: Record<string, unknown>` have the same hole. Rename an input,
change its type, or mistype its name and every one of them still compiles. The failure that
follows is quiet: an input that keeps its default, an output that never fires, or — for a name
matching nothing at all — NG0303 in dev mode and silence in production.

`src/app/shared/dynamic/` closes that gap without giving up what dynamic rendering is for.

---

## The API

```ts
const descriptor = dynamicComponent(StatWidgetComponent, (bind) => [
  bind.input('label', () => 'Revenue'),
  bind.input('value', computed(() => totals[range()].revenue)),
  bind.model('collapsed', collapsed),
  bind.output('select', (id) => open(id)),
]);
```

```html
<ng-container [appDynamicOutlet]="descriptor" />
```

`bind.input`'s name is `keyof ComponentInputs<StatWidgetComponent>` and its value is that
input's type. `bind.output`'s listener receives what that output emits. `bind.model` takes a
`WritableSignal` of the model's type. Each returns a `TypedBinding<StatWidgetComponent>`,
which is branded so it cannot be handed to a different component's `createComponent` call.

For code that needs the instance back rather than a descriptor — a dialog service, a spec —
`createDynamicComponent(container, Type, bind)` does the same checking and returns a
`ComponentRef<C>` with `C` intact.

---

## What the types are read from

| Declaration                                       | Appears in          | As                        |
| ------------------------------------------------- | ------------------- | ------------------------- |
| `label = input.required<string>()`                | `ComponentInputs`   | `string`                  |
| `delta = input(0)`                                | `ComponentInputs`   | `number`                  |
| `limit = input(5, { transform: numberAttribute })` | `ComponentInputs`   | `string \| number`        |
| `collapsed = model(false)`                        | `ComponentInputs`, `ComponentModels` | `boolean` |
| `select = output<string>()`                       | `ComponentOutputs`  | `string`                  |
| `@Input() variant: ButtonVariant`                 | nowhere             | —                         |

Two rows carry the interesting decisions.

**A transformed input maps to its write type, not its read type.** `InputSignalWithTransform<T,
TransformT>` carries both, and a binding supplies `TransformT` — exactly the widening a
template gets, so `bind.input('limit', () => '10')` is accepted and the component reads `10`.

**A `model()` is an input, but not an output.** `ModelSignal<T>` extends `InputSignal<T>` *and*
`OutputRef<T>`, so a naive `OutputKeys` would list `collapsed` — under that name, while the
output Angular actually registers is `collapsedChange`. `ComponentOutputs` excludes anything
assignable to `InputSignalWithTransform` for that reason, and `bind.model` is the way to reach
a model, registering both halves through `twoWayBinding`.

The last row is the limitation. An `@Input()` field is an ordinary public property; nothing at
the type level separates it from any other member, so including decorator inputs would mean
accepting every field name as an input name. `input()` is what makes an input visible to the
type system — which is one more reason to prefer it. `ButtonComponent` still uses `@Input()`
and would have to be bound through the escape hatch below.

---

## What the compiler cannot see, and what catches it

Two mistakes get past the types, and both have the same cause: the name in the binding is the
input's **public** name, while `keyof C` gives its **class member** name.

```ts
readonly total = input(0, { alias: 'count' });
```

`bind.input('total', …)` typechecks and binds nothing — `count` is what Angular registered. An
`@Input()` field is invisible for the reason above, so no type argument constrains it either.

`dynamicComponent()` therefore reflects the component once, with Angular's public
`reflectComponentType()`, and validates each name as it is bound:

```
test-aliased has no input "total". Its inputs are: "count".
An aliased input binds under its alias, not its class member name.
```

The check runs in production too. A binding whose name matches nothing is a bug in every
environment, and one `Array.some` per binding at construction is cheaper than an input that
silently keeps its default. Reaching an aliased or decorator input deliberately means widening
the name at the call site — `bind.input('count' as 'total', …)` — which leaves the reflection
check as the thing standing behind it.

---

## Why the descriptor's reference is the rendering

`DynamicOutletDirective` destroys and recreates whenever the descriptor **reference** changes,
and leaves the component alone when it does not.

That is not a tuning choice. `createComponent` fixes bindings at creation, so new bindings can
only reach a view through a new view. The consequence runs the other way and is the point of
binding at all: an unchanged descriptor keeps its component alive while the signals inside its
bindings keep flowing in, so a widget survives a range change with its DOM state — scroll
position, focus, an open disclosure — intact. `WidgetBoardComponent` has a spec asserting the
DOM node is the same object after the range changes.

The footgun is the mirror image. A descriptor built inline in a template is a new object on
every change-detection pass, so the component is destroyed and rebuilt each time and never
holds state for longer than a frame. Build descriptors in a field initialiser or a `computed()`.
`WidgetBoardComponent` uses a field initialiser, because its descriptors depend on the
registry, which does not change.

`NgComponentOutlet` makes the other trade: it recreates only when the *type* changes and
re-applies an `inputs` record through `setInput` on every change. That keeps the instance
across an input change without a stable descriptor, at the cost of an unchecked record and a
diff on every pass. Use it when the inputs are genuinely dynamic — a CMS payload, a form
schema — and this when they are known at compile time.

---

## Where it is used

`src/app/features/dashboard/widgets/` is the worked example. `WidgetBoardComponent` injects
`DASHBOARD_WIDGETS` and renders whatever it finds; it imports no widget and knows no widget's
inputs. Each `WidgetDefinition` binds its own component:

```ts
export const revenueWidget: WidgetDefinition = {
  id: 'revenue',
  title: 'Revenue',
  render: (context) =>
    dynamicComponent(StatWidgetComponent, (bind) => [
      bind.input('label', () => 'Revenue'),
      bind.input('value', computed(() => SAMPLE_TOTALS[context.range()].revenue)),
      bind.model('collapsed', context.collapsed),
      bind.output('select', context.select),
    ]),
};
```

A registry of `Type<unknown>` could not do this: the board would have to know every widget's
inputs in order to supply them, which is the coupling the registry exists to remove. Returning
a descriptor moves the knowledge to the definition, where the compiler can still check it.

The widgets are registered on the lazy dashboard route rather than in `app.config.ts`, for the
reason `providePostsBackend` is — see `docs/dependency-inversion.md`. `shared/dynamic` has no
eager importer, so it and the widgets ship in the dashboard's chunks; the initial bundle grows
only by the Tailwind utilities the widget templates add.

---

## Known limits

- **Decorator inputs and aliases** are outside the type system, as above. The reflection check
  catches the mistake; it cannot type the value.
- **Required inputs are not enforced.** `input.required<string>()` and `input<string>()` have
  the same type, so nothing here can insist that `label` is bound. Omitting it leaves the
  signal throwing NG0950 on first read, which is Angular's own behaviour for an unbound
  required input.
- **`bindings` are fixed at creation.** There is no "rebind" — that is what the recreate-on-new-
  reference rule is a consequence of.
- **Host directives are not covered.** `createComponent` also takes `directives` with their own
  `DirectiveWithBindings` arrays; `ComponentBinder` types component members only.
- **Content projection is not covered.** `projectableNodes` takes `Node[][]`, which is a
  different problem — nodes, not values — and no caller here needs it yet.
