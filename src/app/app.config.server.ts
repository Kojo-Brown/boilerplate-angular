import { CSP_NONCE, mergeApplicationConfig } from '@angular/core';
import type { ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from '@/app/app.config';
import { serverRoutes } from '@/app/app.routes.server';
import { CSP_NONCE_PLACEHOLDER } from '@/app/core/security';

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
 * implementations instead — `SESSION_HINT` and `THEME_PREFERENCE_STORE` are both that
 * shape, and both already return an empty answer where there is no per-visitor browser
 * state to read, so neither needs an override here.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),

    // The nonce the renderer stamps onto the `window.__jsaction_bootstrap(…)` script it
    // injects for event replay. Without it that script is emitted bare, and a
    // nonce-based policy blocks the one script whose whole job is to replay the first
    // interaction on a prerendered page.
    //
    // This is the one provider in this file that is **not** also wanted in the browser,
    // and the exception is load-bearing rather than an oversight of the rule in the
    // header. In the browser Angular's own default for `CSP_NONCE` reads the live
    // `ngCspNonce` attribute off `<app-root>` — which `src/server.ts` has by then
    // rewritten to this response's real nonce. Providing the placeholder in `appConfig`
    // instead would override that default with a build-time constant, and every `<style>`
    // Angular injected as a lazy component arrived would carry a nonce the policy does
    // not list: no error, no warning, just lazily-routed components rendering unstyled.
    // `app.config.spec.ts` asserts the shared config does not provide it.
    { provide: CSP_NONCE, useValue: CSP_NONCE_PLACEHOLDER },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
