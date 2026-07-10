import type { Routes } from '@angular/router';
import { authGuard, roleGuard } from '@/app/core/guards';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full',
  },
  // Auth feature: /login, /register
  {
    path: '',
    loadChildren: () =>
      import('@/app/features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'unauthorized',
    loadComponent: () =>
      import('@/app/features/errors/unauthorized.component').then(
        (m) => m.UnauthorizedComponent
      ),
    title: 'Unauthorized',
  },
  // Dashboard feature: /dashboard, /dashboard/posts, /dashboard/posts/:id
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadChildren: () =>
      import('@/app/features/dashboard/dashboard.routes').then((m) => m.DASHBOARD_ROUTES),
  },
  // Admin feature: /admin
  {
    path: 'admin',
    canActivate: [authGuard, roleGuard('admin')],
    loadChildren: () =>
      import('@/app/features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
  },
  {
    path: '**',
    redirectTo: 'dashboard',
  },
];
