import { DOCUMENT } from '@angular/common';
import { effect, inject, Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'app_theme';

function resolveInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  readonly theme = signal<Theme>(resolveInitialTheme());

  constructor() {
    effect(() => {
      const current = this.theme();
      const html = this.document.documentElement;
      html.classList.toggle('dark', current === 'dark');
      localStorage.setItem(THEME_KEY, current);
    });
  }

  toggle(): void {
    this.theme.update((t: Theme) => (t === 'dark' ? 'light' : 'dark'));
  }

  setTheme(theme: Theme): void {
    this.theme.set(theme);
  }
}
