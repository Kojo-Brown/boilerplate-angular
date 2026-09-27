import { Component } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { host, requireEl } from '@/testing';
import {
  provideRouteFocus,
  ROUTE_FOCUS_TARGET_ID,
  RouteFocusTargetDirective,
  RouteFocusTargetRegistry,
} from './route-focus';

@Component({
  selector: 'app-focus-first',
  standalone: true,
  imports: [RouteFocusTargetDirective],
  template: `<main appRouteFocusTarget>first</main>`,
})
class FirstPageComponent {}

@Component({
  selector: 'app-focus-second',
  standalone: true,
  imports: [RouteFocusTargetDirective],
  template: `<main appRouteFocusTarget>second</main>`,
})
class SecondPageComponent {}

/** A route that forgot the directive, which is the warning path. */
@Component({ selector: 'app-focus-bare', standalone: true, template: `<main>bare</main>` })
class BarePageComponent {}

@Component({
  selector: 'app-focus-shell',
  standalone: true,
  imports: [RouterOutlet],
  template: `<a href="#" id="a-link">link</a><router-outlet />`,
})
class ShellComponent {}

const ROUTES = [
  { path: 'first', component: FirstPageComponent },
  { path: 'second', component: SecondPageComponent },
  { path: 'bare', component: BarePageComponent },
];

function setUp(): { fixture: ReturnType<typeof TestBed.createComponent<ShellComponent>> } {
  TestBed.configureTestingModule({
    providers: [provideRouter(ROUTES), provideLocationMocks(), provideRouteFocus()],
  });
  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  return { fixture };
}

/**
 * `afterNextRender` runs outside Angular's own stabilisation, so the spec has to render
 * and then let a frame pass before reading `document.activeElement`.
 */
async function settleFocus(fixture: ReturnType<typeof TestBed.createComponent>): Promise<void> {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

describe('provideRouteFocus', () => {
  /**
   * The point of the whole file: following a `routerLink` leaves focus on a link that no
   * longer exists, which costs a keyboard visitor the entire navigation on every page.
   */
  it('moves focus to the new route’s target after a navigation', async () => {
    const { fixture } = setUp();
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/first');
    await settleFocus(fixture);
    await router.navigateByUrl('/second');
    await settleFocus(fixture);

    const main = requireEl<HTMLElement>(host(fixture), 'main');
    expect(main.textContent).toContain('second');
    expect(document.activeElement).toBe(main);
  });

  /**
   * Not on load. The browser has already put focus at the top of the document, and a
   * visitor who arrived on a URL with a fragment has been taken to it — stealing focus back
   * to `<main>` undoes both, a beat after the page looked settled.
   */
  it('leaves focus alone on the first navigation', async () => {
    const { fixture } = setUp();
    const link = requireEl<HTMLElement>(host(fixture), '#a-link');
    link.focus();

    await TestBed.inject(Router).navigateByUrl('/first');
    await settleFocus(fixture);

    expect(document.activeElement).toBe(link);
  });

  /**
   * A fragment change on the current page is a navigation to the router and emits
   * `NavigationEnd`, but the page did not change — and moving focus to `<main>` would move
   * it away from the very thing the visitor asked to be taken to.
   */
  it('leaves focus alone when only the fragment changes', async () => {
    const { fixture } = setUp();
    const router = TestBed.inject(Router);

    await router.navigateByUrl('/first');
    await settleFocus(fixture);
    await router.navigateByUrl('/second');
    await settleFocus(fixture);

    const link = requireEl<HTMLElement>(host(fixture), '#a-link');
    link.focus();

    await router.navigateByUrl('/second#section-2');
    await settleFocus(fixture);

    expect(document.activeElement).toBe(link);
  });

  it('warns, rather than throwing, for a route that renders no focus target', async () => {
    const { fixture } = setUp();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/first');
    await settleFocus(fixture);

    const warn = spyOn(console, 'warn');
    await router.navigateByUrl('/bare');
    await settleFocus(fixture);

    expect(warn).toHaveBeenCalled();
    expect(warn.calls.mostRecent().args[0]).toContain('appRouteFocusTarget');
  });
});

describe('RouteFocusTargetDirective', () => {
  /**
   * `element.focus()` on a `<main>` without `tabindex` does nothing, silently. The only
   * symptom is focus staying where it was, which is indistinguishable from the feature
   * never having been added — so the directive supplies the attribute rather than trusting
   * every `<main>` in the application to remember it.
   */
  it('makes its host programmatically focusable without adding it to the tab order', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideLocationMocks()] });
    const fixture = TestBed.createComponent(FirstPageComponent);
    fixture.detectChanges();

    const main = requireEl<HTMLElement>(host(fixture), 'main');
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('carries the id the skip link points at', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideLocationMocks()] });
    const fixture = TestBed.createComponent(FirstPageComponent);
    fixture.detectChanges();

    expect(requireEl<HTMLElement>(host(fixture), 'main').id).toBe(ROUTE_FOCUS_TARGET_ID);
  });
});

describe('RouteFocusTargetRegistry', () => {
  let registry: RouteFocusTargetRegistry;
  let first: HTMLElement;
  let second: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(RouteFocusTargetRegistry);
    first = document.createElement('main');
    second = document.createElement('main');
  });

  it('has no target until one registers', () => {
    expect(registry.current()).toBeNull();
  });

  it('reports the most recently registered target', () => {
    registry.register(first);
    registry.register(second);

    expect(registry.current()).toBe(second);
  });

  /**
   * The ordering that makes this a check rather than an assignment: Angular creates the
   * incoming component's view before destroying the outgoing one, so the new target
   * registers and *then* the old one is destroyed. A de-registration that did not compare
   * would empty the registry at the moment it is about to be read.
   */
  it('ignores de-registration from an element that is no longer the target', () => {
    registry.register(first);
    registry.register(second);
    registry.unregister(first);

    expect(registry.current()).toBe(second);
  });

  it('clears the target when the current one de-registers', () => {
    registry.register(first);
    registry.unregister(first);

    expect(registry.current()).toBeNull();
  });
});
