import { DASHBOARD_ROUTES } from './dashboard.routes';

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
    expect(detail?.title).toBe('Post Detail');
  });
});
