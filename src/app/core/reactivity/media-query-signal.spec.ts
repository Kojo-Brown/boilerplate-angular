import { DOCUMENT } from '@angular/common';
import { Component, EnvironmentInjector, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { installFakeMediaQuery } from '@/testing';
import { mediaQuerySignal } from './media-query-signal';

const DESKTOP = '(min-width: 768px)';

@Component({
  standalone: true,
  template: `{{ isDesktop() }}`,
})
class HostComponent {
  readonly isDesktop = mediaQuerySignal(DESKTOP);
}

describe('mediaQuerySignal', () => {
  function createHost() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('reports the query result at creation time', () => {
    installFakeMediaQuery({ [DESKTOP]: true });
    expect(createHost().componentInstance.isDesktop()).toBeTrue();
  });

  it('tracks subsequent changes to the query result', () => {
    const media = installFakeMediaQuery({ [DESKTOP]: false });
    const fixture = createHost();

    media.set(DESKTOP, true);
    expect(fixture.componentInstance.isDesktop()).toBeTrue();

    media.set(DESKTOP, false);
    expect(fixture.componentInstance.isDesktop()).toBeFalse();
  });

  it('removes its listener when the owning component is destroyed', () => {
    const media = installFakeMediaQuery({ [DESKTOP]: false });
    const fixture = createHost();
    expect(media.listenerCount(DESKTOP)).toBe(1);

    fixture.destroy();

    expect(media.listenerCount(DESKTOP)).toBe(0);
    // A stale listener would still write into the destroyed component's signal.
    media.set(DESKTOP, true);
    expect(fixture.componentInstance.isDesktop()).toBeFalse();
  });

  it('accepts an explicit injector when called outside an injection context', () => {
    const media = installFakeMediaQuery({ [DESKTOP]: true });
    TestBed.configureTestingModule({});
    const isDesktop = mediaQuerySignal(DESKTOP, { injector: TestBed.inject(Injector) });

    expect(isDesktop()).toBeTrue();
    media.set(DESKTOP, false);
    expect(isDesktop()).toBeFalse();
  });

  function injectorWithView(defaultView: unknown): Injector {
    TestBed.configureTestingModule({});
    return Injector.create({
      providers: [{ provide: DOCUMENT, useValue: { defaultView } }],
      parent: TestBed.inject(EnvironmentInjector),
    });
  }

  it('falls back to a constant when there is no window', () => {
    const isDesktop = mediaQuerySignal(DESKTOP, { injector: injectorWithView(null) });
    expect(isDesktop()).toBeFalse();
  });

  it('falls back to a constant when the window has no matchMedia', () => {
    const isDesktop = mediaQuerySignal(DESKTOP, { injector: injectorWithView({}) });
    expect(isDesktop()).toBeFalse();
  });

  it('uses the configured fallback value', () => {
    const isDesktop = mediaQuerySignal(DESKTOP, {
      injector: injectorWithView(null),
      fallback: true,
    });
    expect(isDesktop()).toBeTrue();
  });
});
