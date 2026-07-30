import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthStore } from '@/app/store/auth/auth.store';
import { fillInput, host, requireEl } from '@/testing';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;

  const mockAuthStore = {
    isAuthenticated: signal(false),
    isLoading: signal(false),
    error: signal<string | null>(null),
    login: jasmine.createSpy('login'),
    clearError: jasmine.createSpy('clearError'),
  };

  // A real Router (not a stub) so `routerLink` can build hrefs — RouterLink calls
  // `createUrlTree`/`serializeUrl`, which a hand-rolled spy object does not implement.
  let navigateByUrl: jasmine.Spy;

  const submitButton = (): HTMLButtonElement =>
    requireEl<HTMLButtonElement>(host(fixture), 'button[type="submit"]');

  beforeEach(async () => {
    mockAuthStore.login.calls.reset();
    mockAuthStore.isAuthenticated.set(false);
    mockAuthStore.isLoading.set(false);
    mockAuthStore.error.set(null);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [{ provide: AuthStore, useValue: mockAuthStore }, provideRouter([])],
    }).compileComponents();

    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl');

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render email and password fields', () => {
    const el = host(fixture);
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
  });

  it('should render a submit button', () => {
    expect(submitButton().textContent?.trim()).toBe('Sign in');
  });

  it('should show validation errors when submitting empty form', () => {
    submitButton().click();
    fixture.detectChanges();
    const errors = host(fixture).querySelectorAll('p.text-xs.text-red-600');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should show invalid email error', () => {
    fillInput(host(fixture), '#email', 'not-an-email');
    submitButton().click();
    fixture.detectChanges();
    const errors = host(fixture).querySelectorAll('p.text-xs.text-red-600');
    const errorTexts = Array.from(errors).map((e) => e.textContent?.trim());
    expect(errorTexts.some((t) => t?.toLowerCase().includes('email'))).toBeTrue();
  });

  it('should not call login when form is invalid', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(mockAuthStore.login).not.toHaveBeenCalled();
  });

  it('should call authStore.login with valid credentials', () => {
    const el = host(fixture);
    fillInput(el, '#email', 'user@example.com');
    fillInput(el, '#password', 'Password1');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    expect(mockAuthStore.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password1',
    });
  });

  it('should display API error from store', () => {
    mockAuthStore.error.set('Invalid credentials');
    fixture.detectChanges();
    const alert = host(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Invalid credentials');
  });

  it('should disable submit button while loading', () => {
    mockAuthStore.isLoading.set(true);
    fixture.detectChanges();
    const btn = submitButton();
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent?.trim()).toBe('Signing in…');
  });

  it('should have a link to the register page', () => {
    const link = host(fixture).querySelector<HTMLAnchorElement>('a[href="/register"]');
    expect(link).toBeTruthy();
  });

  it('should navigate to the dashboard once authenticated', () => {
    expect(navigateByUrl).not.toHaveBeenCalled();
    mockAuthStore.isAuthenticated.set(true);
    fixture.detectChanges();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });
});
