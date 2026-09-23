import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthFacade } from '@/app/core/auth';
import { asyncCrossFieldValidator, revalidateWhen, schemaGroup } from '@/app/core/forms';
import { BrandBannerComponent } from '@/app/shared/ui/brand/brand-banner.component';
import { typedBeforeHydration } from '@/app/core/platform/pre-hydration-input';
import { controlErrorSignal, controlSignal } from '@/app/core/reactivity';
import { zodGroupValidator } from '@/app/core/validators/zod-validator';
import { registerBaseSchema, registerSchema } from './auth.schemas';
import { InviteService } from './invite.service';

/** The pair the server is asked about. Neither half is checkable on its own. */
interface InviteKey {
  readonly email: string;
  readonly code: string;
}

/**
 * The invite field's contribution to the request, or `null` when there is nothing worth
 * asking about.
 *
 * Two of the three reasons to skip are the point of returning a key rather than a
 * boolean: a blank code is a complete form (the field is optional), and an email the
 * schema itself would reject cannot be half of a meaningful question — sending
 * `jane@` and rendering "that code is not valid for this address" would be the form
 * blaming the wrong field for an address the user is still typing. Reusing
 * `registerBaseSchema.shape.email` rather than restating the rule keeps the two from
 * drifting.
 */
function inviteKey(control: AbstractControl): InviteKey | null {
  const code = String(control.value ?? '').trim();
  if (code.length === 0) return null;

  const email = String(control.parent?.get('email')?.value ?? '').trim();
  if (!registerBaseSchema.shape.email.safeParse(email).success) return null;

  return { email, code };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, BrandBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-8"
    >
      <div class="w-full max-w-md">
        <div
          class="rounded-lg border border-[var(--color-border)] bg-white p-8 shadow-sm dark:bg-gray-900"
        >
          <!-- Same reasoning as /login: prerendered, and the largest element in the card. -->
          <app-brand-banner />

          <div class="mt-6 mb-8">
            <h1 class="text-2xl font-bold text-[var(--color-foreground)]">Create an account</h1>
            <p class="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Get started with your free account today
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

          <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate>
            <div class="space-y-4">
              <div>
                <label
                  for="name"
                  class="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Full name
                </label>
                <input
                  id="name"
                  type="text"
                  formControlName="name"
                  autocomplete="name"
                  placeholder="Jane Smith"
                  class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  [class.border-red-400]="nameError()"
                  [class.border-[var(--color-border)]]="!nameError()"
                />
                @if (nameError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ nameError() }}</p>
                }
              </div>

              <div>
                <label
                  for="email"
                  class="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  formControlName="email"
                  autocomplete="email"
                  placeholder="you@example.com"
                  class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  [class.border-red-400]="emailError()"
                  [class.border-[var(--color-border)]]="!emailError()"
                />
                @if (emailError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ emailError() }}</p>
                }
              </div>

              <div>
                <label
                  for="password"
                  class="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  formControlName="password"
                  autocomplete="new-password"
                  placeholder="••••••••"
                  class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  [class.border-red-400]="passwordError()"
                  [class.border-[var(--color-border)]]="!passwordError()"
                />
                @if (passwordError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ passwordError() }}</p>
                }
                <p class="mt-1 text-xs text-[var(--color-muted-foreground)]">
                  Min 8 characters, one uppercase letter and one number
                </p>
              </div>

              <div>
                <label
                  for="confirmPassword"
                  class="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  formControlName="confirmPassword"
                  autocomplete="new-password"
                  placeholder="••••••••"
                  class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  [class.border-red-400]="confirmPasswordError()"
                  [class.border-[var(--color-border)]]="!confirmPasswordError()"
                />
                @if (confirmPasswordError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                    {{ confirmPasswordError() }}
                  </p>
                }
              </div>

              <div>
                <label
                  for="inviteCode"
                  class="mb-1 block text-sm font-medium text-[var(--color-foreground)]"
                >
                  Workspace invite code
                  <span class="font-normal text-[var(--color-muted-foreground)]">(optional)</span>
                </label>
                <input
                  id="inviteCode"
                  type="text"
                  formControlName="inviteCode"
                  autocomplete="off"
                  spellcheck="false"
                  placeholder="WS-0000-0000"
                  [attr.aria-invalid]="inviteCodeError() ? 'true' : null"
                  class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  [class.border-red-400]="inviteCodeError()"
                  [class.border-[var(--color-border)]]="!inviteCodeError()"
                />
                @if (isCheckingInvite()) {
                  <p class="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Checking invite code…
                  </p>
                } @else if (inviteCodeError()) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ inviteCodeError() }}</p>
                } @else {
                  <p class="mt-1 text-xs text-[var(--color-muted-foreground)]">
                    Leave blank to create a personal workspace
                  </p>
                }
              </div>
            </div>

            <button
              type="submit"
              [disabled]="auth.isBusy() || isCheckingInvite()"
              class="mt-6 w-full rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              @if (auth.isBusy()) {
                Creating account…
              } @else {
                Create account
              }
            </button>
          </form>

          <p class="mt-6 text-center text-sm text-[var(--color-muted-foreground)]">
            Already have an account?
            <a routerLink="/login" class="font-medium text-[var(--color-primary)] hover:underline">
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthFacade);
  private readonly invites = inject(InviteService);

  /**
   * This page is prerendered too, so it has the same window as `/login` — narrower, since
   * nothing here defers, but wide enough to type into on a slow connection. See
   * `typedBeforeHydration` for what is being recovered and why the constructor is the
   * only place it still exists.
   */
  private readonly typed = typedBeforeHydration(
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    ['name', 'email', 'password', 'confirmPassword', 'inviteCode'] as const
  );

  /**
   * Four fields and their rules from `registerBaseSchema`, plus the one rule that is not
   * a property of any single field.
   *
   * The base schema and not `registerSchema`: `.refine()` returns a `ZodEffects`, which
   * has no `.shape` to read — the per-field rules have to come from the object schema
   * underneath it, and the refinement arrives as a group validator. That split is not an
   * accident of the API, it is the same one the template makes: three messages render
   * under their own input, and "passwords don't match" belongs to the pair.
   */
  protected readonly form = schemaGroup(
    registerBaseSchema,
    {
      name: this.typed.name ?? '',
      email: this.typed.email ?? '',
      password: this.typed.password ?? '',
      confirmPassword: this.typed.confirmPassword ?? '',
      inviteCode: this.typed.inviteCode ?? '',
    },
    { validators: zodGroupValidator(registerSchema) }
  );

  constructor() {
    const inviteCode = this.form.controls.inviteCode;

    /**
     * The asynchronous half of the invite rule, added here rather than seeded by
     * `schemaGroup`: a Zod schema describes values, and "does this code apply to that
     * address" is a question for the invite table.
     *
     * On the **field** and not on the group, though the rule reads two of them. Angular
     * runs a control's async validators only once its synchronous ones pass, and a
     * `FormGroup`'s synchronous validator is the whole form — so on the group nothing
     * would be sent until the password fields were filled in and matching, and the
     * invite error would appear last instead of next to the input that caused it.
     * `inviteKey` reaches up through `control.parent` for the other half.
     *
     * `equal` because the key is an object: the default `Object.is` would miss every
     * cache hit, and a cache that never hits turns each keystroke in `email` — which
     * `revalidateWhen` below forwards here — back into a request.
     */
    inviteCode.addAsyncValidators(
      asyncCrossFieldValidator(
        inviteKey,
        (key) => this.invites.check(key.email, key.code).pipe(map(toInviteErrors)),
        { equal: (a, b) => a.email === b.email && a.code === b.code }
      )
    );

    // Without this, correcting a typo in `email` leaves the code's verdict standing —
    // it was reached against an address that is no longer in the form.
    revalidateWhen(inviteCode, [this.form.controls.email]);

    effect(() => {
      if (this.auth.isSignedIn()) {
        void this.router.navigate(['/dashboard']);
      }
    });
  }

  /**
   * Validation messages as signals rather than getters — see the note in
   * `LoginComponent` and `docs/rxjs-interop.md` for why a reactive-forms control needs
   * `toSignal` to be visible to the reactive graph at all.
   */
  protected readonly nameError = controlErrorSignal(this.form.controls.name, 'zod');
  protected readonly emailError = controlErrorSignal(this.form.controls.email, 'zod');
  protected readonly passwordError = controlErrorSignal(this.form.controls.password, 'zod');

  private readonly confirmPassword = controlSignal(this.form.controls.confirmPassword);
  private readonly formState = controlSignal(this.form);

  /**
   * The one field with two sources of truth: its own schema rejects an empty value,
   * while "passwords don't match" is a property of the pair and so lands on the group.
   * Tracking both controls is what makes the message clear as soon as the *other* field
   * is corrected — the group revalidates, and nothing here has to know that happened.
   */
  protected readonly confirmPasswordError = computed(() => {
    const control = this.confirmPassword();
    if (!control.touched) return null;

    const ownError = control.errors?.['zod'];
    if (typeof ownError === 'string') return ownError;

    const groupError = this.formState().errors?.['confirmPassword'];
    return typeof groupError === 'string' ? groupError : null;
  });

  private readonly inviteCodeState = controlSignal(this.form.controls.inviteCode);

  /** An invite check is in flight, or waiting out its debounce. */
  protected readonly isCheckingInvite = computed(() => this.inviteCodeState().pending);

  /**
   * Gated on `dirty` rather than on `touched`, unlike every other field here.
   *
   * The others report a rule the user could have read off the label, so waiting for
   * blur keeps an untouched form quiet. This one reports the server's answer to a
   * question only typing could have raised, and the answer arrives while the caret is
   * still in the field — holding it back until blur would mean showing a stale-looking
   * error about a code the user has already moved past. `touched` is still honoured so
   * that submitting an untouched form surfaces it too.
   */
  protected readonly inviteCodeError = computed(() => {
    const { dirty, touched, errors } = this.inviteCodeState();
    if (!dirty && !touched) return null;

    const ownError = errors?.['zod'];
    if (typeof ownError === 'string') return ownError;

    const inviteError = errors?.['invite'];
    return typeof inviteError === 'string' ? inviteError : null;
  });

  protected onSubmit(): void {
    this.form.markAllAsTouched();

    // `pending` and not just `invalid`: a form waiting on an async validator is neither
    // valid nor invalid, so `invalid` alone is `false` here and submission would go
    // through with the invite code unchecked. The button is disabled for the same reason;
    // this is the guard for the paths a disabled button does not cover.
    if (this.form.pending || this.form.invalid) return;

    const result = registerSchema.safeParse(this.form.getRawValue());
    if (!result.success) return;

    const { confirmPassword: _, inviteCode, ...credentials } = result.data;
    const code = inviteCode.trim();
    this.auth.signUp(code.length > 0 ? { ...credentials, inviteCode: code } : credentials);
  }
}

/** The validator's view of one answer: a message under `invite`, or no error at all. */
function toInviteErrors(result: { readonly problem: string | null }): ValidationErrors | null {
  return result.problem === null ? null : { invite: result.problem };
}
