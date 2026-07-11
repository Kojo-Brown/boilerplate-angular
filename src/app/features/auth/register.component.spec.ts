import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Router } from '@angular/router';
import { RegisterComponent } from './register.component';
import { AuthStore } from '@/app/store/auth/auth.store';

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

  const mockRouter = { navigate: jasmine.createSpy('navigate') };

  beforeEach(async () => {
    mockAuthStore.register.calls.reset();
    mockRouter.navigate.calls.reset();
    mockAuthStore.isAuthenticated.set(false);
    mockAuthStore.isLoading.set(false);
    mockAuthStore.error.set(null);

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: AuthStore, useValue: mockAuthStore },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render all form fields', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('#name')).toBeTruthy();
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
    expect(el.querySelector('#confirmPassword')).toBeTruthy();
  });

  it('should render a submit button', () => {
    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(btn?.textContent?.trim()).toBe('Create account');
  });

  it('should show validation errors on empty form submit', () => {
    fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    const errors = fixture.nativeElement.querySelectorAll('p.text-xs.text-red-600');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should show password mismatch error', () => {
    const el: HTMLElement = fixture.nativeElement;
    fillField(el, '#name', 'Jane Smith');
    fillField(el, '#email', 'jane@example.com');
    fillField(el, '#password', 'Password1');
    fillField(el, '#confirmPassword', 'DifferentPass1');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();

    const errors = el.querySelectorAll('p.text-xs.text-red-600');
    const texts = Array.from(errors).map((e) => (e as HTMLElement).textContent?.trim());
    expect(texts.some((t) => t?.includes("Passwords don't match"))).toBeTrue();
  });

  it('should not call register when form is invalid', () => {
    fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();
    expect(mockAuthStore.register).not.toHaveBeenCalled();
  });

  it('should call authStore.register without confirmPassword on valid submit', () => {
    const el: HTMLElement = fixture.nativeElement;
    fillField(el, '#name', 'Jane Smith');
    fillField(el, '#email', 'jane@example.com');
    fillField(el, '#password', 'Password1');
    fillField(el, '#confirmPassword', 'Password1');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
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
    const alert = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Email already in use');
  });

  it('should disable button while loading', () => {
    mockAuthStore.isLoading.set(true);
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(btn?.disabled).toBeTrue();
    expect(btn?.textContent?.trim()).toBe('Creating account…');
  });

  it('should have a link to the login page', () => {
    const link = fixture.nativeElement.querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(link).toBeTruthy();
  });

  it('should enforce password complexity rules', () => {
    const el: HTMLElement = fixture.nativeElement;
    fillField(el, '#name', 'Jane Smith');
    fillField(el, '#email', 'jane@example.com');
    fillField(el, '#password', 'weakpassword');
    fillField(el, '#confirmPassword', 'weakpassword');
    fixture.detectChanges();

    el.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    fixture.detectChanges();

    expect(mockAuthStore.register).not.toHaveBeenCalled();
  });
});

function fillField(el: HTMLElement, selector: string, value: string): void {
  const input = el.querySelector<HTMLInputElement>(selector)!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
