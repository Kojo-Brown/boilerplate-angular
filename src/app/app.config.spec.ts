import { Component, NgZone, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';
import { host, requireEl } from '@/testing';

/**
 * Reads one signal and one plain field into the same template, so a single assertion
 * can tell "change detection ran" apart from "change detection ran and saw the field".
 */
@Component({
  standalone: true,
  template: `<p data-testid="probe">{{ fromSignal() }}/{{ fromField }}</p>`,
})
class ProbeComponent {
  readonly fromSignal = signal('a');
  fromField = 'a';
}

describe('appConfig', () => {
  beforeEach(() => {
    // The providers the real application bootstraps with. Environment providers set
    // here outrank the testing platform's, so a `provideZoneChangeDetection()` that
    // crept back into `app.config.ts` would win — which is what makes these
    // assertions about the shipped configuration rather than about the test setup.
    TestBed.configureTestingModule({ providers: [...appConfig.providers] });
  });

  function text(fixture: ReturnType<typeof TestBed.createComponent<ProbeComponent>>): string {
    return requireEl(host(fixture), '[data-testid="probe"]').textContent?.trim() ?? '';
  }

  it('bootstraps without an Angular zone', () => {
    const zone = TestBed.inject(NgZone);

    // A real `NgZone` enters the Angular zone for the duration of `run`. The noop
    // implementation zoneless installs just calls the function. `zone.js` is loaded in
    // the test bundle for `fakeAsync`, so this distinguishes the two implementations
    // rather than merely detecting whether ZoneJS exists.
    expect(zone.run(() => NgZone.isInAngularZone())).toBe(false);
  });

  it('refreshes the view when a signal read in the template changes', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);
    await fixture.whenStable();
    expect(text(fixture)).toBe('a/a');

    fixture.componentInstance.fromSignal.set('b');
    await fixture.whenStable();

    expect(text(fixture)).toBe('b/a');
  });

  it('does not refresh the view for a plain field mutated outside Angular', async () => {
    const fixture = TestBed.createComponent(ProbeComponent);
    await fixture.whenStable();

    fixture.componentInstance.fromField = 'b';
    await fixture.whenStable();

    // Nothing notified the scheduler, so no refresh is even attempted. This is the
    // behaviour every non-signal source of state has to account for under zoneless —
    // see `docs/zoneless.md`.
    expect(text(fixture)).toBe('a/a');

    // The field is not stale data Angular refuses to read; it is data Angular was
    // never told to go looking for. The next refresh, from any source, picks it up.
    fixture.componentInstance.fromSignal.set('b');
    await fixture.whenStable();

    expect(text(fixture)).toBe('b/b');
  });
});
