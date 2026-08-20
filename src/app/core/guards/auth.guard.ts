import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router, type CanActivateFn, type UrlTree } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthStore } from '@/app/store/auth/auth.store';

export const authGuard: CanActivateFn = (route, state) => {
  const authStore = inject(AuthStore);
  const router = inject(Router);

  const redirectToLogin = (): UrlTree =>
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  if (authStore.isAuthenticated()) {
    return true;
  }

  // Not authenticated *yet* is not the same as not authenticated. On a hard reload the
  // store restores the tokens from storage synchronously but has to fetch the profile,
  // and `isAuthenticated` requires both — so deciding on the spot would redirect a
  // signed-in user to `/login` on every refresh of a guarded route.
  if (!authStore.isRestoringSession()) {
    return redirectToLogin();
  }

  // The Signal → Observable boundary, and the case that justifies it: the answer is a
  // signal, but `CanActivateFn` is a one-shot API — it takes an Observable and waits for
  // the first value, where a signal would only ever hand it whatever was true at the
  // moment of the call. `filter`/`take` are what express "the first settled answer, then
  // stop", and neither has a signal equivalent. See `docs/rxjs-interop.md`.
  //
  // `take(1)` completes the stream, which unsubscribes and disposes the effect
  // `toObservable` created — the guard leaves nothing running behind it.
  return toObservable(authStore.isRestoringSession).pipe(
    filter((isRestoring) => !isRestoring),
    take(1),
    map((): boolean | UrlTree => (authStore.isAuthenticated() ? true : redirectToLogin()))
  );
};
