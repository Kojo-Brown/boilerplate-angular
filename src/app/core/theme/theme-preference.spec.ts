import { TestBed } from '@angular/core/testing';
import {
  browserThemePreferenceStore,
  THEME_PREFERENCE_STORE,
  THEME_STORAGE_KEY,
} from './theme-preference';

/**
 * A `Window` with only the two APIs this file touches. The double cast keeps the other
 * three hundred members of `Window` out of the stub.
 */
function stubView(options: { stored?: string | null; prefersDark?: boolean } = {}): Window {
  const storage = new Map<string, string>();
  if (options.stored != null) storage.set(THEME_STORAGE_KEY, options.stored);

  return {
    localStorage: {
      getItem: (key: string): string | null => storage.get(key) ?? null,
      setItem: (key: string, value: string): void => void storage.set(key, value),
    },
    matchMedia: (query: string): MediaQueryList =>
      ({ media: query, matches: options.prefersDark ?? false }) as MediaQueryList,
  } as unknown as Window;
}

describe('browserThemePreferenceStore', () => {
  it('reads a stored preference', () => {
    expect(browserThemePreferenceStore(stubView({ stored: 'dark' })).read()).toBe('dark');
  });

  it('reports no preference when storage is empty', () => {
    expect(browserThemePreferenceStore(stubView()).read()).toBeNull();
  });

  it('reports no preference when the stored value is not a theme', () => {
    expect(browserThemePreferenceStore(stubView({ stored: 'chartreuse' })).read()).toBeNull();
  });

  it('round-trips a written preference', () => {
    const store = browserThemePreferenceStore(stubView());
    store.write('dark');
    expect(store.read()).toBe('dark');
  });

  it('reads the system preference from prefers-color-scheme', () => {
    expect(browserThemePreferenceStore(stubView({ prefersDark: true })).systemPreference()).toBe(
      'dark'
    );
    expect(browserThemePreferenceStore(stubView({ prefersDark: false })).systemPreference()).toBe(
      'light'
    );
  });

  describe('without a window', () => {
    // The server-rendering case, and the reason this indirection exists at all: reaching
    // for `localStorage` directly here would throw while a root service was being built.
    it('reports no preference and does not throw on write', () => {
      const store = browserThemePreferenceStore(null);
      expect(store.read()).toBeNull();
      expect(() => store.write('dark')).not.toThrow();
    });

    it('falls back to light for the system preference', () => {
      expect(browserThemePreferenceStore(null).systemPreference()).toBe('light');
    });
  });

  it('falls back to light where matchMedia is missing', () => {
    const view = { localStorage: stubView().localStorage } as unknown as Window;
    expect(browserThemePreferenceStore(view).systemPreference()).toBe('light');
  });
});

describe('THEME_PREFERENCE_STORE', () => {
  it('defaults to the browser implementation, wired to the document window', () => {
    TestBed.configureTestingModule({});
    const store = TestBed.inject(THEME_PREFERENCE_STORE);

    store.write('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(store.read()).toBe('dark');
    localStorage.removeItem(THEME_STORAGE_KEY);
  });
});
