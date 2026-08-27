import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthFacade } from '@/app/core/auth';
import { createFakeAuthFacade, fillInput, host, requireEl } from '@/testing';
import type { FakeAuthFacade } from '@/testing';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;

  /**
   * The component depends on `AuthFacade`, so the double is one too — eight members
   * checked by the compiler, rather than the five of `AuthStore` this spec used to
   * hand-roll and the fifteen it left out. See `docs/facade.md`.
   */
  let auth: FakeAuthFacade;

  // A real Router (not a stub) so `routerLink` can build hrefs — RouterLink calls
  // `createUrlTree`/`serializeUrl`, which a hand-rolled spy object does not implement.
  let navigateByUrl: jasmine.Spy;

  const submitButton = (): HTMLButtonElement =>
    requireEl<HTMLButtonElement>(host(fixture), 'button[type="submit"]');

  beforeEach(async () => {
    auth = createFakeAuthFacade();

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [{ provide: AuthFacade, useValue: auth }, provideRouter([])],
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

  it('should not sign in when form is invalid', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('should call the facade with valid credentials', () => {
    const el = host(fixture);
    fillInput(el, '#email', 'user@example.com');
    fillInput(el, '#password', 'Password1');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    expect(auth.signIn).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password1',
    });
  });

  it('should display the error the facade reports', () => {
    auth.errorMessage.set('Invalid credentials');
    fixture.detectChanges();
    const alert = host(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Invalid credentials');
  });

  it('should disable submit button while loading', () => {
    auth.isBusy.set(true);
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
    auth.isSignedIn.set(true);
    fixture.detectChanges();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });
});
