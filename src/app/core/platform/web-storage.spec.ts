import { storageOf } from './web-storage';

describe('storageOf', () => {
  it('returns the window’s storage when there is one', () => {
    expect(storageOf(window)).toBe(window.localStorage);
  });

  it('returns null for a missing window', () => {
    expect(storageOf(null)).toBeNull();
  });

  /**
   * The case a server-side render actually hits, and the one optional chaining on the
   * *window* does not cover: an object that is a `Window` as far as the type system is
   * concerned and has no storage APIs on it.
   */
  it('returns null for a window without storage', () => {
    expect(storageOf({} as Window)).toBeNull();
  });

  /** Site data blocked: reading the property throws, before any `getItem` is reached. */
  it('returns null when reading localStorage throws', () => {
    const hostile = Object.defineProperty({}, 'localStorage', {
      get(): Storage {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    }) as Window;

    expect(() => storageOf(hostile)).not.toThrow();
    expect(storageOf(hostile)).toBeNull();
  });
});
