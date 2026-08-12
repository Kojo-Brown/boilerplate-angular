import { Component, effect, Injector, signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { debouncedSignal } from './debounced-signal';

const DELAY = 300;

@Component({
  standalone: true,
  template: `{{ debouncedTerm() }}`,
})
class HostComponent {
  readonly term = signal('a');
  readonly debouncedTerm = debouncedSignal(this.term, DELAY);
  /** Every value the debounced signal has settled on, in order. */
  readonly settled: string[] = [];

  constructor() {
    effect(() => this.settled.push(this.debouncedTerm()));
  }
}

describe('debouncedSignal', () => {
  function createHost() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('exposes the source value immediately, without waiting for the delay', () => {
    const fixture = createHost();
    expect(fixture.componentInstance.debouncedTerm()).toBe('a');
  });

  it('adopts a change that lands before the first flush without debouncing it', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.term.set('b');
    fixture.detectChanges();
    expect(fixture.componentInstance.debouncedTerm()).toBe('b');
  });

  it('holds the previous value until the delay has elapsed', fakeAsync(() => {
    const fixture = createHost();
    fixture.componentInstance.term.set('b');
    fixture.detectChanges();

    tick(DELAY - 1);
    expect(fixture.componentInstance.debouncedTerm()).toBe('a');

    tick(1);
    expect(fixture.componentInstance.debouncedTerm()).toBe('b');
  }));

  it('collapses rapid changes into a single update', fakeAsync(() => {
    const fixture = createHost();
    const host = fixture.componentInstance;

    for (const term of ['b', 'c', 'd']) {
      host.term.set(term);
      fixture.detectChanges();
      tick(DELAY - 100);
    }
    tick(DELAY);
    fixture.detectChanges();

    expect(host.debouncedTerm()).toBe('d');
    expect(host.settled).toEqual(['a', 'd']);
  }));

  it('re-arms the timer from the most recent change, not the first', fakeAsync(() => {
    const fixture = createHost();
    fixture.componentInstance.term.set('b');
    fixture.detectChanges();
    tick(DELAY - 50);

    fixture.componentInstance.term.set('c');
    fixture.detectChanges();
    tick(DELAY - 50);
    expect(fixture.componentInstance.debouncedTerm()).toBe('a');

    tick(50);
    expect(fixture.componentInstance.debouncedTerm()).toBe('c');
  }));

  it('clears a pending timer when the owning component is destroyed', fakeAsync(() => {
    const fixture = createHost();
    fixture.componentInstance.term.set('b');
    fixture.detectChanges();

    fixture.destroy();
    // A leaked timer either fires here — flipping the value — or is still queued when
    // `fakeAsync` checks the timer queue at the end of the spec, which fails the test.
    tick(DELAY);

    expect(fixture.componentInstance.debouncedTerm()).toBe('a');
  }));

  it('accepts an explicit injector when called outside an injection context', fakeAsync(() => {
    TestBed.configureTestingModule({});
    const source = signal(1);
    const debounced = debouncedSignal(source, DELAY, { injector: TestBed.inject(Injector) });

    TestBed.tick();
    source.set(2);
    TestBed.tick();

    expect(debounced()).toBe(1);
    tick(DELAY);
    expect(debounced()).toBe(2);
  }));

  it('honours a custom equality function', fakeAsync(() => {
    TestBed.configureTestingModule({});
    const source = signal({ id: 1, label: 'first' });
    const debounced = debouncedSignal(source, DELAY, {
      injector: TestBed.inject(Injector),
      equal: (a, b) => a.id === b.id,
    });
    const seen: string[] = [];
    TestBed.runInInjectionContext(() => effect(() => seen.push(debounced().label)));
    TestBed.tick();

    source.set({ id: 1, label: 'renamed' });
    TestBed.tick();
    tick(DELAY);
    TestBed.tick();
    expect(seen).toEqual(['first']);

    source.set({ id: 2, label: 'second' });
    TestBed.tick();
    tick(DELAY);
    TestBed.tick();
    expect(seen).toEqual(['first', 'second']);
  }));

  it('rejects a delay that is not a finite, non-negative number', () => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);
    const source = signal(0);

    for (const delay of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => debouncedSignal(source, delay, { injector })).toThrowError(RangeError);
    }
  });
});
