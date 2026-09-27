import { DestroyRef, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import type { RouterStateSnapshot } from '@angular/router';
import { TitleStrategy } from '@angular/router';
import { Subject } from 'rxjs';
import type { Observable } from 'rxjs';

export const APP_NAME = 'Boilerplate Angular';

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly titleService = inject(Title);
  private readonly titleUpdates = new Subject<string | null>();

  /**
   * The title of each route the router activates, without the ` | ${APP_NAME}` suffix,
   * emitted once per navigation.
   *
   * Published from here, rather than derived by a listener elsewhere, because of the one
   * fact about the router that makes the obvious route announcer wrong:
   *
   * ```js
   * this.events.next(new NavigationEnd(...));                       // router.mjs — first
   * this.titleStrategy?.updateTitle(t.targetRouterState.snapshot);  // then this
   * ```
   *
   * `NavigationEnd` is emitted **before** the title is updated. Anything that subscribes
   * to `NavigationEnd` and reads `Title.getTitle()` — which is how every route-announcer
   * recipe is written — reads the title of the page the visitor has just *left*. Nothing
   * about that failure is visible to an ordinary test: the navigation happened, the tab
   * title is correct by the time anyone inspects it, an announcement was made, and it
   * named the previous page. `title.strategy.spec.ts` pins the ordering against the real
   * router, so a future Angular release that reverses it fails there rather than quietly
   * making this indirection pointless.
   *
   * Emitting from the line after `setTitle` is correct by construction rather than by
   * timing: same call, same snapshot, no ordering left to get wrong.
   *
   * An `Observable` and not a `Signal`, because a navigation is an *event*. Two
   * navigations to two posts that share a title are two events and one state, and a
   * signal — which by design does not notify when the value it is set to is the value it
   * already held — would report the second as nothing having happened. That is exactly
   * the visitor this exists for, moving between two rows of the same list.
   *
   * `null` for a route that declares no `title`.
   */
  readonly titleUpdated: Observable<string | null> = this.titleUpdates.asObservable();

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => this.titleUpdates.complete());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const routeTitle = this.buildTitle(snapshot);
    this.titleService.setTitle(routeTitle ? `${routeTitle} | ${APP_NAME}` : APP_NAME);
    this.titleUpdates.next(routeTitle ?? null);
  }
}
