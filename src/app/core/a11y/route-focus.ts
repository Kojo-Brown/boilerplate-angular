import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
  Injectable,
  Injector,
  provideAppInitializer,
} from '@angular/core';
import type { EnvironmentProviders } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, pairwise, startWith } from 'rxjs';

/** The `id` {@link RouteFocusTargetDirective} puts on its host, and the skip link's href. */
export const ROUTE_FOCUS_TARGET_ID = 'main-content';

/**
 * Where focus goes after a routed navigation.
 *
 * A registry rather than a selector lookup, because there is no single element to look
 * for: the dashboard routes get their `<main>` from `LayoutShellComponent`, while
 * `/login`, `/register`, `/unauthorized` and `/admin` render outside the shell and each
 * provide their own. Whichever one is currently in the DOM registers itself, which also
 * means the fallback path — no target at all — is a fact this service knows rather than a
 * `querySelector` returning `null` that some caller has to interpret.
 *
 * Registration is last-in-wins and de-registration only clears a target that is still the
 * current one. The order matters during a navigation: Angular creates the incoming
 * component's view before destroying the outgoing one, so the new `<main>` registers and
 * *then* the old one is destroyed, and a de-registration that did not check would leave
 * the registry empty at exactly the moment it is about to be read.
 */
@Injectable({ providedIn: 'root' })
export class RouteFocusTargetRegistry {
  private target: HTMLElement | null = null;

  register(element: HTMLElement): void {
    this.target = element;
  }

  unregister(element: HTMLElement): void {
    if (this.target === element) {
      this.target = null;
    }
  }

  current(): HTMLElement | null {
    return this.target;
  }
}

/**
 * Marks the element that receives focus after each routed navigation — in practice the
 * `<main>` of whatever renders the route.
 *
 * The two host bindings are the point of having a directive rather than a convention.
 * `tabindex="-1"` is what makes the element focusable at all: `element.focus()` on a
 * `<main>` without it does nothing, silently, and the only symptom is that focus stays
 * where it was — so the feature is "implemented", nothing throws, and a keyboard visitor
 * still tabs back through the entire navigation on every page. `-1` keeps it out of the
 * tab order, so it is reachable programmatically and never by tabbing to it.
 *
 * The `id` is what the skip link points at, and giving it here means the two cannot drift:
 * a page that has a focus target has a skip-link destination by construction.
 *
 * Focus rings are left to `:focus-visible`. A `tabindex="-1"` container focused
 * programmatically does not match `:focus-visible` in any current browser, so nothing is
 * drawn for the route change — while a visitor who reaches it through the skip link, by
 * keyboard, does match and does get a ring. Suppressing `:focus` outright would take the
 * ring away from that second case too, which is a 2.4.7 failure.
 */
@Directive({
  selector: '[appRouteFocusTarget]',
  standalone: true,
  host: {
    tabindex: '-1',
    '[id]': 'elementId',
  },
})
export class RouteFocusTargetDirective {
  /** The id the skip link targets. Fixed, because only one target exists at a time. */
  protected readonly elementId = ROUTE_FOCUS_TARGET_ID;

  constructor() {
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const registry = inject(RouteFocusTargetRegistry);

    registry.register(element);
    inject(DestroyRef).onDestroy(() => registry.unregister(element));
  }
}

/**
 * Move focus to the current route's focus target after every routed navigation but the
 * first.
 *
 * What this fixes is not a missing feature so much as a regression the whole architecture
 * introduces. Following a link in a document moves focus to the top of the new document;
 * following a `routerLink` leaves it exactly where it was, on a link that no longer
 * exists, inside navigation the visitor has just used. A keyboard visitor then tabs
 * forward from a destroyed element — which the browser resolves by starting again at the
 * top of the document, so every navigation costs them the whole sidebar again — and a
 * screen-reader visitor's virtual cursor is stranded in the same place.
 *
 * Three constraints, each pinned by a spec in `route-focus.spec.ts`:
 *
 * **Not the first navigation.** On load the browser has already put focus at the top of
 * the document, and a visitor who arrived on a URL with a fragment has been taken to that
 * fragment. Stealing focus back to `<main>` would undo both, and under hydration it would
 * do it a beat *after* the page looked settled.
 *
 * **Not a fragment-only change.** `#section-2` on the current page is a navigation as far
 * as the router is concerned and emits `NavigationEnd`, but the page did not change, and
 * moving focus to `<main>` would be moving it away from the thing the visitor just asked
 * to be taken to. Comparing the URLs without their fragments is what tells the two apart.
 *
 * **After the render, not on the event.** The incoming component's view is created during
 * activation, but its DOM is written in the change-detection pass that follows the
 * navigation — so on `NavigationEnd` the new `<main>` may not have registered yet, and
 * focusing then focuses the outgoing page's target a moment before it is destroyed, which
 * sends focus to `<body>`. `afterNextRender` is the hook that means "once the DOM agrees
 * with the application", and it has no server-side counterpart, which is also the whole
 * of this function's platform handling.
 */
export function provideRouteFocus(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const router = inject(Router);
    const registry = inject(RouteFocusTargetRegistry);
    const injector = inject(Injector);

    router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        // `startWith(null)` makes the first real navigation arrive as `[null, first]`, so
        // the initial load is a pair this operator can recognise rather than an emission
        // `skip(1)` would drop before the fragment comparison ever sees it.
        startWith(null),
        pairwise(),
        filter(([previous, current]) => {
          if (previous === null || current === null) return false;
          return (
            withoutFragment(previous.urlAfterRedirects) !==
            withoutFragment(current.urlAfterRedirects)
          );
        }),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        afterNextRender(
          () => {
            const target = registry.current();
            if (target === null) {
              if (typeof ngDevMode === 'undefined' || ngDevMode) {
                console.warn(
                  `[a11y] ${router.url} rendered no element carrying \`appRouteFocusTarget\`, so focus ` +
                    'stayed on the link that was followed. Add the directive to the route’s <main>.'
                );
              }
              return;
            }
            target.focus();
          },
          { injector }
        );
      });
  });
}

/** The URL up to its `#`, which is the part a navigation has to change to be one. */
function withoutFragment(url: string): string {
  const hash = url.indexOf('#');
  return hash === -1 ? url : url.slice(0, hash);
}
