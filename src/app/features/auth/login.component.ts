import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '@/app/core/auth';
import { BrandBannerComponent } from '@/app/shared/ui/brand/brand-banner.component';
import { LoginFormComponent } from './login-form.component';
import { RouteFocusTargetDirective } from '@/app/core/a11y';

/**
 * `/login`, and the one page in this application where incremental hydration applies.
 *
 * It is prerendered (`app.routes.server.ts`), so the whole card — heading, error banner,
 * every field, the button — arrives as HTML that needs no JavaScript to be *visible*.
 * What it needs JavaScript for is being *usable*, and that is 101.89 kB of
 * `@angular/forms` and Zod against roughly 5 kB for everything else on the page.
 *
 * `@defer (hydrate on interaction)` separates the two. The server still renders the
 * form — a `hydrate` trigger renders the main block, never the placeholder, which is the
 * difference between incremental hydration and ordinary deferring — and the browser
 * holds off on downloading and hydrating it until the visitor clicks or types. So the
 * page is interactive-looking immediately and actually interactive one round trip after
 * the first touch, with `withEventReplay()` (see `app.config.ts`) delivering that first
 * touch to the component once it exists.
 *
 * Three things this leans on, none of them obvious:
 *
 *   - The block carries no `@placeholder`. A `hydrate` trigger resolves against the
 *     block's *main* view rather than a placeholder's root node, so there is nothing for
 *     a placeholder to be the trigger surface of. On a client-rendered visit — a
 *     navigation into `/login` from inside the app, or any unit test — there is no
 *     dehydrated markup to trigger against at all, so the compiler's implicit `on idle`
 *     applies and the form loads on its own.
 *   - The form's markup has to be *inert* before hydration, not merely unhydrated.
 *     `login-form.component.ts` explains what that costs and why event replay does not
 *     cover it.
 *   - **`withI18nSupport()` in `app.config.ts`**, without which the `i18n` regions in
 *     this template switch the whole feature off. Angular marks a component whose
 *     template contains an `i18n` region `ngSkipHydration`, and a component that skips
 *     hydration takes every `@defer (hydrate …)` block under it with it: the block still
 *     renders on the server and the page still works, it is simply hydrated eagerly, so
 *     the 101.89 kB the trigger exists to postpone downloads on load after all. Nothing
 *     says so — no compiler diagnostic, no runtime warning — and the rendered page
 *     differs only in `ngb`, `jsaction` and the event-dispatch contract script.
 *     `assert-ssr.mjs` reads those out of the prerendered bytes, which is how marking
 *     this page translatable was caught silently switching the feature off.
 *
 * The error banner and the link to `/register` stay outside the block deliberately: both
 * are meaningful on the prerendered page, and the banner in particular is what a visitor
 * bounced back here by a failed sign-in needs to read before touching anything.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, BrandBannerComponent, LoginFormComponent, RouteFocusTargetDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4">
      <!--
        \`<main>\`, not a \`<div>\`. This route renders outside \`LayoutShellComponent\` — the
        one place in the application that provides landmarks — so without it the sign-in
        card is content in no landmark at all and the page has no main region for a
        screen-reader user to jump to. Same for /register, /unauthorized and /admin; the
        dashboard routes get theirs from the shell and must not add a second.
      -->
      <main appRouteFocusTarget class="w-full max-w-md">
        <div
          class="rounded-lg border border-[var(--color-border)] bg-white p-8 shadow-sm dark:bg-gray-900"
        >
          <!--
            The page's LCP element, and prerendered, which is what makes marking it
            \`priority\` pay: the directive puts a \`<link rel="preload">\` in the static
            \`<head>\`, so the request leaves before the parser reaches the tag and long
            before any JavaScript runs. \`assert-ssr.mjs\` checks that the link is really
            there. See docs/images.md.
          -->
          <app-brand-banner />

          <div class="mt-6 mb-8">
            <h1
              i18n="@@auth.login.heading"
              class="text-2xl font-bold text-[var(--color-foreground)]"
            >
              Welcome back
            </h1>
            <p
              i18n="@@auth.login.subheading"
              class="mt-1 text-sm text-[var(--color-muted-foreground)]"
            >
              Sign in to your account to continue
            </p>
          </div>

          @if (auth.errorMessage()) {
            <div
              role="alert"
              class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              {{ auth.errorMessage() }}
            </div>
          }

          @defer (hydrate on interaction) {
            <app-login-form />
          }

          <!-- One message with the link inside it; see register.component.ts. -->
          <p
            i18n="@@auth.login.registerPrompt"
            class="mt-6 text-center text-sm text-[var(--color-muted-foreground)]"
          >
            Don't have an account?
            <a
              routerLink="/register"
              class="font-medium text-[var(--color-primary)] hover:underline"
            >
              Create one
            </a>
          </p>
        </div>
      </main>
    </div>
  `,
})
export class LoginComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly auth = inject(AuthFacade);

  constructor() {
    effect(() => {
      if (this.auth.isSignedIn()) {
        const returnUrl =
          (this.route.snapshot.queryParams['returnUrl'] as string | undefined) ?? '/dashboard';
        void this.router.navigateByUrl(returnUrl);
      }
    });
  }
}
