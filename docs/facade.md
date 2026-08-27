# The auth facade: one door between view code and the store

`AuthStore` is an `@ngrx/signals` store and stays one. `AuthFacade`
(`src/app/core/auth/auth.facade.ts`) is the only part of it that `features/` and
`shared/` can see: eight members, no tokens, no RxJS, no `patchState`.

The pattern is cheap to describe and easy to fake, so it is worth being exact about what
this one buys — and about the two things people expect from a facade that it deliberately
does not do.

## What moved

| Component | Was | Now |
| --- | --- | --- |
| `LoginComponent` | `authStore.login()`, `.error()`, `.isLoading()`, `.isAuthenticated()` | `auth.signIn()`, `.errorMessage()`, `.isBusy()`, `.isSignedIn()` |
| `RegisterComponent` | `authStore.register()`, same three reads | `auth.signUp()`, same three reads |
| `DashboardShellComponent` | `authStore.logout()` | `auth.signOut()`, `auth.currentUser()` |

Nothing else changed hands. `authGuard`, `roleGuard`, `jwtInterceptor` and
`app.config.ts` still inject `AuthStore` directly, and should — see
[Who is exempt](#who-is-exempt).

## What a component could reach before, and can't now

`AuthStore` publishes twenty members. A component holding it could reach all of them.
Three groups are worth naming, because each is a real mistake that now fails to compile:

**The tokens.** `accessToken` and `refreshToken` are signals on the store. A component
holding it can interpolate a bearer token into a template, log it, or hand it to a
third-party widget, and nothing in the type system objects. `updateTokens` is the same
hazard pointing the other way: a view that can rotate a session can corrupt one.

**The session lifecycle.** `loadFromStorage`, `restoreSession`, `refreshAccessToken` and
`loadCurrentUser` are bootstrap and transport concerns, wired once in `app.config.ts` and
in `jwtInterceptor`, in a specific order and for stated reasons — `restoreSession` in
particular *cannot* be called from the store's own `onInit` without `NG0200`. A component
calling one of them mid-render has no legitimate case behind it.

**RxJS, through a method that does not look like it.** `store.login` is an `rxMethod`:

```ts
store.login(credentials);                    // a value
store.login(credentialsSignal);              // a signal
store.login(credentials$);                   // an observable
const sub = store.login(credentials);        // …and it hands back a subscription
```

So a template could pass an observable of credentials, and a component could hold — and
forget to release — the subscription. The facade's signature is
`signIn(credentials: LoginCredentials): void`. One value in, nothing out.

A spec pins the narrowing rather than trusting the class to stay narrow:

```ts
it('does not expose tokens or the session lifecycle', () => {
  const leaked = ['accessToken', 'refreshToken', 'updateTokens', 'refreshAccessToken',
                  'restoreSession', 'loadFromStorage', 'loadCurrentUser']
    .filter((member) => member in surface);

  expect(leaked).toEqual([]);
});
```

## What it does *not* do

**It does not wrap the signals.** `currentUser` is the store's own `computed`, passed
straight through:

```ts
readonly currentUser: Signal<User | null> = this.store.currentUser;
```

A `Signal` is already read-only, so copying it into a second one would add a reactive
node, something to keep alive, and a frame of lag, to re-express what the type already
says. The facade is a narrower door onto the same graph, not a second graph.
`auth.facade.spec.ts` asserts the identity (`facade.currentUser() === store.currentUser()`)
so that a well-meant `computed(() => …)` wrapper has to argue with a test.

**It does not make the components framework-agnostic in general** — they are Angular
components, they inject, and they read `Signal`s. What leaves them is the *state
library*: swapping `@ngrx/signals` for something else is a change to `auth.facade.ts` and
the store, and to nothing under `features/`. That is the whole claim, and it is worth
stating in that shape rather than the larger one, because the larger one would be false.

## Who is exempt

`core/` is. `authGuard` waits on `isRestoringSession`, `roleGuard` reads `userRole`,
`jwtInterceptor` reads `accessToken` and calls `updateTokens`, `app.config.ts` calls
`restoreSession`. These are the session's plumbing; asking them to go through a
view-shaped facade would mean widening it until it was the store again, at which point
there is no seam left to be exempt from.

So the boundary is a layer rule, not a "never touch the store" rule:

| Layer | May inject | Why |
| --- | --- | --- |
| `features/`, `shared/` | `AuthFacade` | View code; needs four reads and four commands |
| `core/` | `AuthStore` | Guards, interceptors and bootstrap own the session lifecycle |
| `src/testing/` | both | It builds the doubles for both |

`eslint.config.mjs` enforces the first row, because a convention lasts exactly until the
next `inject(AuthStore)` — which compiles, works, and quietly removes the seam:

```
error  '@/app/store/auth/auth.store' import is restricted from being used by a pattern.
       Components go through AuthFacade (@/app/core/auth)…  no-restricted-imports
```

It is the base `no-restricted-imports` rather than the typescript-eslint version on
purpose: that one adds `allowTypeImports`, and a `User` type pulled from
`@/app/store/**` is exactly what this is meant to stop. `@/app/core/auth` re-exports
`User`, `LoginCredentials` and `RegisterCredentials`, so a component never needs it.

## What it bought the specs

Before, each component spec hand-rolled its own store double with the four or five
members that component happened to read:

```ts
const mockAuthStore = {
  isAuthenticated: signal(false),
  isLoading: signal(false),
  error: signal<string | null>(null),
  login: jasmine.createSpy('login'),
  clearError: jasmine.createSpy('clearError'),
};
```

`{ provide: AuthStore, useValue: … }` is typed `any`, so nothing checked that against the
real store — the LSP finding in [`docs/solid.md`](./solid.md) is the same problem, caught
after a double had already drifted. Now:

```ts
let auth: FakeAuthFacade;   // interface FakeAuthFacade extends AuthFacadeApi
auth = createFakeAuthFacade({ user: createMockUser({ name: 'Ada Lovelace' }) });
```

`FakeAuthFacade extends AuthFacadeApi`, so a member added to the facade is a **compile**
error in `src/testing/auth-facade.ts` until it is added there — the check
`createMockAuthStore` can only make at runtime. Its reads are real `signal`s rather than
spies returning constants, because a spec that flips `isSignedIn` after the first render
needs the change to reach the view, and a `jasmine.Spy` is not a reactive node — under
zoneless nothing would refresh.

Two things the type system still cannot check, so `auth-facade.spec.ts` checks them:

- **The facade publishes nothing beyond its interface.** `implements AuthFacadeApi`
  proves the class has *at least* the interface, never at most; a public member added to
  the class and left off the interface would be invisible to every consumer that depends
  on the narrow shape.
- **The default double is a state the real facade can reach.** `createFakeAuthFacade({ user })`
  is signed in, because a session with nobody in it is not a thing the facade can report.
  A spec can still write the two apart on purpose — doing that deliberately is different
  from getting it wrong in setup.

## When to add to it

When a template needs a read, add it — to the interface, the class and the fake, which is
three lines and a compile error until all three exist. `isAdmin`, `userRole` and
`hasRole` are on the store and not on the facade for exactly this reason: every role
decision in this app is made by `roleGuard` before a component is constructed, so today
no template needs one. A member no caller has is a member no caller can misuse.
