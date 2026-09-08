import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { host } from './dom';
import { settleUntil } from './settle';

/**
 * Writes its signal from a chain of promises Angular is not tracking — the shape of an
 * untracked read, without needing a query library to produce one.
 */
@Component({
  selector: 'test-settle-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (ready()) {
    <p data-testid="ready">ready</p>
  }`,
})
class SettleHostComponent {
  readonly ready = signal(false);

  /** Resolves after `turns` macrotask boundaries, like a batched library notification. */
  becomeReadyAfter(turns: number): void {
    const step = (remaining: number): void => {
      if (remaining === 0) {
        this.ready.set(true);
        return;
      }
      setTimeout(() => step(remaining - 1), 0);
    };
    setTimeout(() => step(turns - 1), 0);
  }
}

describe('settleUntil', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [SettleHostComponent] });
    const fixture = TestBed.createComponent(SettleHostComponent);
    fixture.detectChanges();
    return fixture;
  }

  function isReady(fixture: ReturnType<typeof create>): boolean {
    return host(fixture).querySelector('[data-testid="ready"]') !== null;
  }

  it('returns as soon as the condition already holds', async () => {
    const fixture = create();
    fixture.componentInstance.ready.set(true);

    await settleUntil(fixture, () => isReady(fixture));

    expect(isReady(fixture)).toBe(true);
  });

  it('waits across several macrotask turns', async () => {
    // Two is what TanStack Query happens to need today; the point of the helper is that a
    // spec does not have to know that, so this asserts a longer wait than any dependency
    // here actually takes.
    const fixture = create();
    fixture.componentInstance.becomeReadyAfter(5);

    await settleUntil(fixture, () => isReady(fixture));

    expect(isReady(fixture)).toBe(true);
  });

  it('renders before each check, so the condition can read the DOM', async () => {
    const fixture = create();
    fixture.componentInstance.becomeReadyAfter(2);

    // `isReady` looks at rendered markup rather than at the signal. Without the
    // `detectChanges()` inside the loop this would never become true.
    await settleUntil(fixture, () => isReady(fixture));

    expect(isReady(fixture)).toBe(true);
  });

  it('throws with the turn limit named when the condition never holds', async () => {
    const fixture = create();

    await expectAsync(settleUntil(fixture, () => false)).toBeRejectedWithError(
      /never reached the expected state.*25 turns/
    );
  });
});
