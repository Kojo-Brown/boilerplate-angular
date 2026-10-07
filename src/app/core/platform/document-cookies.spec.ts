import { deleteCookie, readCookie } from './document-cookies';

/**
 * A stand-in for a document whose `cookie` accessor throws, which is the case the
 * `?.` in a naive `doc?.cookie` does not cover. Built as a real getter rather than a
 * spy so the throw happens on *property access*, exactly where it does in a sandboxed
 * iframe.
 */
function hostileDocument(): Document {
  return Object.defineProperty({} as Document, 'cookie', {
    get(): string {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
    set(): void {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

/** A document whose jar is a fixed string, so a parse can be tested without the browser. */
function documentWithJar(jar: string): Document {
  return { cookie: jar } as Document;
}

describe('readCookie', () => {
  it('finds a cookie by name', () => {
    expect(readCookie(documentWithJar('a=1; session_hint=1; b=2'), 'session_hint')).toBe('1');
  });

  it('finds the only cookie', () => {
    expect(readCookie(documentWithJar('session_hint=1'), 'session_hint')).toBe('1');
  });

  it('reads null when the cookie is absent', () => {
    expect(readCookie(documentWithJar('a=1; b=2'), 'session_hint')).toBeNull();
  });

  it('reads null when the jar is empty', () => {
    expect(readCookie(documentWithJar(''), 'session_hint')).toBeNull();
  });

  /**
   * `session_hint` must not be found by a jar holding `other_session_hint`, and
   * `session` must not be found by one holding `session_hint`. A substring search —
   * `jar.includes(name)` — gets both of these wrong.
   */
  it('matches the whole name, not a substring of one', () => {
    expect(readCookie(documentWithJar('other_session_hint=1'), 'session_hint')).toBeNull();
    expect(readCookie(documentWithJar('session_hint=1'), 'session')).toBeNull();
    expect(readCookie(documentWithJar('session_hintx=1'), 'session_hint')).toBeNull();
  });

  it('decodes a percent-encoded value', () => {
    expect(readCookie(documentWithJar('k=a%20b%3Bc'), 'k')).toBe('a b;c');
  });

  /** A malformed value is someone else's bug; reporting what is there beats throwing. */
  it('returns a value that is not valid percent-encoding unchanged', () => {
    expect(readCookie(documentWithJar('k=100%'), 'k')).toBe('100%');
  });

  it('accepts an empty value', () => {
    expect(readCookie(documentWithJar('a=1; k=; b=2'), 'k')).toBe('');
  });

  /** A bare flag with no `=` is not a name/value pair and must not match anything. */
  it('skips entries with no value separator', () => {
    expect(readCookie(documentWithJar('session_hint; a=1'), 'session_hint')).toBeNull();
  });

  describe('where there is no readable jar', () => {
    it('reads null without a document', () => {
      expect(readCookie(null, 'session_hint')).toBeNull();
    });

    it('reads null instead of throwing when the accessor throws', () => {
      expect(readCookie(hostileDocument(), 'session_hint')).toBeNull();
    });
  });
});

describe('deleteCookie', () => {
  it('writes an immediate expiry for the named cookie', () => {
    const doc = documentWithJar('');

    deleteCookie(doc, 'session_hint');

    expect(doc.cookie).toContain('session_hint=');
    expect(doc.cookie).toContain('Max-Age=0');
    // `Path=/` is not cosmetic: an expiry on a different path leaves the original in
    // place and reports no error. See the header of `document-cookies.ts`.
    expect(doc.cookie).toContain('Path=/');
  });

  it('does nothing without a document', () => {
    expect(() => deleteCookie(null, 'session_hint')).not.toThrow();
  });

  it('swallows a document that refuses the write', () => {
    expect(() => deleteCookie(hostileDocument(), 'session_hint')).not.toThrow();
  });

  /** Round trip against the real browser jar, not a stub. */
  it('removes a cookie this document really set', () => {
    document.cookie = 'spec_document_cookies=1; Path=/';
    expect(readCookie(document, 'spec_document_cookies')).toBe('1');

    deleteCookie(document, 'spec_document_cookies');

    expect(readCookie(document, 'spec_document_cookies')).toBeNull();
  });
});
