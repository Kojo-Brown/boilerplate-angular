import type { User } from '@/app/store/auth/auth.models';
import type { Post } from '@/app/features/posts/posts.models';

let _idCounter = 0;
function nextId(): string {
  return String(++_idCounter);
}

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: nextId(),
    email: 'test@example.com',
    name: 'Test User',
    role: 'user',
    ...overrides,
  };
}

export function createMockPost(overrides: Partial<Post> = {}): Post {
  const id = nextId();
  return {
    id,
    title: `Post ${id}`,
    body: `Body of post ${id}`,
    authorId: nextId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Everything a spec may pin on the auth double.
 *
 * Only `user`, the tokens and the flags are inputs; `isAuthenticated`, `isAdmin` and
 * `userRole` are *derived* from them by default, exactly as the real store derives them,
 * and can still be overridden for the rare spec that wants an otherwise impossible
 * combination. Deriving is the point — see the note on {@link createMockAuthStore}.
 */
export interface MockAuthStoreOverrides {
  user?: User | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  isLoading?: boolean;
  isRestoringSession?: boolean;
  error?: string | null;
  isAuthenticated?: boolean;
  isAdmin?: boolean;
  userRole?: User['role'] | null;
}

/**
 * A stand-in for `AuthStore`.
 *
 * Two things it has to get right, and both were wrong before:
 *
 * 1. **It must expose everything the real store does.** `{ provide: AuthStore, useValue }`
 *    is typed `any` by Angular, so a member the double forgets is not a compile error —
 *    it is a `TypeError` in whichever spec first renders a component that reads it. The
 *    double had drifted: `isRestoringSession` and `restoreSession` were added to the
 *    store and never here, and `authGuard` calls both. `mock-factories.spec.ts` compares
 *    the two surfaces so the next omission fails a test instead of a page.
 * 2. **It must not describe a state the real store cannot reach.** The old double took
 *    `isAuthenticated`, `isAdmin` and `userRole` as free-standing inputs, so
 *    `{ isAdmin: true }` produced a store that was an admin with no user, and `hasRole`
 *    answered `false` for the very role it claimed. A substitute that violates the
 *    original's invariants makes a green spec mean nothing.
 */
export function createMockAuthStore(overrides: MockAuthStoreOverrides = {}) {
  const user = overrides.user ?? null;
  const accessToken = overrides.accessToken ?? null;
  const refreshToken = overrides.refreshToken ?? null;
  const userRole = overrides.userRole ?? user?.role ?? null;
  const isAuthenticated = overrides.isAuthenticated ?? (accessToken !== null && user !== null);
  const isAdmin = overrides.isAdmin ?? userRole === 'admin';

  return {
    // State signals.
    user: jasmine.createSpy('user').and.returnValue(user),
    accessToken: jasmine.createSpy('accessToken').and.returnValue(accessToken),
    refreshToken: jasmine.createSpy('refreshToken').and.returnValue(refreshToken),
    isLoading: jasmine.createSpy('isLoading').and.returnValue(overrides.isLoading ?? false),
    error: jasmine.createSpy('error').and.returnValue(overrides.error ?? null),
    isRestoringSession: jasmine
      .createSpy('isRestoringSession')
      .and.returnValue(overrides.isRestoringSession ?? false),

    // Computed signals, derived exactly as the store derives them.
    isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(isAuthenticated),
    isAdmin: jasmine.createSpy('isAdmin').and.returnValue(isAdmin),
    currentUser: jasmine.createSpy('currentUser').and.returnValue(user),
    userRole: jasmine.createSpy('userRole').and.returnValue(userRole),

    // Methods.
    login: jasmine.createSpy('login'),
    register: jasmine.createSpy('register'),
    logout: jasmine.createSpy('logout'),
    updateTokens: jasmine.createSpy('updateTokens'),
    clearError: jasmine.createSpy('clearError'),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser'),
    loadFromStorage: jasmine.createSpy('loadFromStorage'),
    refreshAccessToken: jasmine.createSpy('refreshAccessToken'),
    restoreSession: jasmine.createSpy('restoreSession'),
    hasRole: jasmine
      .createSpy('hasRole')
      .and.callFake((role: User['role']): boolean => role === userRole),
  };
}

export type MockAuthStore = ReturnType<typeof createMockAuthStore>;
