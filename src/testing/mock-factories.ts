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

export function createMockAuthStore(
  overrides: Partial<{
    user: User | null;
    accessToken: string | null;
    refreshToken: string | null;
    isAuthenticated: boolean;
    isAdmin: boolean;
    isLoading: boolean;
    error: string | null;
    userRole: 'user' | 'admin' | null;
  }> = {}
) {
  const defaults = {
    user: null,
    accessToken: null,
    refreshToken: null,
    isAuthenticated: false,
    isAdmin: false,
    isLoading: false,
    error: null,
    userRole: null,
    ...overrides,
  };

  return {
    user: jasmine.createSpy('user').and.returnValue(defaults.user),
    accessToken: jasmine.createSpy('accessToken').and.returnValue(defaults.accessToken),
    refreshToken: jasmine.createSpy('refreshToken').and.returnValue(defaults.refreshToken),
    isAuthenticated: jasmine.createSpy('isAuthenticated').and.returnValue(defaults.isAuthenticated),
    isAdmin: jasmine.createSpy('isAdmin').and.returnValue(defaults.isAdmin),
    currentUser: jasmine.createSpy('currentUser').and.returnValue(defaults.user),
    userRole: jasmine.createSpy('userRole').and.returnValue(defaults.userRole),
    isLoading: jasmine.createSpy('isLoading').and.returnValue(defaults.isLoading),
    error: jasmine.createSpy('error').and.returnValue(defaults.error),
    login: jasmine.createSpy('login'),
    register: jasmine.createSpy('register'),
    logout: jasmine.createSpy('logout'),
    updateTokens: jasmine.createSpy('updateTokens'),
    clearError: jasmine.createSpy('clearError'),
    loadCurrentUser: jasmine.createSpy('loadCurrentUser'),
    loadFromStorage: jasmine.createSpy('loadFromStorage'),
    hasRole: jasmine.createSpy('hasRole').and.returnValue(false),
    refreshAccessToken: jasmine.createSpy('refreshAccessToken'),
  };
}
