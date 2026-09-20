import { ChangeDetectionStrategy, Component, ElementRef, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { AuthFacade } from '@/app/core/auth';
import { schemaGroup } from '@/app/core/forms';
import { typedBeforeHydration } from '@/app/core/platform/pre-hydration-input';
import { controlErrorSignal } from '@/app/core/reactivity';
import { loginSchema } from './auth.schemas';

/**
 * The sign-in form, split out of `LoginComponent` so its JavaScript can be deferred.
 *
 * It is the whole of what `/login` costs: `@angular/forms` and Zod are 101.89 kB of the
 * route's 111 kB, against about 5 kB for the page around it (`docs/route-budgets.md`).
 * Everything above the inputs — the heading, the error banner, the link to `/register` —
 * needs none of that, which is what makes the split worth making rather than an arbitrary
 * cut: the host is prerendered *and* hydrated on load, and this arrives on the first
 * touch. See `login.component.ts` for the block that defers it and `docs/ssr.md` for the
 * measurement.
 *
 * ## Why the submit control is `type="button"`
 *
 * Between paint and hydration this component's markup is real HTML with no listeners on
 * it, and Angular does not neutralise it: event replay runs *after* the browser has
 * dispatched the event, and the only default it suppresses beforehand is a click on an
 * `<a>` (`shouldPreventDefaultBeforeDispatching` in the event-dispatch primitive). A
 * `<button type="submit">` here would therefore still perform a native form submission
 * on a pre-hydration click — a GET navigation back to `/login` that throws away whatever
 * the visitor had typed, intermittently, only on the slow connections that make
 * deferring worth doing in the first place.
 *
 * `type="button"` has no default action, so the pre-hydration click does nothing except
 * fire the `hydrate on interaction` trigger, and replay then delivers it to `(click)`
 * once this component is alive. Enter is bound on the fields for the same reason from
 * the other direction: with no submit button in the form, the browser performs no
 * implicit submission either — and would not have here regardless, since implicit
 * submission is skipped when a form has more than one field that blocks it.
 *
 * The other half of being typed into before hydration is `typedBeforeHydration` below:
 * without it, `setUpControl` writes each control's empty initial value over the node the
 * visitor has been using. That one is not specific to `@defer` — `RegisterComponent`
 * needs it too — but deferring widens the window on purpose, so it is felt here first.
 */
@Component({
  selector: 'app-login-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" novalidate>
      <div class="space-y-4">
        <div>
          <label for="email" class="mb-1 block text-sm font-medium text-[var(--color-foreground)]">
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
            (keydown.enter)="onSubmit()"
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
            autocomplete="current-password"
            placeholder="••••••••"
            class="w-full rounded-md border px-3 py-2 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            [class.border-red-400]="passwordError()"
            [class.border-[var(--color-border)]]="!passwordError()"
            (keydown.enter)="onSubmit()"
          />
          @if (passwordError()) {
            <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ passwordError() }}</p>
          }
        </div>
      </div>

      <button
        type="button"
        [disabled]="auth.isBusy()"
        (click)="onSubmit()"
        class="mt-6 w-full rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        @if (auth.isBusy()) {
          Signing in…
        } @else {
          Sign in
        }
      </button>
    </form>
  `,
})
export class LoginFormComponent {
  protected readonly auth = inject(AuthFacade);

  /**
   * Whatever is already in the server-rendered inputs, read before the `formControlName`
   * directives below get the chance to write an empty string over it. Deferring this
   * component's hydration is what makes that window long enough to type into; see
   * `typedBeforeHydration`.
   */
  private readonly typed = typedBeforeHydration(
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement,
    ['email', 'password'] as const
  );

  /**
   * The form, its field types and its per-field rules all from `loginSchema`. See
   * `docs/typed-forms.md`: `FormBuilder.group()` infers the model *from* the spec, so it
   * agrees with whatever was written — the fields are only checked against
   * `LoginFormData` because `schemaGroup` is given the schema that defines it.
   */
  protected readonly form = schemaGroup(loginSchema, {
    email: this.typed.email ?? '',
    password: this.typed.password ?? '',
  });

  /**
   * Validation messages as signals rather than getters. A getter is re-read on every
   * refresh and so is never *wrong*, but under zoneless nothing refreshes the view
   * unless it is told to, and a reactive-forms control does not tell anyone: it
   * publishes on `AbstractControl.events`, outside the reactive graph.
   * `controlErrorSignal` bridges that stream with `toSignal`, so a message appears when
   * the control's state changes rather than when the next unrelated refresh happens to
   * come along. See `docs/rxjs-interop.md`.
   */
  protected readonly emailError = controlErrorSignal(this.form.controls.email, 'zod');
  protected readonly passwordError = controlErrorSignal(this.form.controls.password, 'zod');

  /**
   * The parse stays, now that `getRawValue()` is typed `LoginFormData` rather than
   * `{ email: string | null; password: string | null }`. It is not defensive duplication:
   * the controls hold the schema's *input* type and `signIn` wants its output, and the
   * two coincide here only because `loginSchema` has no transform. The parse is what
   * makes that a checked fact instead of an assumption — and the group's own validity is
   * a statement about each field in isolation, not about the object.
   */
  protected onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const result = loginSchema.safeParse(this.form.getRawValue());
    if (!result.success) return;

    this.auth.signIn(result.data);
  }
}
