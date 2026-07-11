import type { Routes } from '@angular/router';
import { postTitleResolver } from '@/app/core/routing/post-title.resolver';

export const DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./dashboard-shell.component').then((m) => m.DashboardShellComponent),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./dashboard.component').then((m) => m.DashboardComponent),
        title: 'Dashboard',
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
