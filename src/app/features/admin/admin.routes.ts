import type { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./admin.component').then((m) => m.AdminComponent),
    title: $localize`:Browser tab title and route announcement@@route.title.admin:Admin`,
  },
];
