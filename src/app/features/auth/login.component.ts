import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthFacade } from '@/app/core/auth';
import { LoginFormComponent } from './login-form.component';

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
 * Two things this leans on, neither of them obvious:
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
 *
 * The error banner and the link to `/register` stay outside the block deliberately: both
 * are meaningful on the prerendered page, and the banner in particular is what a visitor
 * bounced back here by a failed sign-in needs to read before touching anything.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [RouterLink, LoginFormComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4">
      <div class="w-full max-w-md">
        <div
          class="rounded-lg border border-[var(--color-border)] bg-white p-8 shadow-sm dark:bg-gray-900"
        >
          <div class="mb-8">
            <h1 class="text-2xl font-bold text-[var(--color-foreground)]">Welcome back</h1>
            <p class="mt-1 text-sm text-[var(--color-muted-foreground)]">
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

          <p class="mt-6 text-center text-sm text-[var(--color-muted-foreground)]">
            Don't have an account?
            <a
              routerLink="/register"
              class="font-medium text-[var(--color-primary)] hover:underline"
            >
              Create one
            </a>
          </p>
        </div>
      </div>
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
