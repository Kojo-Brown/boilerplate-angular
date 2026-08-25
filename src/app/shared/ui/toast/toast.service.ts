import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

export interface Toast extends Required<ToastOptions> {
  id: string;
}

/**
 * Deferred work, as a dependency rather than a global.
 *
 * `setTimeout` is not something a caller can hand a different implementation of, so a
 * spec that wanted to control the auto-dismiss clock had to replace the global one —
 * `jasmine.clock().install()` in a `beforeEach`, uninstalled in an `afterEach`, and in
 * force for every other assertion in the file whether or not it wanted a frozen clock.
 * Injecting the scheduler moves that choice to the test that cares.
 */
export interface ToastScheduler {
  /** Run `task` after `delay` milliseconds. The returned function cancels it. */
  schedule(task: () => void, delay: number): () => void;
}

export const TOAST_SCHEDULER = new InjectionToken<ToastScheduler>('TOAST_SCHEDULER', {
  providedIn: 'root',
  factory: () => ({
    schedule(task: () => void, delay: number): () => void {
      const handle = setTimeout(task, delay);
      return () => clearTimeout(handle);
    },
  }),
});

/**
 * Where a toast's id comes from.
 *
 * The previous `toast-${Date.now()}-${Math.random()...}` was unpredictable by
 * construction, so no assertion could name an id and a spec could only ever count
 * toasts. A per-injector sequence is both stable in a test and unique in a document —
 * the service is a root singleton, so there is one sequence per application.
 */
export const TOAST_ID_FACTORY = new InjectionToken<() => string>('TOAST_ID_FACTORY', {
  providedIn: 'root',
  factory: () => {
    let sequence = 0;
    return () => `toast-${++sequence}`;
  },
});

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly scheduler = inject(TOAST_SCHEDULER);
  private readonly nextId = inject(TOAST_ID_FACTORY);

  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  /**
   * Cancel handles for the toasts still waiting to auto-dismiss.
   *
   * Dismissing a toast by hand used to leave its timer running: harmless in a browser,
   * but in a test it fires into a torn-down injector, and in either case it is a timer
   * whose only remaining job is to filter an id that is already gone.
   */
  private readonly pending = new Map<string, () => void>();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const cancel of this.pending.values()) cancel();
      this.pending.clear();
    });
  }

  show(options: ToastOptions): string {
    const toast: Toast = {
      id: this.nextId(),
      message: options.message,
      type: options.type ?? 'info',
      duration: options.duration ?? 4000,
    };

    this._toasts.update((current) => [...current, toast]);

    if (toast.duration > 0) {
      this.pending.set(
        toast.id,
        this.scheduler.schedule(() => this.dismiss(toast.id), toast.duration)
      );
    }

    return toast.id;
  }

  dismiss(id: string): void {
    this.pending.get(id)?.();
    this.pending.delete(id);
    this._toasts.update((current) => current.filter((t) => t.id !== id));
  }

  success(message: string, duration?: number): string {
    return this.show({ message, type: 'success', duration });
  }

  error(message: string, duration?: number): string {
    return this.show({ message, type: 'error', duration });
  }

  warning(message: string, duration?: number): string {
    return this.show({ message, type: 'warning', duration });
  }

  info(message: string, duration?: number): string {
    return this.show({ message, type: 'info', duration });
  }
}
