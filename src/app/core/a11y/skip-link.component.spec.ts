import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import { ROUTE_FOCUS_TARGET_ID, RouteFocusTargetRegistry } from './route-focus';
import { SkipLinkComponent } from './skip-link.component';

function link(fixture: ComponentFixture<SkipLinkComponent>): HTMLAnchorElement {
  return requireEl<HTMLAnchorElement>(host(fixture), 'a');
}

describe('SkipLinkComponent', () => {
  let fixture: ComponentFixture<SkipLinkComponent>;
  let registry: RouteFocusTargetRegistry;
  let target: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(RouteFocusTargetRegistry);
    fixture = TestBed.createComponent(SkipLinkComponent);
    fixture.detectChanges();

    target = document.createElement('main');
    target.id = ROUTE_FOCUS_TARGET_ID;
    target.tabIndex = -1;
    document.body.appendChild(target);
  });

  afterEach(() => target.remove());

  it('is a real link, so it is announced and activated as one', () => {
    expect(link(fixture).getAttribute('href')).toBe(`#${ROUTE_FOCUS_TARGET_ID}`);
    expect(link(fixture).textContent?.trim()).toBe('Skip to main content');
  });

  /**
   * `sr-only` and not `display: none`: the clip-rect pattern keeps the link in the tab
   * order, which is the only way it can ever be focused and so the only way it can ever
   * become visible again.
   */
  it('is hidden in a way that keeps it focusable', () => {
    expect(link(fixture).classList).toContain('sr-only');
    expect(link(fixture).classList).toContain('focus:not-sr-only');
  });

  /**
   * The bug this avoids is the classic one. A native fragment jump moves the scroll
   * position and the sequential-navigation starting point but not focus, so the next Tab
   * continues from the navigation the visitor was trying to skip — and it looks like it
   * worked to anyone watching the page scroll.
   */
  it('moves focus to the registered target instead of following the fragment', () => {
    registry.register(target);
    const event = new MouseEvent('click', { cancelable: true, bubbles: true });

    link(fixture).dispatchEvent(event);

    expect(document.activeElement).toBe(target);
    expect(event.defaultPrevented).toBeTrue();
  });

  /** The prerendered HTML carries the id even when no directive has registered yet. */
  it('falls back to the id in the document when nothing has registered', () => {
    const event = new MouseEvent('click', { cancelable: true, bubbles: true });

    link(fixture).dispatchEvent(event);

    expect(document.activeElement).toBe(target);
    expect(event.defaultPrevented).toBeTrue();
  });

  /**
   * With no target at all the browser's own fragment handling is better than nothing, so
   * the default is deliberately left in place.
   */
  /**
   * With no target at all the browser's own fragment handling is better than nothing, so
   * the default is deliberately left in place.
   *
   * The document-level listener is how the spec observes that decision without paying for
   * it: it runs in the bubble phase, after the component's own handler, so it reads the
   * verdict and then cancels the navigation that would otherwise take Karma's own frame to
   * `#main-content`.
   */
  it('lets the browser follow the link when there is no target to focus', () => {
    target.remove();
    let preventedByComponent: boolean | null = null;
    const observe = (event: Event): void => {
      preventedByComponent = event.defaultPrevented;
      event.preventDefault();
    };
    document.addEventListener('click', observe);

    try {
      link(fixture).dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    } finally {
      document.removeEventListener('click', observe);
    }

    expect(preventedByComponent).toBeFalse();
  });
});
