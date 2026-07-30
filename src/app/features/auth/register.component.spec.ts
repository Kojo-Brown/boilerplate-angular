import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router, provideRouter } from '@angular/router';
import { RegisterComponent } from './register.component';
import { AuthStore } from '@/app/store/auth/auth.store';
import { fillInput, host, requireEl } from '@/testing';

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;

  const mockAuthStore = {
    isAuthenticated: signal(false),
    isLoading: signal(false),
    error: signal<string | null>(null),
    register: jasmine.createSpy('register'),
    clearError: jasmine.createSpy('clearError'),
  };

  // A real Router (not a stub) so `routerLink` can build hrefs, and so `ActivatedRoute`
  // — which RouterLink injects — is present. A spy object supplies neither.
  let navigate: jasmine.Spy;

  const submitButton = (): HTMLButtonElement =>
    requireEl<HTMLButtonElement>(host(fixture), 'button[type="submit"]');

  beforeEach(async () => {
    mockAuthStore.register.calls.reset();
    mockAuthStore.isAuthenticated.set(false);
    mockAuthStore.isLoading.set(false);
    mockAuthStore.error.set(null);

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [{ provide: AuthStore, useValue: mockAuthStore }, provideRouter([])],
    }).compileComponents();

    navigate = spyOn(TestBed.inject(Router), 'navigate');

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render all form fields', () => {
    const el = host(fixture);
    expect(el.querySelector('#name')).toBeTruthy();
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
    expect(el.querySelector('#confirmPassword')).toBeTruthy();
  });

  it('should render a submit button', () => {
    expect(submitButton().textContent?.trim()).toBe('Create account');
  });

  it('should show validation errors on empty form submit', () => {
    submitButton().click();
    fixture.detectChanges();
    const errors = host(fixture).querySelectorAll('p.text-xs.text-red-600');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should show password mismatch error', () => {
    const el = host(fixture);
    fillInput(el, '#name', 'Jane Smith');
    fillInput(el, '#email', 'jane@example.com');
    fillInput(el, '#password', 'Password1');
    fillInput(el, '#confirmPassword', 'DifferentPass1');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    const errors = el.querySelectorAll('p.text-xs.text-red-600');
    const texts = Array.from(errors).map((e) => e.textContent?.trim());
    expect(texts.some((t) => t?.includes("Passwords don't match"))).toBeTrue();
  });

  it('should not call register when form is invalid', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(mockAuthStore.register).not.toHaveBeenCalled();
  });

  it('should call authStore.register without confirmPassword on valid submit', () => {
    const el = host(fixture);
    fillInput(el, '#name', 'Jane Smith');
    fillInput(el, '#email', 'jane@example.com');
    fillInput(el, '#password', 'Password1');
    fillInput(el, '#confirmPassword', 'Password1');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    expect(mockAuthStore.register).toHaveBeenCalledWith({
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: 'Password1',
    });
  });

  it('should display API error from store', () => {
    mockAuthStore.error.set('Email already in use');
    fixture.detectChanges();
    const alert = host(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Email already in use');
  });

  it('should disable button while loading', () => {
    mockAuthStore.isLoading.set(true);
    fixture.detectChanges();
    const btn = submitButton();
    expect(btn.disabled).toBeTrue();
    expect(btn.textContent?.trim()).toBe('Creating account…');
  });

  it('should have a link to the login page', () => {
    const link = host(fixture).querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(link).toBeTruthy();
  });

  it('should navigate to the dashboard once registration authenticates', () => {
    expect(navigate).not.toHaveBeenCalled();
    mockAuthStore.isAuthenticated.set(true);
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should enforce password complexity rules', () => {
    const el = host(fixture);
    fillInput(el, '#name', 'Jane Smith');
    fillInput(el, '#email', 'jane@example.com');
    fillInput(el, '#password', 'weakpassword');
    fillInput(el, '#confirmPassword', 'weakpassword');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    expect(mockAuthStore.register).not.toHaveBeenCalled();
  });
});
