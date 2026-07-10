import type { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login.component').then((m) => m.LoginComponent),
    title: 'Login',
  },
  {
    path: 'register',
    loadComponent: () => import('./register.component').then((m) => m.RegisterComponent),
    title: 'Register',
  },
];
