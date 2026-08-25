import { TestBed } from '@angular/core/testing';
import type { ToastScheduler } from './toast.service';
import { TOAST_ID_FACTORY, TOAST_SCHEDULER, ToastService } from './toast.service';

interface ManualScheduler extends ToastScheduler {
  /** Fire every task whose delay is `<= elapsed`, oldest first. */
  advance(elapsed: number): void;
  /** Tasks scheduled and not yet fired or cancelled. */
  readonly pending: number;
}

/**
 * A clock the spec turns by hand, in place of `jasmine.clock()`.
 *
 * Local to this file on purpose: it is a `ToastScheduler`, not a general-purpose fake
 * timer, and the moment it grows into one it belongs in `src/testing` instead.
 */
function createManualScheduler(): ManualScheduler {
  let now = 0;
  const tasks = new Map<number, { at: number; run: () => void }>();
  let nextHandle = 0;

  return {
    schedule(run: () => void, delay: number): () => void {
      const handle = nextHandle++;
      tasks.set(handle, { at: now + delay, run });
      return () => void tasks.delete(handle);
    },
    advance(elapsed: number): void {
      now += elapsed;
      for (const [handle, task] of [...tasks].sort(([, a], [, b]) => a.at - b.at)) {
        if (task.at <= now) {
          tasks.delete(handle);
          task.run();
        }
      }
    },
    get pending(): number {
      return tasks.size;
    },
  };
}

describe('ToastService', () => {
  let service: ToastService;
  let scheduler: ManualScheduler;

  beforeEach(() => {
    scheduler = createManualScheduler();
    TestBed.configureTestingModule({
      providers: [{ provide: TOAST_SCHEDULER, useValue: scheduler }],
    });
    service = TestBed.inject(ToastService);
  });

  it('is created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with empty toasts', () => {
    expect(service.toasts()).toEqual([]);
  });

  it('adds a toast on show()', () => {
    service.show({ message: 'Hello', type: 'success' });
    expect(service.toasts().length).toBe(1);
    expect(service.toasts()[0].message).toBe('Hello');
    expect(service.toasts()[0].type).toBe('success');
  });

  it('defaults type to info', () => {
    service.show({ message: 'Test' });
    expect(service.toasts()[0].type).toBe('info');
  });

  it('defaults duration to four seconds', () => {
    service.show({ message: 'Test' });
    scheduler.advance(3999);
    expect(service.toasts().length).toBe(1);
    scheduler.advance(1);
    expect(service.toasts().length).toBe(0);
  });

  it('removes toast after duration', () => {
    service.show({ message: 'Bye', duration: 1000 });
    expect(service.toasts().length).toBe(1);
    scheduler.advance(1001);
    expect(service.toasts().length).toBe(0);
  });

  it('dismiss() removes toast by id', () => {
    const id = service.show({ message: 'To remove' });
    service.dismiss(id);
    expect(service.toasts().length).toBe(0);
  });

  it('cancels the auto-dismiss timer when a toast is dismissed by hand', () => {
    const id = service.show({ message: 'Early exit', duration: 1000 });
    expect(scheduler.pending).toBe(1);

    service.dismiss(id);

    expect(scheduler.pending).toBe(0);
  });

  it('hands out ids a spec can name', () => {
    expect(service.show({ message: 'First' })).toBe('toast-1');
    expect(service.show({ message: 'Second' })).toBe('toast-2');
    expect(service.toasts().map((t) => t.id)).toEqual(['toast-1', 'toast-2']);
  });

  it('dismisses only the toast it was asked to', () => {
    const first = service.show({ message: 'First', duration: 1000 });
    service.show({ message: 'Second', duration: 1000 });

    service.dismiss(first);

    expect(service.toasts().map((t) => t.message)).toEqual(['Second']);
  });

  it('success() creates success toast', () => {
    service.success('Saved!');
    expect(service.toasts()[0].type).toBe('success');
  });

  it('error() creates error toast', () => {
    service.error('Failed!');
    expect(service.toasts()[0].type).toBe('error');
  });

  it('warning() creates warning toast', () => {
    service.warning('Watch out!');
    expect(service.toasts()[0].type).toBe('warning');
  });

  it('info() creates info toast', () => {
    service.info('FYI');
    expect(service.toasts()[0].type).toBe('info');
  });

  it('passes an explicit duration through the convenience methods', () => {
    service.success('Saved!', 500);
    scheduler.advance(500);
    expect(service.toasts()).toEqual([]);
  });

  it('can have multiple toasts simultaneously', () => {
    service.show({ message: 'First' });
    service.show({ message: 'Second' });
    expect(service.toasts().length).toBe(2);
  });

  it('does not auto-dismiss when duration is 0', () => {
    service.show({ message: 'Persistent', duration: 0 });
    scheduler.advance(100000);
    expect(service.toasts().length).toBe(1);
    expect(scheduler.pending).toBe(0);
  });

  it('cancels outstanding timers when the injector is destroyed', () => {
    service.show({ message: 'Still waiting', duration: 1000 });
    expect(scheduler.pending).toBe(1);

    TestBed.resetTestingModule();

    expect(scheduler.pending).toBe(0);
  });
});

describe('TOAST_SCHEDULER default', () => {
  it('defers a task and cancels it on request', (done) => {
    TestBed.configureTestingModule({});
    const scheduler = TestBed.inject(TOAST_SCHEDULER);

    let cancelledRan = false;
    const cancel = scheduler.schedule(() => {
      cancelledRan = true;
    }, 0);
    cancel();

    scheduler.schedule(() => {
      expect(cancelledRan).toBeFalse();
      done();
    }, 1);
  });
});

describe('TOAST_ID_FACTORY default', () => {
  it('issues a fresh sequence per injector', () => {
    TestBed.configureTestingModule({});
    const first = TestBed.inject(TOAST_ID_FACTORY);
    expect([first(), first()]).toEqual(['toast-1', 'toast-2']);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    expect(TestBed.inject(TOAST_ID_FACTORY)()).toBe('toast-1');
  });
});
