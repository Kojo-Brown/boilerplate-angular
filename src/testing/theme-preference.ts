import type { Theme, ThemePreferenceStore } from '@/app/core/theme';

/**
 * In-memory {@link ThemePreferenceStore} for specs, plus the two knobs a theme test
 * actually wants: what was stored before the service was created, and what the OS
 * claims to prefer.
 */
export interface FakeThemePreferenceStore extends ThemePreferenceStore {
  /** The value `write()` last recorded, or `null` if it was never called. */
  readonly stored: Theme | null;
  /** How many times `write()` has been called — the persistence side effect, counted. */
  readonly writes: number;
}

export interface FakeThemePreferenceOptions {
  /** Preference already on disk when the service is constructed. */
  stored?: Theme | null;
  /** What `prefers-color-scheme` reports. Only consulted when `stored` is `null`. */
  system?: Theme;
}

/**
 * Build a {@link ThemePreferenceStore} a spec can drive directly.
 *
 * The point is what it replaces: the theme specs used to seed `localStorage`, spy on
 * `window.matchMedia`, and reset the whole `TestBed` between assertions, because the
 * only way to change what `ThemeService` read at construction was to change the browser
 * out from under it. Provide one of these for `THEME_PREFERENCE_STORE` instead.
 */
export function createFakeThemePreferenceStore(
  options: FakeThemePreferenceOptions = {}
): FakeThemePreferenceStore {
  const system = options.system ?? 'light';
  let stored = options.stored ?? null;
  let writes = 0;

  return {
    read: () => stored,
    write(theme: Theme): void {
      stored = theme;
      writes++;
    },
    systemPreference: () => system,
    get stored(): Theme | null {
      return stored;
    },
    get writes(): number {
      return writes;
    },
  };
}
