import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map, skip } from 'rxjs';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { announcement, LiveRegionComponent } from './live-region.component';

/** What a route with no `title` is announced as. */
export const UNTITLED_ROUTE_ANNOUNCEMENT = 'Page loaded';

/** Turn a resolved route title into the sentence a screen reader reads out. */
export function routeAnnouncementFor(routeTitle: string | null): string {
  return routeTitle === null ? UNTITLED_ROUTE_ANNOUNCEMENT : `${routeTitle}, page loaded`;
}

/**
 * Says the name of the page after the router changes it.
 *
 * A full page load announces itself: the browser hands the new document to the screen
 * reader, which reads its title and places the virtual cursor at the top. A routed
 * navigation does none of that. The URL changes, the DOM under `<router-outlet>` is
 * replaced, and for a visitor who is not looking at the screen *nothing observable
 * happens at all* — which is the single largest difference between a single-page
 * application and the pages it replaced, and the reason this component exists.
 *
 * Three decisions, each of which is a way to get this wrong while appearing to have
 * implemented it:
 *
 * **It is driven by the title strategy, not by `NavigationEnd`.** The router emits
 * `NavigationEnd` *before* it updates the title, so the natural implementation announces
 * the previous page's title on every navigation. `AppTitleStrategy.titleUpdated` is the
 * same information published from after the update; its doc comment has the line from
 * `router.mjs` and `title.strategy.spec.ts` pins the ordering.
 *
 * **The first navigation is skipped.** On a page load the browser has already announced
 * the document, and the router then resolves its first route and updates the title — so
 * announcing every emission means the visitor is told the page's name twice, once by
 * their screen reader and once by us, a beat apart. `skip(1)` is about the *router's*
 * first navigation rather than about time, which is what makes it right under hydration
 * too: the prerendered document was announced on load, and the first client-side
 * navigation to resolve is the same route it was already showing.
 *
 * `skip(1)` counts emissions, so it is only the *router's* first navigation while this
 * component is subscribed before that navigation resolves — which is exactly what hosting
 * it in `AppComponent`'s template guarantees, the root view being constructed during
 * bootstrap and the initial navigation running after the app initializers. That placement
 * is not a second constraint to remember: the live region already has to be in the tree
 * before the first paint or it announces nothing, so the two requirements are the same
 * requirement. `titleUpdated` is a plain `Subject` rather than a replaying one for the same
 * reason — there is no late subscriber to serve, and a replay would hand one the
 * navigation it missed and have `skip(1)` swallow the next real one instead.
 *
 * **Politeness, not assertiveness.** Interrupting to say the page has changed talks over
 * whatever the visitor asked to hear; they will reach the new content by their own next
 * action, and the announcement is there to tell them it is worth doing.
 *
 * The `, page loaded` suffix is what distinguishes the announcement from the surrounding
 * content being read out — a bare `'Posts'` arriving in a live region is a word with no
 * context. The application name is deliberately not included: it belongs in the tab, and
 * a reader that says "Posts, Boilerplate Angular" on every navigation is reciting a
 * constant to someone who already knows which application they are in.
 */
@Component({
  selector: 'app-route-announcer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LiveRegionComponent],
  template: `<app-live-region [announcement]="pending()" politeness="polite" />`,
})
export class RouteAnnouncerComponent {
  private readonly titleStrategy = inject(AppTitleStrategy);

  protected readonly pending = toSignal(
    this.titleStrategy.titleUpdated.pipe(
      skip(1),
      map((routeTitle) => announcement(routeAnnouncementFor(routeTitle)))
    ),
    { initialValue: null }
  );
}
