import { Component } from '@angular/core';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router, TitleStrategy } from '@angular/router';
import { host, requireEl } from '@/testing';
import { APP_NAME, AppTitleStrategy } from '@/app/core/routing/title.strategy';
import {
  routeAnnouncementFor,
  RouteAnnouncerComponent,
  UNTITLED_ROUTE_ANNOUNCEMENT,
} from './route-announcer.component';

@Component({ selector: 'app-announcer-probe', standalone: true, template: '' })
class ProbeComponent {}

const ROUTES = [
  { path: 'dashboard', component: ProbeComponent, title: 'Dashboard' },
  { path: 'posts', component: ProbeComponent, title: 'Posts' },
  { path: 'posts/:id', component: ProbeComponent, title: 'Post' },
  { path: 'nameless', component: ProbeComponent },
];

function announced(fixture: ComponentFixture<RouteAnnouncerComponent>): string {
  return requireEl<HTMLElement>(host(fixture), '[aria-live]').textContent?.trim() ?? '';
}

async function settleAnnouncement(
  fixture: ComponentFixture<RouteAnnouncerComponent>
): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  fixture.detectChanges();
}

describe('RouteAnnouncerComponent', () => {
  let fixture: ComponentFixture<RouteAnnouncerComponent>;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AppTitleStrategy,
        { provide: TitleStrategy, useExisting: AppTitleStrategy },
        provideRouter(ROUTES),
        provideLocationMocks(),
      ],
    });
    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(RouteAnnouncerComponent);
    fixture.detectChanges();
  });

  it('starts with an empty live region', () => {
    expect(announced(fixture)).toBe('');
  });

  /**
   * The browser announces a document on load, and the router then resolves its first route
   * and updates the title. Announcing that emission means the visitor is told the name of
   * the page twice, a beat apart, by two different mechanisms.
   */
  it('says nothing for the first navigation, which the browser already announced', async () => {
    await router.navigateByUrl('/dashboard');
    await settleAnnouncement(fixture);

    expect(announced(fixture)).toBe('');
  });

  it('announces the new page after a subsequent navigation', async () => {
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/posts');
    await settleAnnouncement(fixture);

    expect(announced(fixture)).toBe('Posts, page loaded');
  });

  /**
   * Named as the bug it would be. The router emits `NavigationEnd` before it updates the
   * title, so an announcer wired to `NavigationEnd` + `Title.getTitle()` says "Dashboard"
   * here — the page that was just left.
   */
  it('announces the page arrived at, not the one left behind', async () => {
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/posts');
    await settleAnnouncement(fixture);

    expect(announced(fixture)).not.toContain('Dashboard');
    expect(announced(fixture)).toContain('Posts');
  });

  /** Two rows of one list share a title, and both navigations still have to be announced. */
  it('announces again when the next route resolves to the same title', async () => {
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/posts/1');
    await settleAnnouncement(fixture);
    expect(announced(fixture)).toBe('Post, page loaded');

    await router.navigateByUrl('/posts/2');
    fixture.detectChanges();
    expect(announced(fixture)).toBe('');

    await settleAnnouncement(fixture);
    expect(announced(fixture)).toBe('Post, page loaded');
  });

  it('falls back to a generic sentence for a route with no title', async () => {
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/nameless');
    await settleAnnouncement(fixture);

    expect(announced(fixture)).toBe(UNTITLED_ROUTE_ANNOUNCEMENT);
  });

  /**
   * The application name belongs in the tab, not in every announcement: a reader that says
   * it on each navigation is reciting a constant to someone who already knows it.
   */
  it('leaves the application name out of the announcement', async () => {
    await router.navigateByUrl('/dashboard');
    await router.navigateByUrl('/posts');
    await settleAnnouncement(fixture);

    expect(TestBed.inject(Router).url).toBe('/posts');
    expect(announced(fixture)).not.toContain(APP_NAME);
  });

  /** Polite, because interrupting to say the page changed talks over the new page. */
  it('announces politely', () => {
    expect(requireEl<HTMLElement>(host(fixture), '[aria-live]').getAttribute('aria-live')).toBe(
      'polite'
    );
  });

  describe('routeAnnouncementFor', () => {
    it('suffixes a title so it is not a bare word arriving out of nowhere', () => {
      expect(routeAnnouncementFor('Posts')).toBe('Posts, page loaded');
    });

    it('describes an untitled route generically', () => {
      expect(routeAnnouncementFor(null)).toBe(UNTITLED_ROUTE_ANNOUNCEMENT);
    });
  });
});
