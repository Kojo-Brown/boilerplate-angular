import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ROUTE_FOCUS_TARGET_ID, RouteFocusTargetRegistry } from './route-focus';

/**
 * The first thing in the tab order: a link that jumps past the navigation.
 *
 * Every page here renders the same sidebar before its content, so without this a keyboard
 * visitor tabs through every navigation link before reaching anything on the page they
 * asked for — on every page, every time. SC 2.4.1 is about exactly this, and it is the
 * one success criterion whose fix is a single element.
 *
 * **Visible on focus, and only on focus.** `sr-only` is the clip-rect pattern, which
 * keeps the link in the tab order and in the accessibility tree while taking it out of
 * the layout; `focus:not-sr-only` undoes all of that the moment it is focused. Hiding it
 * with `display: none` instead — the thing that looks equivalent — takes it out of the
 * tab order, so it can never be focused and can never come back.
 *
 * **The click is handled, not followed.** `href="#main-content"` is what makes this a
 * link: it is announced as one, `Enter` activates it, and on the prerendered routes it
 * works before any JavaScript has loaded. But letting the browser follow it in a routed
 * application is wrong twice over. The fragment goes into the URL, where it stays and is
 * carried into the next `routerLink` navigation; and a native fragment jump moves the
 * *scroll position* and the sequential-navigation starting point without moving focus, so
 * the next Tab continues from the sidebar the visitor was trying to skip — which is the
 * classic "skip link that does not skip anything", and it looks like it works to anyone
 * who is watching the screen scroll. Calling `focus()` on the target is what actually
 * moves focus, and `preventDefault` keeps the URL clean.
 *
 * The registry is the same one route focus uses, so the skip link and a route change land
 * on the same element and there is nothing to keep in sync. `getElementById` is the
 * fallback for the case the registry cannot cover: the prerendered HTML has the `id` in
 * it, and if this is somehow activated before the directive has registered, the element
 * is still there to be found.
 */
@Component({
  selector: 'app-skip-link',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a
      [href]="'#' + targetId"
      (click)="skipToContent($event)"
      class="sr-only rounded-[var(--radius)] bg-[var(--color-primary)] px-4 py-2 text-sm
             font-semibold text-[var(--color-primary-foreground)] shadow-md
             focus-visible:outline-none focus-visible:ring-2
             focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2
             focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
    >
      Skip to main content
    </a>
  `,
})
export class SkipLinkComponent {
  private readonly registry = inject(RouteFocusTargetRegistry);

  protected readonly targetId = ROUTE_FOCUS_TARGET_ID;

  protected skipToContent(event: Event): void {
    const target =
      this.registry.current() ??
      (event.target as HTMLElement).ownerDocument.getElementById(ROUTE_FOCUS_TARGET_ID);

    if (target === null) return;

    event.preventDefault();
    target.focus();
  }
}
