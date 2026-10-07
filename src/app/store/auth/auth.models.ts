export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  avatarUrl?: string;
}

export interface AuthState {
  user: User | null;
  /**
   * The bearer token, held in memory for as long as this tab lives and written nowhere
   * else. A reload loses it on purpose; `AuthStore.restoreSession` trades the refresh
   * cookie for a new one. See `docs/token-storage.md`.
   */
  accessToken: string | null;
  isLoading: boolean;
  error: string | null;
  /**
   * A refresh cookie appears to exist and the session behind it has not settled yet.
   * Until it does, `isAuthenticated` being `false` means "not known", not "not signed
   * in" — see `authGuard`.
   */
  isRestoringSession: boolean;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  name: string;
  /**
   * Workspace invite code, when one was supplied. Omitted rather than sent empty: the
   * register endpoint distinguishes "no invite" from "this invite", and `''` is neither.
   */
  inviteCode?: string;
}

/**
 * What `POST /auth/refresh` returns.
 *
 * One token, not a pair. The refresh token is rotated too, but it is rotated *in the
 * browser's cookie jar* by a `Set-Cookie` header on this response — so it is never part
 * of a body this application parses, and there is no field here for it. That absence is
 * the hardening: a shape with nowhere to put a refresh token is a shape no handler can
 * accidentally persist one from. See `docs/token-storage.md`.
 */
export interface AccessTokenResponse {
  accessToken: string;
}

export interface AuthResponse extends AccessTokenResponse {
  user: User;
}
