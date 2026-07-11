import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, TitleStrategy, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { routes } from '@/app/app.routes';
import { AppTitleStrategy } from '@/app/core/routing/title.strategy';
import { errorInterceptor } from '@/app/core/http/interceptors/error.interceptor';
import { jwtInterceptor } from '@/app/core/http/interceptors/jwt.interceptor';
import { loggingInterceptor } from '@/app/core/http/interceptors/logging.interceptor';
import { createQueryClient } from '@/app/core/query/query-client.config';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([loggingInterceptor, errorInterceptor, jwtInterceptor])),
    provideTanStackQuery(createQueryClient()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
  ],
};
