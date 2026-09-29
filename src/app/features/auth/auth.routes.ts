import type { Routes } from '@angular/router';

/*
 * A route `title` is the one string in this repository that is read out loud whether or
 * not anyone looks at it: `AppTitleStrategy` writes it to the tab, and
 * `RouteAnnouncerComponent` announces it into the live region after every navigation
 * (`docs/focus-and-live-regions.md`). A plain literal here therefore does not degrade to
 * "untranslated text in the corner of a page" — it is an English sentence spoken into an
 * Arabic session, on every navigation, with nothing on screen to explain it.
 */

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login.component').then((m) => m.LoginComponent),
    title: $localize`:Browser tab title and route announcement@@route.title.login:Login`,
  },
  {
    path: 'register',
    loadComponent: () => import('./register.component').then((m) => m.RegisterComponent),
    title: $localize`:Browser tab title and route announcement@@route.title.register:Register`,
  },
];
