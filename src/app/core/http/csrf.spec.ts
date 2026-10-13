import { CSRF_BOOTSTRAP_PATH, CSRF_CONTRACT, CSRF_SAFE_METHODS, isCsrfSafeMethod } from './csrf';

describe('the CSRF contract', () => {
  it('names the cookie and header the server contract names', () => {
    expect(CSRF_CONTRACT.cookieName).toBe('XSRF-TOKEN');
    expect(CSRF_CONTRACT.headerName).toBe('X-XSRF-TOKEN');
  });

  /**
   * Not a tautology, and the one thing a unit spec can say about the contract's shape:
   * these two values are handed to `withXsrfConfiguration` *and* used to write the
   * header, so a repository where they had drifted into two definitions would still pass
   * every behavioural test below — each half would be internally consistent and the two
   * would disagree. `scripts/ci/assert-csrf.mjs` is what enforces the single definition;
   * this pins the values that gate compares everything else against.
   */
  it('exempts exactly the RFC 9110 safe methods', () => {
    expect([...CSRF_SAFE_METHODS].sort()).toEqual(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
  });

  it('treats every mutating method as needing a token', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isCsrfSafeMethod(method)).withContext(method).toBe(false);
    }
  });

  it('exempts safe methods whatever their case', () => {
    for (const method of CSRF_SAFE_METHODS) {
      expect(isCsrfSafeMethod(method)).withContext(method).toBe(true);
      expect(isCsrfSafeMethod(method.toLowerCase())).withContext(method).toBe(true);
    }
  });

  /**
   * `HttpClient.request('post', …)` passes the caller's spelling straight through, so a
   * case-sensitive comparison would wave a real mutation past. The bug is silent in the
   * direction that matters, which is why it is asserted rather than assumed.
   */
  it('protects a lower-case mutating method', () => {
    expect(isCsrfSafeMethod('post')).toBe(false);
    expect(isCsrfSafeMethod('delete')).toBe(false);
  });

  /**
   * The refresh cookie is scoped `Path=/api/v1/auth`, and the bootstrap is reached with
   * `withCredentials: true` — so a bootstrap under `/auth` would attach a thirty-day
   * credential to a request that needs none. The path is part of the contract for that
   * reason, not for tidiness.
   */
  it('puts the bootstrap outside the credentialed auth path', () => {
    expect(CSRF_BOOTSTRAP_PATH.startsWith('/auth')).toBe(false);
    expect(CSRF_BOOTSTRAP_PATH).toBe('/csrf');
  });
});
