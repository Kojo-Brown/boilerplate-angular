import type { ApplicationConfig } from '@angular/core';
import { inject, provideAppInitializer, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { routes } from '@/app/app.routes';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { errorInterceptor } from '@/app/core/http/interceptors/error.interceptor';
import { jwtInterceptor } from '@/app/core/http/interceptors/jwt.interceptor';
import { loggingInterceptor } from '@/app/core/http/interceptors/logging.interceptor';
import { cacheInterceptor } from '@/app/core/http/interceptors/cache.interceptor';
import { retryInterceptor } from '@/app/core/http/interceptors/retry.interceptor';
import { telemetryInterceptor } from '@/app/core/http/interceptors/telemetry.interceptor';
import {
  composeInterceptors,
  interceptWhen,
  requestsUnder,
} from '@/app/core/http/interceptors/compose';
import { createQueryClient } from '@/app/core/query/query-client.config';
import { environment } from '@/environments/environment';
import {
  BUILT_IN_API_ERROR_MAPPERS,
  provideApiErrorMappers,
} from '@/app/core/http/errors/api-error-mappers';
import { AuthStore } from '@/app/store/auth/auth.store';
import { provideAppImageLoader } from '@/app/core/images';
import {
  WEB_VITALS_SINK,
  consoleWebVitalsSink,
  provideWebVitals,
  provideWebVitalsBeacon,
} from '@/app/core/vitals';

export const appConfig: ApplicationConfig = {
  providers: [
    // Zoneless. `zone.js` is not in the build polyfills, so `NgZone` here is the noop
    // implementation and nothing monkey-patches the browser's async APIs. Change
    // detection is scheduled by Angular itself: a signal read in a template changing,
    // a bound template/host listener firing, `markForCheck`, `setInput`, or a view
    // being attached/removed. Anything that mutates state outside those paths has to
    // say so explicitly — see `docs/zoneless.md`.
    provideZonelessChangeDetection(),

    // Adopt the server's DOM instead of replacing it. Without this the browser throws
    // away every node the server rendered and builds the page again, which is not a
    // slower version of hydration — it is a visible flash, a lost scroll position, and
    // an input the user had already typed into being recreated empty.
    //
    // `withEventReplay()` is the only feature named because it is the only one not on by
    // default: in v22 `provideClientHydration()` already brings DOM hydration, the
    // `HttpClient` transfer cache, and incremental hydration, so `withIncrementalHydration()`
    // is deprecated and adding it here would be noise that reads as significant.
    //
    // Event replay is what makes a *dehydrated* region honest. `@defer (hydrate …)` in
    // `LoginComponent` leaves the sign-in form as server-rendered markup with no
    // listeners on it; replay captures the click or keystroke that arrives before the
    // chunk does and dispatches it once the block is alive. It is not a substitute for
    // designing that markup to be inert — see the header of `login.component.ts` for the
    // one thing replay cannot undo — but without it the first interaction on a
    // prerendered page is simply dropped. See `docs/ssr.md`.
    provideClientHydration(withEventReplay()),

    provideAnimationsAsync(),
    provideRouter(routes, withComponentInputBinding()),
    // Outermost first. The order is the whole design, so it is written out rather than
    // left to be inferred; `docs/interceptor-decorators.md` argues each position.
    //
    //   telemetry  — measures what the caller waited for, backoff and refresh included
    //   logging    — dev console, inside telemetry so it cannot skew the measurement
    //   error      — normalises failures, so nothing above it sees an HttpErrorResponse
    //   jwt        — owns the Authorization header and the 401 refresh queue
    //   cache      — keys on the request jwt will actually send, credential included
    //   retry      — nearest the transport, so one request can be several attempts
    //
    // `cache` and `retry` are scoped to this application's own API. Neither is safe to
    // apply blind to a third-party URL: the cache would key someone else's endpoint by
    // our `Authorization` header, and the retry would decide on our behalf that another
    // service's 503 is worth a second request.
    provideHttpClient(
      withInterceptors([
        telemetryInterceptor,
        loggingInterceptor,
        errorInterceptor,
        jwtInterceptor,
        interceptWhen(
          requestsUnder(environment.apiUrl),
          composeInterceptors(cacheInterceptor, retryInterceptor)
        ),
      ])
    ),

    // How `errorInterceptor` reads a failed response, as a list rather than a function
    // body. First match wins, so this order is the contract: dropping a strategy is
    // deleting a name here, and adding one — a legacy gateway's `{ err_code, err_msg }`,
    // say — means deciding which built-ins it should get asked before.
    // `docs/strategy-tokens.md` covers that and the lazy-route case.
    provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS),

    provideTanStackQuery(createQueryClient()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },

    // Field data for LCP, INP, CLS, FCP and TTFB — what this page load actually cost the
    // person who made it, as against what it costs a build agent. Browser-only, and by
    // construction rather than by a platform check: the work is registered through
    // `afterNextRender`, which has no server-side counterpart. The measuring library is
    // behind a dynamic import, so it is its own 8.80 kB chunk and not part of the initial
    // bundle; the server build emits that chunk too and never loads it.
    // `docs/web-vitals.md` covers what is measured, what it is attributed to, and what a
    // routed single-page application can and cannot ask of a metric that belongs to a
    // page *load*.
    provideWebVitals(),

    // Where those reports go. Empty `vitalsUrl` is the checked-in default and the
    // comparison is a build-time constant, so a build with no collector configured drops
    // the beacon entirely rather than shipping it unused — and sends nothing anywhere,
    // which is the same call `HTTP_TELEMETRY_SINK` makes by defaulting to a sink that
    // discards. The console sink then prints each metric in development and is silent in
    // production.
    environment.vitalsUrl === ''
      ? { provide: WEB_VITALS_SINK, useValue: consoleWebVitalsSink }
      : provideWebVitalsBeacon({ url: environment.vitalsUrl }),

    // How `<img ngSrc>` URLs are built. Nothing is provided while `imageCdnUrl` is empty,
    // which is the checked-in default: images then come from `public/` on this
    // application's own origin and `NgOptimizedImage` emits `src` alone. That "nothing" is
    // load-bearing rather than lazy — the directive tells a real loader from its own no-op
    // by identity, so a pass-through would make it advertise a density `srcset` whose
    // candidates are the same file. `docs/images.md` covers that and what a configured CDN
    // then changes.
    provideAppImageLoader(environment.imageCdnUrl),

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
