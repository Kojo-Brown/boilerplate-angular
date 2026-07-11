import { Component, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '@/app/store/auth/auth.store';
import { zodValidator, zodGroupValidator } from '@/app/core/validators/zod-validator';
import { registerBaseSchema, registerSchema } from './auth.schemas';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-[var(--color-background)] px-4 py-8">
      <div class="w-full max-w-md">
        <div class="rounded-lg border border-[var(--color-border)] bg-white p-8 shadow-sm dark:bg-gray-900">
          <div class="mb-8">
            <h1 class="text-2xl font-bold text-[var(--color-foreground)]">Create an account</h1>
            <p class="mt-1 text-sm text-[var(--color-muted-foreground)]">
              Get started with your free account today
            </p>
          </div>

          @if (authStore.error()) {
            <div
              role="alert"
              class="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
            >
              {{ authStore.error() }}
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
                  [class.border-red-400]="nameError"
                  [class.border-[var(--color-border)]]="!nameError"
                />
                @if (nameError) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ nameError }}</p>
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
                  [class.border-red-400]="emailError"
                  [class.border-[var(--color-border)]]="!emailError"
                />
                @if (emailError) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ emailError }}</p>
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
                  [class.border-red-400]="passwordError"
                  [class.border-[var(--color-border)]]="!passwordError"
                />
                @if (passwordError) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">{{ passwordError }}</p>
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
                  [class.border-red-400]="confirmPasswordError"
                  [class.border-[var(--color-border)]]="!confirmPasswordError"
                />
                @if (confirmPasswordError) {
                  <p class="mt-1 text-xs text-red-600 dark:text-red-400">
                    {{ confirmPasswordError }}
                  </p>
                }
              </div>
            </div>

            <button
              type="submit"
              [disabled]="authStore.isLoading()"
              class="mt-6 w-full rounded-md bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--color-primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              @if (authStore.isLoading()) {
                Creating account…
              } @else {
                Create account
              }
            </button>
          </form>

          <p class="mt-6 text-center text-sm text-[var(--color-muted-foreground)]">
            Already have an account?
            <a
              routerLink="/login"
              class="font-medium text-[var(--color-primary)] hover:underline"
            >
              Sign in
            </a>
          </p>
        </div>
      </div>
    </div>
  `,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  protected readonly authStore = inject(AuthStore);

  protected readonly form = this.fb.group(
    {
      name: ['', [zodValidator(registerBaseSchema.shape.name)]],
      email: ['', [zodValidator(registerBaseSchema.shape.email)]],
      password: ['', [zodValidator(registerBaseSchema.shape.password)]],
      confirmPassword: ['', [zodValidator(registerBaseSchema.shape.confirmPassword)]],
    },
    { validators: zodGroupValidator(registerSchema) }
  );

  constructor() {
    effect(() => {
      if (this.authStore.isAuthenticated()) {
        void this.router.navigate(['/dashboard']);
      }
    });
  }

  protected get nameError(): string | null {
    const control = this.form.get('name');
    if (!control?.invalid || !control.touched) return null;
    return (control.errors?.['zod'] as string | undefined) ?? null;
  }

  protected get emailError(): string | null {
    const control = this.form.get('email');
    if (!control?.invalid || !control.touched) return null;
    return (control.errors?.['zod'] as string | undefined) ?? null;
  }

  protected get passwordError(): string | null {
    const control = this.form.get('password');
    if (!control?.invalid || !control.touched) return null;
    return (control.errors?.['zod'] as string | undefined) ?? null;
  }

  protected get confirmPasswordError(): string | null {
    const control = this.form.get('confirmPassword');
    if (!control?.touched) return null;
    if (control.errors?.['zod']) return control.errors['zod'] as string;
    if (this.form.errors?.['confirmPassword']) {
      return this.form.errors['confirmPassword'] as string;
    }
    return null;
  }

  protected onSubmit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const result = registerSchema.safeParse(this.form.getRawValue());
    if (!result.success) return;

    const { confirmPassword: _, ...credentials } = result.data;
    this.authStore.register(credentials);
  }
}
