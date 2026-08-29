import type { ApplicationConfig } from '@angular/core';
import { inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { routes } from '@/app/app.routes';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { errorInterceptor } from '@/app/core/http/interceptors/error.interceptor';
import { jwtInterceptor } from '@/app/core/http/interceptors/jwt.interceptor';
import { loggingInterceptor } from '@/app/core/http/interceptors/logging.interceptor';
import { createQueryClient } from '@/app/core/query/query-client.config';
import {
  BUILT_IN_API_ERROR_MAPPERS,
  provideApiErrorMappers,
} from '@/app/core/http/errors/api-error-mappers';
import { AuthStore } from '@/app/store/auth/auth.store';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zoneless. `zone.js` is not in the build polyfills, so `NgZone` here is the noop
    // implementation and nothing monkey-patches the browser's async APIs. Change
    // detection is scheduled by Angular itself: a signal read in a template changing,
    // a bound template/host listener firing, `markForCheck`, `setInput`, or a view
    // being attached/removed. Anything that mutates state outside those paths has to
    // say so explicitly — see `docs/zoneless.md`.
    provideZonelessChangeDetection(),
    provideAnimationsAsync(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([loggingInterceptor, errorInterceptor, jwtInterceptor])),

    // How `errorInterceptor` reads a failed response, as a list rather than a function
    // body. First match wins, so this order is the contract: dropping a strategy is
    // deleting a name here, and adding one — a legacy gateway's `{ err_code, err_msg }`,
    // say — means deciding which built-ins it should get asked before.
    // `docs/strategy-tokens.md` covers that and the lazy-route case.
    provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS),

    provideTanStackQuery(createQueryClient()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },

    // Turn tokens restored from storage into a real session, before the router's
    // initial navigation runs its guards. Deliberately synchronous and non-blocking:
    // it starts the `/auth/me` request and returns, and `authGuard` waits on
    // `isRestoringSession` rather than bootstrap being held up by a network round trip.
    //
    // It lives here rather than in the store's `onInit` because `jwtInterceptor`
    // injects `AuthStore`: a request issued during the store's own construction
    // re-enters its factory and dies with `NG0200: Circular dependency detected`.
    provideAppInitializer(() => {
      inject(AuthStore).restoreSession();
    }),
  ],
};
