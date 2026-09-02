# Dependency inversion with abstract-class provider tokens

`docs/solid.md` inverted three *ambient* dependencies — a clock, an id source, a
storage medium — behind `InjectionToken`s with `factory` defaults, and deliberately
left the other case alone:

> Inverting a _domain_ dependency, where two implementations are both real and a
> consumer should be able to swap one for the other, is a different exercise and has
> its own entry in Phase 7 of `SPEC.md`.

This is that exercise. The domain dependency is the posts backend.

---

## What was actually wrong

The roles were already split — `PostReader`, `PostSearcher`, `PostWriter` — and every
consumer already declared the narrow one:

```ts
// posts.resource.ts, before
const postsService: PostReader = inject(PostsService);
```

That is interface segregation, and it was worth having: the loader's contract said
"reads posts" and a spec could stand in a two-method object. But it is not dependency
inversion, and the annotation is what disguised it. An interface is erased at compile
time, so it cannot be a DI token; the token in that line is `PostsService`, a concrete
`HttpClient` wrapper. Three things followed:

1. **The source-code arrow still ran from policy to detail.** `posts.queries.ts`,
   `posts.resource.ts` and `post-typeahead.component.ts` all imported the HTTP
   implementation. So did `core/routing/post-title.resolver.ts` — `core/` reaching into
   a `features/` implementation to put a title in the tab.
2. **Nothing could be substituted without naming it.** Every double went in as
   `{ provide: PostsService, useValue: … }`, which is the implementation's token by
   another name. `PostsService` being `providedIn: 'root'` meant it was also always
   there, so the abstraction was a convention that held for as long as everyone
   remembered it.
3. **The substitute was unchecked.** Angular types `useValue`, `useClass` and
   `useExisting` as `any`. `{ provide: PostsService, useValue: {} }` compiles.

## What replaced it

The three interfaces are now **abstract classes**, which in Angular are one symbol that
is both a type and an injection token:

```ts
export abstract class PostReader {
  abstract getAll(params?: PostsListParams, abortSignal?: AbortSignal): Promise<PaginatedResponse<Post>>;
  abstract getById(id: string, abortSignal?: AbortSignal): Promise<Post>;
}
```

```ts
// posts.resource.ts, after
const posts = inject(PostReader);
```

Angular never constructs these classes — they are only ever a key — so they must be
provided, and `posts.contracts.ts` is where the consumers' import graph now stops.

Two implementations sit behind them, and both are real:

| | `HttpPostsService` | `InMemoryPostsService` |
| --- | --- | --- |
| Transport | `ApiService` → `HttpClient` | an array |
| Used by | the application | specs, and any build with no API behind it |
| Cancellation | real, through `abortableRequest` | already-aborted signals only |

Neither is `providedIn: 'root'`. A backend nobody has chosen should not be reachable,
and exactly one place chooses — the lazy dashboard route that owns the posts pages:

```ts
// features/dashboard/dashboard.routes.ts
providers: [...providePostsBackend(HttpPostsService)],
```

**Why the route and not `app.config.ts`.** The textbook composition root is the
application config, and that is where this started. But `app.config.ts` is eager: naming
`HttpPostsService` there pulls it and everything it reaches into the initial bundle for
the sake of a page most sessions never open — measured at +4.16 kB against a 565 kB
budget with 5.63 kB of headroom. The posts routes are the only consumers and are already
behind a `loadChildren`, so the provider belongs with them; route `providers` create an
environment injector for the subtree, which the resolver on `posts/:id` is inside.

The cost of scoping it is that the backend is constructed when the dashboard loads and
torn down when the user leaves, so a stateful implementation starts over on the next
visit. For `HttpPostsService` that is nothing. For a demo build running
`InMemoryPostsService`, move the same two lines to `app.config.ts` and pay the bundle.

## Three decisions worth the words

### `useExisting`, not `useClass`

The three tokens are three views of **one** backend, so they must resolve to one
instance:

```ts
export function providePostsBackend(backend: Type<PostsBackend>): Provider[] {
  return [
    backend,
    { provide: PostReader, useExisting: backend },
    { provide: PostSearcher, useExisting: backend },
    { provide: PostWriter, useExisting: backend },
  ];
}
```

`useClass` three times is three providers, and Angular constructs the class once per
provider without warning. Against a stateless HTTP wrapper that is invisible — which is
exactly what makes it dangerous, because it is invisible right up until the backend
holds state, and then it is a `create()` through `PostWriter` that `PostReader` cannot
see. `posts.providers.spec.ts` pins both halves: that the three tokens are the same
instance, and that under `useClass` the write is lost with a 404.

### A typed parameter, because the provider literals are not

`Type<PostsBackend>` is the one part of this wiring the compiler can enforce. A class
missing `remove()`, or whose `search` returns a `Promise`, fails to compile at the call
site — which `{ provide: PostReader, useClass: … }` would have accepted. Passing the
class through a typed function is what converts Angular's `any`-typed provider literals
into a checked one.

### Abstract class here, `InjectionToken` there

Both work. The rule this codebase follows:

- **Ambient capability, one real implementation** — a clock, `localStorage`, a source of
  ids. `InjectionToken` with a `factory` default: four lines, nothing to provide,
  overridable in a spec. `TOAST_SCHEDULER`, `HTTP_CLOCK`, `THEME_PREFERENCE_STORE`, and
  `IN_MEMORY_POSTS_CLOCK` in the new code.
- **Domain abstraction, several real implementations** — abstract class. One symbol
  instead of an interface plus a token to keep in sync, and `implements` is checked
  against the very thing consumers inject.

There is a second reason in the token direction here. What makes a token convenient is
the `factory` default, and this abstraction cannot have one:
`factory: () => inject(HttpPostsService)` would put the implementation back in
`posts.contracts.ts`'s import graph and undo the inversion. A token with no factory
avoids that, and is then strictly more moving parts than the class for the same
behaviour.

## The payoff, in a spec

A consumer written against `PostReader` runs against either backend. Against the
in-memory one there is no HTTP layer configured at all — no `provideHttpClientTesting`,
no `expectOne`, no hand-written response body — and what is exercised is the real read
path:

```ts
TestBed.configureTestingModule({
  providers: [
    provideRouter([]),
    ...providePostsBackend(InMemoryPostsService),
    { provide: IN_MEMORY_POSTS_SEED, useValue: SEED },
  ],
});

const fixture = TestBed.createComponent(PostDetailComponent);
fixture.componentRef.setInput('id', 'p1');
// … renders "First post"
```

That only means something if the substitute keeps the original's contract, so
`InMemoryPostsService` implements the parts a caller can observe for real: pagination
arithmetic, case-insensitive search over title and body, `AbortSignal` honoured on both
reads, mutations a later read sees, and — the one most easily got wrong — a miss that
rejects with the same `ApiError`-shaped `{ status: 404, message }` that
`errorInterceptor` normalises a real 404 into. Rejecting with a bare `Error` would let a
spec pass against error handling the HTTP path would break.

## What it does not do

- **No latency.** Everything settles on the microtask queue, so a spec that wants to
  observe a pending state has to control timing itself.
- **`search()` cannot demonstrate cancellation.** Its Observable emits and completes on
  subscription, so `switchMap` has nothing left to unsubscribe from. The typeahead's
  debounce and switching are still exercised; aborting an in-flight request is only
  observable against `HttpPostsService`.
- **It is not wired into any build.** `dashboard.routes.ts` names `HttpPostsService`, so
  `InMemoryPostsService` is tree-shaken out of the production bundle. Swapping it in for
  a demo or an offline Playwright run is the one-word change the design exists to make
  cheap, but it has not been made.
- **The remaining `providedIn: 'root'` services are untouched.** This inverts the one
  dependency that has two real implementations. Doing it to `ThemeService` or
  `DialogService` would be ceremony: there is no second implementation, and no consumer
  wanting one.
