# Strategy arrays behind a multi-provider `InjectionToken`

`errorInterceptor` turns whatever a server sends on a failure into an `ApiError`. There
is no single answer to how that reading is done, because there is no single format: an
RFC 9457 body, a `{ message, errors }` envelope and a bare `text/plain` string are all
things a real backend returns, sometimes the same backend on different routes.

This is the shape of problem a strategy array fits — several implementations of one
operation, all of them real, chosen at runtime by the data rather than by configuration —
and Angular already has the mechanism for it: a `multi: true` `InjectionToken`, the same
one behind `HTTP_INTERCEPTORS` and `NG_VALIDATORS`.

`docs/solid.md` deliberately left this item alone. `AUTH_BYPASS_PATHS`, the open/closed
refactor in that audit, is a single-valued token holding *data* the interceptor consults;
this one holds *behaviour*, contributed by more than one party, and the difference shows
up in three places — ordering, defaults, and what "override" means.

---

## Before

`src/app/core/http/interceptors/error.interceptor.ts` decided the format in a function
body:

```ts
function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string; errors?: Record<string, string[]> } | null;
    return {
      status: err.status,
      message: body?.message ?? err.message ?? 'An unexpected error occurred',
      errors: body?.errors,
    };
  }
  return { status: 0, message: 'Network error — please check your connection' };
}
```

One format, asserted rather than checked: `err.error as { message?: … }` is a cast, so a
`text/plain` body reached `body?.message` as `undefined` and the user got Angular's
`Http failure response for /api/items: 502 Bad Gateway` while the actual reason —
`upstream timed out` — sat unread in `err.error`. An application talking to an API that
answers with problem+json had two ways to fix that, and both are modification: edit this
function, or stop using the interceptor.

## After

`src/app/core/http/errors/api-error-mappers.ts` declares the operation as an interface:

```ts
export interface ApiErrorMapper {
  readonly name: string;
  map(error: HttpErrorResponse): ApiError | null;
}

export const API_ERROR_MAPPERS = new InjectionToken<readonly ApiErrorMapper[]>('API_ERROR_MAPPERS');
```

four implementations of it (`offline`, `problem-json`, `message-envelope`,
`string-body`), and a registration helper:

```ts
export function provideApiErrorMappers(...mappers: readonly ApiErrorMapper[]): EnvironmentProviders {
  return makeEnvironmentProviders(
    mappers.map((mapper) => ({ provide: API_ERROR_MAPPERS, useValue: mapper, multi: true }))
  );
}
```

The interceptor now holds the list, not the logic:

```ts
const mappers = inject(API_ERROR_MAPPERS, { optional: true }) ?? [];
return next(req).pipe(
  catchError((err: unknown) =>
    throwError(() => (err instanceof HttpErrorResponse ? resolveApiError(err, mappers) : …))
  )
);
```

and `app.config.ts` names the set it wants:

```ts
provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS),
```

---

## Three decisions worth the words

### `map()` returns `ApiError | null`, not a `canMap` / `map` pair

The obvious alternative is a predicate and an action:

```ts
interface ApiErrorMapper {
  canMap(error: HttpErrorResponse): boolean;
  map(error: HttpErrorResponse): ApiError;
}
```

Two halves that can disagree. `canMap` returns `true` for a problem+json content type;
`map` then finds neither `detail` nor `title` and has to invent something, because its
return type promised an answer. Folding them into one nullable pass makes "I recognise
this" and "here is what it says" the same computation, and the mapper that changes its
mind halfway through simply returns `null` and lets the next one try.

The cost is that a mapper cannot be asked hypothetically — there is no way to list which
strategies *would* handle a response without running them. Nothing needs that.

### Array position, and no `priority` field

The first draft of this gave `ApiErrorMapper` a `priority: number`, on the reasoning that
a `multi: true` array is assembled per injector and a child injector's contributions are
*appended* to its parent's — so a lazy route's specialist mapper would arrive after the
generic `message-envelope` one and never be consulted.

That reasoning is wrong, and the spec written to demonstrate it is what showed it:

```ts
const child = createEnvironmentInjector([provideApiErrorMappers(specialist)], root);

expect(child.get(API_ERROR_MAPPERS).map((m) => m.name)).toEqual(['specialist']);
```

A `multi: true` token resolves in the **nearest injector that provides it**, and Angular
does not merge the ancestors' contributions in. The child does not extend the root's
array; it shadows it. `Expected 1 to be 5` is what the priority field was worth.

So the array a consumer injects always comes from a single `provideApiErrorMappers` call
in a single injector, which means the caller already controls the order by argument
position. A priority number would be a second way of saying the same thing, free to
disagree with the first. `resolveApiError` walks the array as given and takes the first
answer, and `BUILT_IN_API_ERROR_MAPPERS` has a spec asserting its order by name, because
that order is now the whole contract.

The consequence to know about is the shadowing itself: a route that calls
`provideApiErrorMappers(mine)` in its `providers` gets `mine` and *nothing else* for
requests issued from it — not a route-local addition, a route-local replacement. It has
to spread the built-ins to keep them:

```ts
provideApiErrorMappers(mine, ...BUILT_IN_API_ERROR_MAPPERS)
```

Both halves have specs, so the trap is documented in the place someone will hit it.

### The token has no `providedIn` factory

Every other token in this codebase — `THEME_PREFERENCE_STORE`, `TOAST_SCHEDULER`,
`AUTH_BYPASS_PATHS` — carries a `providedIn: 'root'` factory, so the default works with
no configuration and providing a value replaces it. That does not transfer here.

A tree-shakable factory yields the whole array as one value, while `multi: true`
contributions build it from parts; describing one token both ways means the default is
either silently discarded the moment anyone contributes, or in conflict with them.
`HTTP_INTERCEPTORS` has no default for the same reason. So the built-in set is a value
you spread rather than a default you inherit:

```ts
provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS, myLegacyGatewayMapper)  // extend
provideApiErrorMappers(problemJsonMapper, offlineMapper)                      // narrow
```

Two things follow, and both have specs. Registering the token **replaces** the list —
there is no hidden default underneath — which is the half a caller is most likely to get
wrong. And `errorInterceptor` injects `{ optional: true }`, so an application that never
calls `provideApiErrorMappers` still gets a well-formed `ApiError` from
`resolveApiError`'s fallback instead of an `NG0201` thrown in place of the real failure.

---

## Adding a strategy

```ts
export const legacyGatewayMapper: ApiErrorMapper = {
  name: 'legacy-gateway',
  map: (error) => {
    const body = error.error as { err_code?: number; err_msg?: string } | null;
    return body?.err_msg === undefined ? null : { status: error.status, message: body.err_msg };
  },
};
```

```ts
// Ahead of the built-ins: this gateway's bodies also carry a `message` key, so
// `message-envelope` would answer first and report the wrong half of the body.
provideApiErrorMappers(legacyGatewayMapper, ...BUILT_IN_API_ERROR_MAPPERS),
```

No file in `core/http` changes. Position it against what it competes with: before
`message-envelope` if the bodies it reads also carry a `message` key, after it if it is a
last resort before the fallback.

---

## What changed in behaviour

Three things, all of them the point of the change rather than side effects, and each
covered by a spec.

- **A `text/plain` or string body is now read.** `stringBodyMapper` reports
  `upstream timed out` where the old cast produced Angular's generic status line.
- **`application/problem+json` is understood.** `detail` becomes the message, falling
  back to `title`; an `errors` extension is carried through. The mapper is gated on the
  media type, not on the presence of a `title` key, because a hand-rolled envelope may
  use that word without meaning the RFC by it.
- **An `HttpErrorResponse` with status 0 now says "network error".** Previously only a
  failure that was not an `HttpErrorResponse` took that branch — but a DNS failure, a CORS
  rejection or an offline device *is* an `HttpErrorResponse`, with status 0 and a
  `ProgressEvent` where the body would be. Those users were shown
  `Http failure response for /api/items: 0 Unknown Error`.

A validation map that arrives as `{ title: 'is required' }` — a single string where the
contract says `string[]` — is normalised to `{ title: ['is required'] }` rather than
dropped, because a form binding to `errors['title']` breaks on the shape rather than on
the wording.

## What this is not

It is not dependency inversion, which Phase 7 lists separately: these strategies are
selected by the *data*, one after another, and no consumer picks one. A dependency that a
consumer swaps for another — one implementation standing in for another behind a single
token — is the abstract-class-provider item, and it stays its own change.
