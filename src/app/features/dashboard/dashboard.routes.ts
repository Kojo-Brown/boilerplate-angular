import type { Routes } from '@angular/router';
import { postTitleResolver } from '@/app/core/routing/post-title.resolver';
import { HttpPostsService } from '../posts/http-posts.service';
import { providePostsBackend } from '../posts/posts.providers';
import { SAMPLE_WIDGETS } from './widgets/sample-widgets';
import { provideDashboardWidgets } from './widgets/widget.contracts';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard-shell.component').then((m) => m.DashboardShellComponent),
    // Which backend `PostReader`/`PostSearcher`/`PostWriter` resolve to — the one place
    // in the application that names an implementation. It sits here rather than in
    // `app.config.ts` because the posts routes below are the only consumers, and this
    // route is already lazy: naming `HttpPostsService` at the root would pull it, and
    // everything it reaches, into the initial bundle for the sake of a page most
    // sessions never open. Route `providers` create an environment injector for this
    // subtree, so the resolver on `posts/:id` sees it too.
    //
    // The cost of scoping it: the backend is constructed when the dashboard loads and
    // torn down when the user leaves it, so an implementation holding state — say
    // `InMemoryPostsService`, which is the swap this indirection exists for — starts
    // over on the next visit. Move these to `app.config.ts` if that matters more than
    // the bundle. See `docs/dependency-inversion.md`.
    providers: [...providePostsBackend(HttpPostsService)],
    children: [
      {
        path: '',
        loadComponent: () => import('./dashboard.component').then((m) => m.DashboardComponent),
        title: 'Dashboard',
        // Which widgets the board renders. On this route rather than in `app.config.ts` for
        // the reason the posts backend is: the board is the only consumer, the widget
        // components and their sample data are only reachable from here, and naming them at
        // the root would put all of it in the initial bundle. Replace the argument list to
        // change the dashboard; the board itself imports no widget.
        providers: [provideDashboardWidgets(...SAMPLE_WIDGETS)],
      },
      {
        path: 'posts',
        loadComponent: () =>
          import('../posts/posts-list.component').then((m) => m.PostsListComponent),
        title: 'Posts',
      },
      {
        path: 'posts/:id',
        loadComponent: () =>
          import('../posts/post-detail.component').then((m) => m.PostDetailComponent),
        title: postTitleResolver,
      },
    ],
  },
];
