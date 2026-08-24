import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable } from '@angular/core';
import type { Signal } from '@angular/core';
import { createSignalStore } from '@/app/core/store';
import { environment } from '@/environments/environment';

export type Theme = 'light' | 'dark';

export interface ThemeState {
  theme: Theme;
}

const THEME_KEY = 'app_theme';

function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly store = createSignalStore<ThemeState>(
    { theme: resolveInitialTheme() },
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
      const html = this.document.documentElement;
      html.classList.toggle('dark', current === 'dark');
      localStorage.setItem(THEME_KEY, current);
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
