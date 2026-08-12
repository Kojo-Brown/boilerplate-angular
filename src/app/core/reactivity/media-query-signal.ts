import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injector, signal } from '@angular/core';
import type { Signal } from '@angular/core';

export interface MediaQuerySignalOptions {
  /**
   * Injector that owns the listener. Required when `mediaQuerySignal` is called outside
   * an injection context.
   */
  injector?: Injector;
  /**
   * Value to report where `window.matchMedia` does not exist — server-side rendering,
   * or a test environment without a DOM. Defaults to `false`.
   */
  fallback?: boolean;
}

/**
 * Tracks a CSS media query as a signal, so breakpoint-dependent state can be derived
 * with `computed` instead of recomputed in a resize handler.
 *
 * ```ts
 * private readonly isDesktop = mediaQuerySignal('(min-width: 768px)');
 * readonly columns = computed(() => (this.isDesktop() ? 3 : 1));
 * ```
 *
 * Deliberately **not** an `effect`. The subscription depends on `query`, which is a
 * plain string, so an effect wrapping it would have no reactive dependencies: it would
 * run exactly once and exist only to hold an `onCleanup` callback. `DestroyRef.onDestroy`
 * says that directly. Reach for `effect` + `onCleanup` when the resource being acquired
 * has to be torn down and re-acquired as some signal changes — see `debouncedSignal`
 * and `intervalSignal` in this directory.
 *
 * The listener is removed when the owning injector is destroyed. A `MediaQueryList` is
 * held by the browser, not by the component, so without that removal the handler — and
 * every signal and component instance it closes over — stays reachable for the life of
 * the document.
 */
export function mediaQuerySignal(
  query: string,
  options: MediaQuerySignalOptions = {}
): Signal<boolean> {
  const injector = options.injector ?? inject(Injector);
  const view = injector.get(DOCUMENT).defaultView;

  if (view === null || typeof view.matchMedia !== 'function') {
    return signal(options.fallback ?? false).asReadonly();
  }

  const list = view.matchMedia(query);
  const matches = signal(list.matches);
  const onChange = (event: MediaQueryListEvent): void => matches.set(event.matches);

  list.addEventListener('change', onChange);
  injector.get(DestroyRef).onDestroy(() => list.removeEventListener('change', onChange));

  return matches.asReadonly();
}
