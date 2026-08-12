import { Component, Injector, signal } from '@angular/core';
import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { intervalSignal } from './interval-signal';

@Component({
  standalone: true,
  template: `{{ ticks() }}`,
})
class HostComponent {
  readonly period = signal<number | null>(1000);
  readonly ticks = intervalSignal(this.period);
}

describe('intervalSignal', () => {
  function createHost() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('starts at zero and increments once per period', fakeAsync(() => {
    const fixture = createHost();
    expect(fixture.componentInstance.ticks()).toBe(0);

    tick(1000);
    expect(fixture.componentInstance.ticks()).toBe(1);

    tick(3000);
    expect(fixture.componentInstance.ticks()).toBe(4);

    fixture.destroy();
  }));

  it('accepts a constant period', fakeAsync(() => {
    TestBed.configureTestingModule({});
    const ticks = intervalSignal(500, { injector: TestBed.inject(Injector) });
    TestBed.tick();

    tick(1500);
    expect(ticks()).toBe(3);

    discardPeriodicTasks();
  }));

  it('re-arms on the new cadence without resetting the count', fakeAsync(() => {
    const fixture = createHost();
    tick(2000);
    expect(fixture.componentInstance.ticks()).toBe(2);

    fixture.componentInstance.period.set(250);
    fixture.detectChanges();
    tick(500);

    expect(fixture.componentInstance.ticks()).toBe(4);
    fixture.destroy();
  }));

  it('pauses on a null period and resumes from the current count', fakeAsync(() => {
    const fixture = createHost();
    tick(1000);
    expect(fixture.componentInstance.ticks()).toBe(1);

    fixture.componentInstance.period.set(null);
    fixture.detectChanges();
    // Nothing is scheduled while paused, so `fakeAsync` would report a leaked periodic
    // timer at the end of the spec if the previous interval had not been cleared.
    tick(5000);
    expect(fixture.componentInstance.ticks()).toBe(1);

    fixture.componentInstance.period.set(1000);
    fixture.detectChanges();
    tick(1000);
    expect(fixture.componentInstance.ticks()).toBe(2);

    fixture.destroy();
  }));

  it('clears the interval when the owning component is destroyed', fakeAsync(() => {
    const fixture = createHost();
    tick(1000);
    fixture.destroy();

    // Neither the assertion nor `fakeAsync`'s end-of-spec timer-queue check tolerates an
    // interval that outlived its component.
    tick(5000);
    expect(fixture.componentInstance.ticks()).toBe(1);
  }));

  it('rejects a constant period that is not a finite number above zero', () => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);

    for (const period of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => intervalSignal(period, { injector })).toThrowError(RangeError);
    }
  });

  it('rejects an invalid reactive period when the effect runs', () => {
    TestBed.configureTestingModule({});
    const period = signal<number | null>(-5);
    intervalSignal(period, { injector: TestBed.inject(Injector) });

    // The check cannot run at call time because the period is only read inside the
    // effect, so it surfaces on the first flush instead of at construction.
    expect(() => TestBed.tick()).toThrowError(RangeError);
  });
});
