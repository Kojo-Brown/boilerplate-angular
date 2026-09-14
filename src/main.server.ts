import { bootstrapApplication } from '@angular/platform-browser';
import type { BootstrapContext } from '@angular/platform-browser';
import { AppComponent } from '@/app/app.component';
import { config } from '@/app/app.config.server';

/**
 * The server's counterpart to `main.ts`.
 *
 * A *function* rather than a call, and it takes a `BootstrapContext`: the browser boots
 * once per page load, while this runs once per request (or once per route at prerender
 * time), and the context carries the request's document and URL into that render. Losing
 * it — calling `bootstrapApplication(AppComponent, config)` here, which compiles — is how
 * an application ends up rendering every request against the same shared platform state.
 */
const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;
