import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';
import { storageOf } from '@/app/core/platform/web-storage';

export type Theme = 'light' | 'dark';

/** Storage key for the user's explicit theme choice. Exported so a test can seed it. */
export const THEME_STORAGE_KEY = 'app_theme';

/**
 * Where a theme choice is remembered, and how the operating system's preference is read.
 *
 * This is the half of theming that is *mechanism* — two browser APIs and a storage key.
 * `ThemeService` owns the other half, the *policy*: what the current theme is, how it
 * changes, and what a change does to the document. Keeping them apart is what lets a
 * test drive the service without `localStorage`, and what will let a server-rendered
 * build read the preference from a cookie instead (see `SPEC.md`, Phase 8, SSR).
 */
export interface ThemePreferenceStore {
  /** The theme the user last chose explicitly, or `null` if they never have. */
  read(): Theme | null;
  /** Remember an explicit choice. */
  write(theme: Theme): void;
  /** The OS-level preference, consulted only when `read()` returns `null`. */
  systemPreference(): Theme;
}

/**
 * `localStorage` + `prefers-color-scheme`, guarded for the environments that have
 * neither.
 *
 * Under server-side rendering `DOCUMENT.defaultView` either is `null` or is a
 * server-side window without the storage APIs, and `matchMedia` is absent in some
 * non-browser DOM implementations. Reaching for the globals directly — which is what
 * this replaced — turns both cases into a `ReferenceError` thrown while the injector is
 * constructing a root service, which is about the least debuggable moment available.
 *
 * `localStorage` is resolved once through `storageOf` rather than reached for as
 * `view?.localStorage` at each call: optional chaining on `view` says nothing about
 * whether the *property* exists — `view?.localStorage.getItem(…)` on a window that has
 * no storage is a `TypeError`, not a skipped call — and in a browser, reading the
 * property itself throws when site data is blocked.
 */
export function browserThemePreferenceStore(view: Window | null): ThemePreferenceStore {
  const storage = storageOf(view);

  return {
    read(): Theme | null {
      const stored = storage?.getItem(THEME_STORAGE_KEY);
      return stored === 'light' || stored === 'dark' ? stored : null;
    },
    write(theme: Theme): void {
      storage?.setItem(THEME_STORAGE_KEY, theme);
    },
    systemPreference(): Theme {
      if (view === null || typeof view.matchMedia !== 'function') return 'light';
      return view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
  };
}

/**
 * The seam `ThemeService` depends on. Override it in a `TestBed` — or in an SSR
 * bootstrap — without touching the service.
 */
export const THEME_PREFERENCE_STORE = new InjectionToken<ThemePreferenceStore>(
  'THEME_PREFERENCE_STORE',
  {
    providedIn: 'root',
    factory: () => browserThemePreferenceStore(inject(DOCUMENT).defaultView),
  }
);
