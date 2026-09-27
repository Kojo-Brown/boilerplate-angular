import { Component } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import type { RouterStateSnapshot } from '@angular/router';
import { NavigationEnd, provideRouter, Router, TitleStrategy } from '@angular/router';
import { APP_NAME, AppTitleStrategy } from './title.strategy';

describe('AppTitleStrategy', () => {
  let strategy: AppTitleStrategy;
  let titleService: Title;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        Title,
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
      ],
    });
    strategy = TestBed.inject(AppTitleStrategy);
    titleService = TestBed.inject(Title);
  });

  it('sets title with app name suffix when route has a title', () => {
    spyOn(strategy, 'buildTitle').and.returnValue('Dashboard');
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(`Dashboard | ${APP_NAME}`);
  });

  it('sets only the app name when no route title is defined', () => {
    spyOn(strategy, 'buildTitle').and.returnValue(undefined);
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(APP_NAME);
  });

  it('sets title with pipe separator correctly', () => {
    spyOn(strategy, 'buildTitle').and.returnValue('Login');
    spyOn(titleService, 'setTitle');

    strategy.updateTitle({} as RouterStateSnapshot);

    expect(titleService.setTitle).toHaveBeenCalledWith(`Login | ${APP_NAME}`);
  });

  it('emits the route title, without the app-name suffix, once per navigation', () => {
    const emitted: (string | null)[] = [];
    strategy.titleUpdated.subscribe((title) => emitted.push(title));
    const buildTitle = spyOn(strategy, 'buildTitle');

    buildTitle.and.returnValue('Posts');
    strategy.updateTitle({} as RouterStateSnapshot);
    buildTitle.and.returnValue(undefined);
    strategy.updateTitle({} as RouterStateSnapshot);

    expect(emitted).toEqual(['Posts', null]);
  });

  /**
   * The reason `titleUpdated` is an Observable and not a signal.
   *
   * A signal set to the value it already holds does not notify, so two navigations that
   * resolve to the same title — two rows of the same list, which is the ordinary case —
   * would be one emission and the second navigation would be announced as nothing having
   * happened.
   */
  it('emits again when two consecutive navigations resolve to the same title', () => {
    const emitted: (string | null)[] = [];
    strategy.titleUpdated.subscribe((title) => emitted.push(title));
    spyOn(strategy, 'buildTitle').and.returnValue('Post');

    strategy.updateTitle({} as RouterStateSnapshot);
    strategy.updateTitle({} as RouterStateSnapshot);

    expect(emitted).toEqual(['Post', 'Post']);
  });

  it('APP_NAME constant equals expected app name', () => {
    expect(APP_NAME).toBe('Boilerplate Angular');
  });
});

@Component({ selector: 'app-title-probe', standalone: true, template: '' })
class ProbeComponent {}

/**
 * The fact `titleUpdated` exists for, asserted against the real router rather than quoted
 * from its source.
 *
 * `router.mjs` emits `NavigationEnd` and *then* calls `titleStrategy.updateTitle`, so a
 * route announcer built the obvious way — subscribe to `NavigationEnd`, read
 * `Title.getTitle()` — announces the title of the page the visitor has just left. Nothing
 * about that is visible to a test that only checks the title afterwards.
 *
 * If a future Angular release swaps the two lines, this fails. That is the point: the
 * indirection in `AppTitleStrategy` is only worth its weight while the ordering holds, and
 * a green suite should not be the thing that hides the day it stops.
 */
describe('the router\u2019s title/event ordering', () => {
  it('emits NavigationEnd before it updates the title', async () => {
    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
        provideRouter([{ path: 'posts', component: ProbeComponent, title: 'Posts' }]),
        provideLocationMocks(),
      ],
    });

    const order: string[] = [];
    const router = TestBed.inject(Router);
    const strategy = TestBed.inject(AppTitleStrategy);

    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) order.push('NavigationEnd');
    });
    strategy.titleUpdated.subscribe(() => order.push('updateTitle'));

    await router.navigateByUrl('/posts');

    expect(order).toEqual(['NavigationEnd', 'updateTitle']);
  });

  /**
   * The consequence, stated as the bug it is: at the moment `NavigationEnd` arrives, the
   * document title is still the previous page's.
   */
  it('still has the previous page\u2019s document title when NavigationEnd arrives', async () => {
    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
        provideRouter([
          { path: 'first', component: ProbeComponent, title: 'First' },
          { path: 'second', component: ProbeComponent, title: 'Second' },
        ]),
        provideLocationMocks(),
      ],
    });

    const router = TestBed.inject(Router);
    const titleService = TestBed.inject(Title);
    await router.navigateByUrl('/first');

    const seenAtNavigationEnd: string[] = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) seenAtNavigationEnd.push(titleService.getTitle());
    });

    await router.navigateByUrl('/second');

    expect(seenAtNavigationEnd).toEqual([`First | ${APP_NAME}`]);
    expect(titleService.getTitle()).toBe(`Second | ${APP_NAME}`);
  });
});
