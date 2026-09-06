import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host } from '@/testing';
import { RepeatDirective } from './repeat.directive';

let leavesDestroyed = 0;

/** Renders nothing; it exists so a removed view can be observed being destroyed. */
@Component({
  selector: 'test-repeat-leaf',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class RepeatLeafComponent {
  ngOnDestroy(): void {
    leavesDestroyed += 1;
  }
}

@Component({
  selector: 'test-repeat-host',
  standalone: true,
  imports: [RepeatDirective, RepeatLeafComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <i data-testid="bar" *appRepeat="count(); let i">{{ i }}<test-repeat-leaf /></i> `,
})
class RepeatHostComponent {
  readonly count: WritableSignal<number> = signal(3);
}

describe('RepeatDirective', () => {
  beforeEach(() => {
    leavesDestroyed = 0;
  });

  function createHost(initial = 3): ComponentFixture<RepeatHostComponent> {
    TestBed.configureTestingModule({ imports: [RepeatHostComponent] });
    const fixture = TestBed.createComponent(RepeatHostComponent);
    fixture.componentInstance.count.set(initial);
    fixture.detectChanges();
    return fixture;
  }

  function bars(fixture: ComponentFixture<unknown>): HTMLElement[] {
    return Array.from(host(fixture).querySelectorAll<HTMLElement>('[data-testid="bar"]'));
  }

  function labels(fixture: ComponentFixture<unknown>): string[] {
    return bars(fixture).map((bar) => (bar.textContent ?? '').trim());
  }

  function setCount(fixture: ComponentFixture<RepeatHostComponent>, count: number): void {
    fixture.componentInstance.count.set(count);
    fixture.detectChanges();
  }

  it('renders the template once per count', () => {
    const fixture = createHost(3);

    expect(bars(fixture).length).toBe(3);
  });

  it('puts the zero-based index in scope as the implicit value', () => {
    const fixture = createHost(3);

    expect(labels(fixture)).toEqual(['0', '1', '2']);
  });

  it('renders nothing for a count of zero', () => {
    const fixture = createHost(0);

    expect(bars(fixture).length).toBe(0);
  });

  it('renders nothing for a negative or fractional count rather than throwing', () => {
    const fixture = createHost(-4);
    expect(bars(fixture).length).toBe(0);

    setCount(fixture, 2.7);
    expect(bars(fixture).length).toBe(2);

    setCount(fixture, Number.NaN);
    expect(bars(fixture).length).toBe(0);
  });

  it('keeps the views it already had when the run grows', () => {
    const fixture = createHost(2);
    const before = bars(fixture);

    setCount(fixture, 4);

    const after = bars(fixture);
    expect(after.length).toBe(4);
    // Identity, not count: rebuilding the run would restart any animation playing in the
    // views that did not need to change, which is the whole reason a skeleton has one.
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('removes views from the end when the run shrinks', () => {
    const fixture = createHost(4);
    const before = bars(fixture);

    setCount(fixture, 2);

    const after = bars(fixture);
    expect(after.length).toBe(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("leaves the surviving views' indexes alone across a resize", () => {
    const fixture = createHost(2);

    setCount(fixture, 4);
    expect(labels(fixture)).toEqual(['0', '1', '2', '3']);

    setCount(fixture, 3);
    // Nothing was written into a context here, and nothing needed to be: a view's index is
    // its position, and only views past the new end were removed.
    expect(labels(fixture)).toEqual(['0', '1', '2']);
  });

  it('destroys the views it removes rather than only detaching them', () => {
    const fixture = createHost(4);

    setCount(fixture, 1);

    // Three views left, and each one took its component down with it. Detaching without
    // destroying would leave three `RepeatLeafComponent`s alive and subscribed with no
    // DOM to render into, which the length assertions above cannot see.
    expect(leavesDestroyed).toBe(3);
  });

  it('has a context guard that asserts a type rather than checking one', () => {
    const directive = {} as RepeatDirective;

    expect(RepeatDirective.ngTemplateContextGuard(directive, undefined)).toBeTrue();
  });
});
