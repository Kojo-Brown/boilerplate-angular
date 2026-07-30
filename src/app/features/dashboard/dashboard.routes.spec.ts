import { DASHBOARD_ROUTES } from './dashboard.routes';
import { postTitleResolver } from '@/app/core/routing/post-title.resolver';
import { DashboardShellComponent } from './dashboard-shell.component';
import { DashboardComponent } from './dashboard.component';
import { PostsListComponent } from '../posts/posts-list.component';
import { PostDetailComponent } from '../posts/post-detail.component';
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
