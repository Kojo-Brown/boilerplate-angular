import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { DASHBOARD_ROUTES } from './dashboard.routes';
import { postTitleResolver } from '@/app/core/routing/post-title.resolver';
import { DashboardShellComponent } from './dashboard-shell.component';
import { DashboardComponent } from './dashboard.component';
import { PostsListComponent } from '../posts/posts-list.component';
import { PostDetailComponent } from '../posts/post-detail.component';
import { HttpPostsService } from '../posts/http-posts.service';
import { PostReader, PostSearcher, PostWriter } from '../posts/posts.contracts';
import { loadRouteComponent } from '@/testing';

describe('DASHBOARD_ROUTES', () => {
  const shell = DASHBOARD_ROUTES[0];

  it('defines a single shell route at the empty path', () => {
    expect(shell.path).toBe('');
    expect(shell.loadComponent).toBeDefined();
  });

  it('shell has child routes', () => {
    expect(shell.children?.length).toBe(3);
  });

  it('overview child is at the empty path', () => {
    const overview = shell.children?.find((r) => r.path === '');
    expect(overview?.loadComponent).toBeDefined();
    expect(overview?.title).toBe('Dashboard');
  });

  it('posts list child is at "posts"', () => {
    const list = shell.children?.find((r) => r.path === 'posts');
    expect(list?.loadComponent).toBeDefined();
    expect(list?.title).toBe('Posts');
  });

  it('post detail child captures :id param', () => {
    const detail = shell.children?.find((r) => r.path === 'posts/:id');
    expect(detail?.loadComponent).toBeDefined();
    // The detail title is resolved per-post rather than static, so the route carries the
    // resolver itself. Asserting identity keeps this pinned to the real resolver.
    expect(detail?.title).toBe(postTitleResolver);
  });

  /**
   * The posts backend is chosen here rather than in `app.config.ts`, so that choice is
   * load-bearing and belongs in a test: dropping these providers leaves every consumer
   * of `PostReader` throwing NG0201 on a page nothing else covers.
   *
   * `createEnvironmentInjector` is what the router itself does with a route's
   * `providers`, so this exercises the real mechanism rather than a stand-in for it.
   */
  describe('posts backend wiring', () => {
    it('binds all three roles to one HttpPostsService for the routes beneath it', () => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      const scoped = createEnvironmentInjector(
        shell.providers ?? [],
        TestBed.inject(EnvironmentInjector)
      );

      const reader = scoped.get(PostReader);

      expect(reader).toBeInstanceOf(HttpPostsService);
      expect<unknown>(scoped.get(PostSearcher)).toBe(reader);
      expect<unknown>(scoped.get(PostWriter)).toBe(reader);

      scoped.destroy();
    });

    it('leaves the roles unprovided above the route, so the backend stays scoped', () => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });

      expect(TestBed.inject(PostReader, null)).toBeNull();
      expect(TestBed.inject(HttpPostsService, null)).toBeNull();
    });
  });

  describe('lazy loaders actually resolve', () => {
    it('shell loadComponent resolves to DashboardShellComponent', async () => {
      await expectAsync(loadRouteComponent(shell)).toBeResolvedTo(DashboardShellComponent);
    });

    it('overview loadComponent resolves to DashboardComponent', async () => {
      const overview = shell.children?.find((r) => r.path === '');
      await expectAsync(loadRouteComponent(overview)).toBeResolvedTo(DashboardComponent);
    });

    it('posts list loadComponent resolves to PostsListComponent', async () => {
      const list = shell.children?.find((r) => r.path === 'posts');
      await expectAsync(loadRouteComponent(list)).toBeResolvedTo(PostsListComponent);
    });

    it('post detail loadComponent resolves to PostDetailComponent', async () => {
      const detail = shell.children?.find((r) => r.path === 'posts/:id');
      await expectAsync(loadRouteComponent(detail)).toBeResolvedTo(PostDetailComponent);
    });
  });
});
