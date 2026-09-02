# SOLID audit of the injectable layer

An audit of every service, store, interceptor and test double in `src/`, one principle at
a time, with the refactor each finding produced. Nothing here is illustrative: every
"before" is code that was on `main`, every "after" is in the tree, and each one is pinned
by a test that would have been awkward or impossible to write against the "before".

The rule used throughout: **a principle earns a refactor when breaking it has already
cost something** — a test that has to reset the world, a member that silently went
missing, a class a consumer cannot substitute. Where a violation is real but has cost
nothing yet, it is recorded at the bottom rather than fixed.

| Principle | Where it bit | The refactor |
| --- | --- | --- |
| Single responsibility | `ThemeService` decided the theme, where it was stored, and how the OS was asked | `ThemePreferenceStore` behind `THEME_PREFERENCE_STORE` |
| Open/closed | `jwtInterceptor` held its unauthenticated endpoints in a module constant | `AUTH_BYPASS_PATHS` injection token |
| Liskov substitution | `createMockAuthStore` was missing two members of the store it stands in for, and could describe states the store cannot reach | Derived invariants + a conformance spec |
| Interface segregation | Seven call sites depended on all six methods of `PostsService` to use one or two | `PostReader` / `PostSearcher` / `PostWriter` roles |
| Dependency inversion | `ToastService` depended on `setTimeout`, `Date.now` and `Math.random` | `TOAST_SCHEDULER` and `TOAST_ID_FACTORY` tokens |

The suite went from 402 specs to 431 across these five changes, and no production
behaviour changed except where a section below says it did.

---

## S — Single responsibility

`ThemeService` had three reasons to change: a new theme, a new place to remember the
choice, and a new way to ask the operating system what it prefers.

**Before** — `src/app/core/theme/theme.service.ts`:

```ts
const THEME_KEY = 'app_theme';

function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly store = createSignalStore<ThemeState>(
    { theme: resolveInitialTheme() },
    { name: 'theme', historyLimit: 25 }
  );

  constructor() {
    effect(() => {
      const current = this.theme();
      const html = this.document.documentElement;
      html.classList.toggle('dark', current === 'dark');
      localStorage.setItem(THEME_KEY, current);
    });
  }
}
```

Two costs, one already paid and one waiting:

- **Paid.** `resolveInitialTheme()` runs during field initialisation, so the only way to
  change what the service read at construction was to change the browser out from under
  it. The spec did exactly that — seed `localStorage`, `spyOn(window, 'matchMedia')`,
  then `TestBed.resetTestingModule()` and inject a *second* service to observe the
  result, all inside a single `it`.
- **Waiting.** Both globals are absent under server-side rendering (Phase 8 of `SPEC.md`),
  where this would throw while the root injector was still constructing.

**After** — the mechanism moves to `src/app/core/theme/theme-preference.ts`:

```ts
export interface ThemePreferenceStore {
  read(): Theme | null;
  write(theme: Theme): void;
  systemPreference(): Theme;
}

export const THEME_PREFERENCE_STORE = new InjectionToken<ThemePreferenceStore>(
  'THEME_PREFERENCE_STORE',
  { providedIn: 'root', factory: () => browserThemePreferenceStore(inject(DOCUMENT).defaultView) }
);
```

and the service keeps only the policy:

```ts
private readonly preference = inject(THEME_PREFERENCE_STORE);
private readonly store = createSignalStore<ThemeState>(
  { theme: this.preference.read() ?? this.preference.systemPreference() },
  { name: 'theme', historyLimit: 25 }
);
```

`browserThemePreferenceStore` takes a `Window | null` rather than reaching for the
globals, which is what makes the SSR case a `null` check instead of a `ReferenceError`,
and what lets `theme-preference.spec.ts` test the storage logic against a two-property
stub with no `spyOn` anywhere.

**What it bought.** Setup for a theme spec is now one line, and every assertion about the
initial read happens in the spec that cares:

```ts
function setup(options: FakeThemePreferenceOptions = {}): void {
  preference = createFakeThemePreferenceStore(options);
  TestBed.configureTestingModule({
    providers: [{ provide: THEME_PREFERENCE_STORE, useValue: preference }],
  });
  service = TestBed.inject(ThemeService);
  ...
}

it('falls back to the system preference when nothing is stored', () => {
  setup({ stored: null, system: 'dark' });
  expect(service.theme()).toBe('dark');
});
```

`createFakeThemePreferenceStore` is in `src/testing/theme-preference.ts` and is exported
from `@/testing`.

### What was deliberately left in

Applying the `dark` class to `<html>` is still `ThemeService`'s job. It is arguably a
fourth responsibility, but it is the one that has to re-run on every state change — the
`effect` is what makes an `undo()` visible on the page — and pushing it behind another
seam would buy a test nothing it cannot already assert through `DOCUMENT`.

---

## O — Open/closed

`jwtInterceptor` decided which endpoints are unauthenticated with a module-level
constant.

**Before** — `src/app/core/http/interceptors/jwt.interceptor.ts`:

```ts
const AUTH_BYPASS_PATHS = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];

function isAuthBypassPath(url: string): boolean {
  return AUTH_BYPASS_PATHS.some((path) => url.includes(path));
}
```

That list is a property of the API an application talks to, not of the interceptor. An
app with a `/auth/magic-link` endpoint — the exact case a boilerplate should expect —
had two options, both modification: edit this file, or fork the interceptor.

**After**, the same default, reachable from an application's `providers`:

```ts
export const AUTH_BYPASS_PATHS = new InjectionToken<readonly string[]>('AUTH_BYPASS_PATHS', {
  providedIn: 'root',
  factory: () => ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'],
});

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const bypassPaths = inject(AUTH_BYPASS_PATHS);
  if (bypassPaths.some((path) => req.url.includes(path))) return next(req);
  ...
};
```

**What it bought.** `jwt.interceptor.spec.ts` now proves the extension point works, and
that providing a list *replaces* the defaults rather than merging with them — which is
the part a caller will get wrong if nobody writes it down:

```ts
{ provide: AUTH_BYPASS_PATHS, useValue: ['/auth/magic-link'] },
```

A single-valued token, not a `multi: true` array of strategies: the Phase 7 entry for
multi-provider strategy arrays is its own spec item, and this is the smaller seam that
the finding actually justified.

---

## L — Liskov substitution

`createMockAuthStore` is registered as `{ provide: AuthStore, useValue: … }`.
`ValueProvider.useValue` is typed `any`, so nothing checks that the substitute can stand
in for `AuthStore` — and it could not.

**Before** — `src/testing/mock-factories.ts`, abridged:

```ts
const defaults = {
  user: null,
  isAuthenticated: false,
  isAdmin: false,
  userRole: null,
  ...overrides,
};

return {
  user: jasmine.createSpy('user').and.returnValue(defaults.user),
  isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(defaults.isAuthenticated),
  isAdmin: jasmine.createSpy('isAdmin').and.returnValue(defaults.isAdmin),
  userRole: jasmine.createSpy('userRole').and.returnValue(defaults.userRole),
  hasRole: jasmine.createSpy('hasRole').and.returnValue(false),
  // …
};
```

Two distinct failures of substitutability:

1. **Missing members.** `AuthStore` grew `isRestoringSession` and `restoreSession` when
   session restore landed; the double never did. `authGuard` calls both. Any spec that
   adopted `provideTestDeps()` for a guarded route would have failed with
   `authStore.isRestoringSession is not a function` — a `TypeError` from the test
   infrastructure, in a spec about something else entirely.
2. **Impossible states.** `isAuthenticated`, `isAdmin` and `userRole` were free-standing
   inputs. `createMockAuthStore({ isAdmin: true })` produced an admin with no user, and
   `hasRole('admin')` answered `false` for the role the same object claimed. The real
   store derives all three from `user` and cannot contradict itself; a double that can is
   a subtype in shape only, and a spec that passes against it means nothing.

**After**, the derived values are derived, and an override is still available for the
spec that genuinely wants one:

```ts
const userRole = overrides.userRole ?? user?.role ?? null;
const isAuthenticated = overrides.isAuthenticated ?? (accessToken !== null && user !== null);
const isAdmin = overrides.isAdmin ?? userRole === 'admin';
// …
hasRole: jasmine.createSpy('hasRole').and.callFake((role: User['role']) => role === userRole),
```

**What it bought.** The check TypeScript refuses to do, done at runtime in
`src/testing/mock-factories.spec.ts`:

```ts
it('exposes every member of the real store', () => {
  const real = TestBed.inject(AuthStore) as unknown as Record<string, unknown>;
  const double = createMockAuthStore() as unknown as Record<string, unknown>;

  expect(Object.keys(real).filter((key) => !(key in double))).toEqual([]);
});
```

The next member added to `AuthStore` and forgotten here fails this spec, by name, instead
of surfacing as a `TypeError` in whichever component spec reads it first.

---

## I — Interface segregation

`PostsService` has six public methods across three unrelated jobs — paged reads,
search, and writes. Every consumer depended on all six.

**Before** — seven call sites, all of this shape:

```ts
const postsService = inject(PostsService);   // posts.resource.ts, needs getById
const postsService = inject(PostsService);   // posts.queries.ts, needs getAll / create / remove / …
private readonly postsService = inject(PostsService);  // post-typeahead.component.ts, needs search
```

The type each of them held was the class, so the typeahead's contract with the rest of
the app included `remove()`, and a spec that wanted to stand in a fake search had to
satisfy six methods to exercise one.

**After** — `src/app/features/posts/posts.contracts.ts` declares the three roles,
`PostsService implements` all of them, and each consumer names the one it uses:

```ts
export interface PostSearcher {
  search(query: string, limit?: number): Observable<Post[]>;
}

// post-typeahead.component.ts
private readonly postsService: PostSearcher = inject(PostsService);
```

It is still one class behind one injection token. Splitting it into three services would
move the coupling into `app.config.ts` and buy nothing; what changes is the *type* each
caller holds, which is where the coupling was actually doing damage.

> **Superseded by the D section's follow-up.** The roles are unchanged in shape but are
> now abstract classes rather than interfaces, so the *token* is the role too:
> `inject(PostSearcher)`, not `inject(PostsService)` with a `PostSearcher` annotation.
> The class is `HttpPostsService`. See
> [`docs/dependency-inversion.md`](./dependency-inversion.md); the snippets below are
> kept as the audit recorded them.

`implements` on the class matters as much as the annotations on the consumers: without
it, a signature change to `PostReader` would leave the interface and the class quietly
disagreeing until some third file failed to compile.

**What it bought.** The typeahead's dependency is now small enough to state as a literal,
and the claim is a test rather than a comment:

```ts
it('needs nothing from PostsService beyond PostSearcher', fakeAsync(() => {
  const searcher: PostSearcher = {
    search: (query) => of([createMockPost({ id: '1', title: `Result for ${query}` })]),
  };
  TestBed.configureTestingModule({
    imports: [PostTypeaheadComponent],
    providers: [provideRouter([]), { provide: PostsService, useValue: searcher }],
  });
  // …
}));
```

If the component ever reaches for a second method, that spec stops compiling.

---

## D — Dependency inversion

`ToastService` depended on three ambient globals, none of which a caller can substitute.

**Before** — `src/app/shared/ui/toast/toast.service.ts`:

```ts
show(options: ToastOptions): string {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  // …
  if (toast.duration > 0) {
    setTimeout(() => this.dismiss(id), toast.duration);
  }
  return id;
}
```

The id was unpredictable by construction, so no assertion could name one and the spec
could only ever count toasts. The timer was global, so controlling it meant replacing the
global clock — `jasmine.clock().install()` in a `beforeEach`, in force for every
assertion in the file whether it wanted a frozen clock or not.

**After**, both are dependencies:

```ts
export interface ToastScheduler {
  /** Run `task` after `delay` milliseconds. The returned function cancels it. */
  schedule(task: () => void, delay: number): () => void;
}

export const TOAST_SCHEDULER = new InjectionToken<ToastScheduler>('TOAST_SCHEDULER', {
  providedIn: 'root',
  factory: () => ({
    schedule(task, delay) {
      const handle = setTimeout(task, delay);
      return () => clearTimeout(handle);
    },
  }),
});
```

with `TOAST_ID_FACTORY` handing out `toast-1`, `toast-2`, … from a per-injector
sequence — unique within a document, because the service is a root singleton, and stable
within a spec.

**One behaviour did change.** Making the scheduler return a cancel function made it
obvious that dismissing a toast by hand left its timer running. `dismiss()` now cancels
it, and the service cancels everything outstanding on `DestroyRef.onDestroy`. In a
browser the old behaviour was a harmless no-op filtering an id that was already gone; in
a test it was a callback firing into a torn-down injector.

**What it bought.** A clock the spec turns by hand, no global patched, and assertions
that can finally name an id:

```ts
it('cancels the auto-dismiss timer when a toast is dismissed by hand', () => {
  const id = service.show({ message: 'Early exit', duration: 1000 });
  expect(scheduler.pending).toBe(1);

  service.dismiss(id);

  expect(scheduler.pending).toBe(0);
});

it('hands out ids a spec can name', () => {
  expect(service.show({ message: 'First' })).toBe('toast-1');
});
```

The manual scheduler lives in the spec file rather than in `src/testing`: it is a
`ToastScheduler`, not a general-purpose fake timer, and the day it becomes one is the day
it moves.

### Why these are `InjectionToken`s and not abstract classes

Both seams here stand in front of *ambient browser capabilities* — a clock, a source of
ids, a storage medium — where there is one real implementation and the alternatives exist
for tests and for SSR. A token with a `factory` default expresses that in four lines and
costs nothing at the call site.

Inverting a *domain* dependency, where two implementations are both real and a consumer
should be able to swap one for the other, is a different exercise and has its own entry in
Phase 7 of `SPEC.md` (`abstract-class provider tokens, swapped in tests`). This audit
deliberately does not pre-empt it.

That exercise has since been done to the posts backend, and the rule this section states
is the one it follows: `PostReader`/`PostSearcher`/`PostWriter` are abstract classes
because two backends behind them are real, while the in-memory backend's own clock is an
`InjectionToken` with a `factory` default, for exactly the reasons above. See
[`docs/dependency-inversion.md`](./dependency-inversion.md).

---

## Findings recorded but not fixed

Three violations are real and are not addressed here, each for a stated reason.

**`jwtInterceptor` keeps its refresh state at module scope.** `isRefreshing` and
`refreshTokenSubject` are module-level mutable state, so they are shared by every
injector in the process: two specs in one file can see each other's half-finished
refresh, and a server-rendered request would share them across users. The fix is to move
the coordination into an injectable — which is a behaviour change to the refresh flow,
not a refactor, and wants its own change with its own tests.

**`AuthStore` persists tokens itself.** Six call sites in the store write
`localStorage.setItem(ACCESS_TOKEN_KEY, …)` inline. That is a single-responsibility
violation and a duplication, and extracting a `TokenStorage` seam is the obvious repair —
but Phase 10's `token storage hardening` item replaces the mechanism outright with an
in-memory access token and an httpOnly refresh cookie. Extracting a seam now, to delete
it two items later, is churn.

**`AuthService` bypasses `ApiService`.** It injects `HttpClient` directly and rebuilds
`${environment.apiUrl}/auth` for itself, so base-URL handling exists in two places. It is
a small duplication with no test cost today; it is written down so the next person to
touch either file has the choice in front of them.
