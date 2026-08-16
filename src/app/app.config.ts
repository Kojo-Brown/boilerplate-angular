import type { ApplicationConfig } from '@angular/core';
import { provideZonelessChangeDetection } from '@angular/core';
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
    provideTanStackQuery(createQueryClient()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
  ],
};
