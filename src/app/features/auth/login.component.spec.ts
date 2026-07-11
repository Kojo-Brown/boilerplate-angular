import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthStore } from '@/app/store/auth/auth.store';

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

  const mockRouter = { navigate: jasmine.createSpy('navigate'), navigateByUrl: jasmine.createSpy('navigateByUrl') };
  const mockActivatedRoute = { snapshot: { queryParams: {} } };

  beforeEach(async () => {
    mockAuthStore.login.calls.reset();
    mockRouter.navigate.calls.reset();
    mockRouter.navigateByUrl.calls.reset();
    mockAuthStore.isAuthenticated.set(false);
    mockAuthStore.isLoading.set(false);
    mockAuthStore.error.set(null);

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthStore, useValue: mockAuthStore },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render email and password fields', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
  });

  it('should render a submit button', () => {
    const el: HTMLElement = fixture.nativeElement;
    const btn = el.querySelector('button[type="submit"]');
    expect(btn).toBeTruthy();
    expect(btn?.textContent?.trim()).toBe('Sign in');
  });

  it('should show validation errors when submitting empty form', () => {
    const el: HTMLElement = fixture.nativeElement;
    el.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    const errors = el.querySelectorAll('p.text-xs.text-red-600');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should show invalid email error', () => {
    const emailInput = fixture.nativeElement.querySelector<HTMLInputElement>('#email');
    emailInput.value = 'not-an-email';
    emailInput.dispatchEvent(new Event('input'));
    fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    const errors = fixture.nativeElement.querySelectorAll('p.text-xs.text-red-600');
    const errorTexts = Array.from(errors).map((e) => (e as HTMLElement).textContent?.trim());
    expect(errorTexts.some((t) => t?.toLowerCase().includes('email'))).toBeTrue();
  });

  it('should not call login when form is invalid', () => {
    fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    expect(mockAuthStore.login).not.toHaveBeenCalled();
  });

  it('should call authStore.login with valid credentials', () => {
    const el: HTMLElement = fixture.nativeElement;

    const emailInput = el.querySelector<HTMLInputElement>('#email')!;
    const passwordInput = el.querySelector<HTMLInputElement>('#password')!;

    emailInput.value = 'user@example.com';
    emailInput.dispatchEvent(new Event('input'));
    passwordInput.value = 'Password1';
    passwordInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();

    expect(mockAuthStore.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password1',
    });
  });

  it('should display API error from store', () => {
    mockAuthStore.error.set('Invalid credentials');
    fixture.detectChanges();
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Invalid credentials');
  });

  it('should disable submit button while loading', () => {
    mockAuthStore.isLoading.set(true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(btn?.disabled).toBeTrue();
    expect(btn?.textContent?.trim()).toBe('Signing in…');
  });

  it('should have a link to the register page', () => {
    const link = fixture.nativeElement.querySelector<HTMLAnchorElement>('a[href="/register"]');
    expect(link).toBeTruthy();
  });
});
