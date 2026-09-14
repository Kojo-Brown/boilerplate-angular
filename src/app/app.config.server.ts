import { mergeApplicationConfig } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from '@/app/app.config';
import { serverRoutes } from '@/app/app.routes.server';

/**
 * What the browser configuration gains when it runs on the server.
 *
 * Only the renderer and the route table: everything else — zoneless change detection,
 * the interceptor chain, the query client, the app initializer — is `appConfig`'s and is
 * shared, which is the property that makes a server render worth trusting. A provider
 * that exists only here is a behaviour the browser will not reproduce, and hydration's
 * whole contract is that the second render agrees with the first.
 *
 * Anything that genuinely cannot be shared belongs behind an injection token with two
 * implementations instead — `AUTH_TOKEN_STORAGE` and `THEME_PREFERENCE_STORE` are both
 * that shape, and both already return an empty answer where there is no browser storage
 * to read, so neither needs an override here.
 */
const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
