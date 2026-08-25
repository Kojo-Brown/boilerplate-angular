import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import type { Signal } from '@angular/core';
import { createSignalStore } from '@/app/core/store';
import { environment } from '@/environments/environment';
import { THEME_PREFERENCE_STORE } from './theme-preference';
import type { Theme } from './theme-preference';

export type { Theme } from './theme-preference';

export interface ThemeState {
  theme: Theme;
}

/**
 * The theme, held in a {@link createSignalStore} rather than a bare `signal`.
 *
 * It is the smallest piece of state in the app that is worth time-travelling: durable
 * (it outlives a reload through `localStorage`), user-visible (a jump backwards visibly
 * flips the `dark` class on `<html>`), and driven by named writes rather than a stream
 * of intermediate values. That last part is what makes the DevTools log readable —
 * `theme/toggle` and `theme/set` say what happened, where a raw `signal.set` says only
 * that something did.
 *
 * `AuthStore` deliberately stays an `@ngrx/signals` `signalStore`; see the header of
 * `signal-store.ts` for why this primitive does not try to replace it.
 *
 * Everything to do with *where* a preference lives — the storage key, `localStorage`,
 * `prefers-color-scheme` — is behind {@link THEME_PREFERENCE_STORE}. See
 * [`docs/solid.md`](../../../../docs/solid.md) for why, and for what that separation
 * bought the tests below it.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly preference = inject(THEME_PREFERENCE_STORE);
  private readonly store = createSignalStore<ThemeState>(
    { theme: this.preference.read() ?? this.preference.systemPreference() },
    { name: 'theme', historyLimit: 25 }
  );

  /** Read-only: every write goes through `toggle`/`setTheme` so it carries a label. */
  readonly theme: Signal<Theme> = this.store.select('theme');

  /** Exposed so a debug UI — or a test — can drive time travel without the extension. */
  readonly history = this.store.history;
  readonly canUndo = this.store.canUndo;
  readonly canRedo = this.store.canRedo;

  constructor() {
    effect(() => {
      const current = this.theme();
      this.document.documentElement.classList.toggle('dark', current === 'dark');
      this.preference.write(current);
    });

    // Dynamic import, not a top-level one: this keeps the devtools bridge in its own
    // lazy chunk, so a production build neither loads nor pays for it. The `production`
    // check means the chunk is never even requested there — and `connectDevtools` is
    // itself a no-op when the extension is not installed, so a developer without it
    // loads a few hundred bytes and nothing else happens.
    if (!environment.production) {
      const destroyRef = inject(DestroyRef);

      // The import can resolve after this injector is gone — routine in unit tests,
      // where TestBed tears down between specs. `DestroyRef.onDestroy` throws once the
      // ref is destroyed, so the late arrival is handled by disconnecting immediately
      // instead of registering a teardown that can never run.
      let destroyed = false;
      destroyRef.onDestroy(() => {
        destroyed = true;
      });

      void import('@/app/core/store/devtools').then(({ connectDevtools }) => {
        const disconnect = connectDevtools(this.store);
        if (destroyed) {
          disconnect();
        } else {
          destroyRef.onDestroy(disconnect);
        }
      });
    }
  }

  toggle(): void {
    this.store.update('theme/toggle', ({ theme }) => ({
      theme: theme === 'dark' ? 'light' : 'dark',
    }));
  }

  setTheme(theme: Theme): void {
    this.store.patch('theme/set', { theme });
  }

  /** Step back one recorded theme change. No-op at the start of the log. */
  undo(): void {
    this.store.undo();
  }

  /** Step forward one recorded theme change. No-op at the end of the log. */
  redo(): void {
    this.store.redo();
  }
}
