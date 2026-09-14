import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { LoginFormComponent } from './login-form.component';
import { AuthFacade } from '@/app/core/auth';
import { createFakeAuthFacade, fillInput, host, requireEl } from '@/testing';
import type { FakeAuthFacade } from '@/testing';

describe('LoginFormComponent', () => {
  let fixture: ComponentFixture<LoginFormComponent>;
  let auth: FakeAuthFacade;

  const submitButton = (): HTMLButtonElement =>
    requireEl<HTMLButtonElement>(host(fixture), 'form button');

  /** Enter in a field, which is the only thing that submits this form from the keyboard. */
  const pressEnter = (selector: string): void => {
    requireEl(host(fixture), selector).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  };

  beforeEach(async () => {
    auth = createFakeAuthFacade();

    await TestBed.configureTestingModule({
      imports: [LoginFormComponent],
      providers: [{ provide: AuthFacade, useValue: auth }],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginFormComponent);
    fixture.detectChanges();
  });

  it('renders email and password fields', () => {
    const el = host(fixture);
    expect(el.querySelector('#email')).toBeTruthy();
    expect(el.querySelector('#password')).toBeTruthy();
  });

  it('renders a submit button', () => {
    expect(submitButton().textContent?.trim()).toBe('Sign in');
  });

  /**
   * The one assertion that is about hydration rather than about forms, and the reason
   * this component exists as its own file.
   *
   * Between paint and hydration the markup below is live HTML with no Angular on it, and
   * Angular's event replay does not suppress a default action — it runs after the browser
   * has already taken it. A `type="submit"` here would therefore submit the form natively
   * on a pre-hydration click: a GET back to `/login` that discards whatever was typed,
   * and only on the slow connections that make deferring worth doing. `assert-ssr.mjs`
   * checks the same thing against the prerendered HTML; this checks the source of it.
   */
  it('uses a button with no native submit behaviour', () => {
    expect(submitButton().type)
      .withContext(
        'a type="submit" button inside a dehydrated @defer block submits the form before ' +
          'Angular can stop it — see the header of login-form.component.ts'
      )
      .toBe('button');
    expect(host(fixture).querySelector('button[type="submit"]')).toBeNull();
  });

  it('shows validation errors when submitting an empty form', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(host(fixture).querySelectorAll('p.text-xs.text-red-600').length).toBeGreaterThan(0);
  });

  it('shows an invalid-email error', () => {
    fillInput(host(fixture), '#email', 'not-an-email');
    submitButton().click();
    fixture.detectChanges();
    const messages = Array.from(host(fixture).querySelectorAll('p.text-xs.text-red-600')).map((e) =>
      e.textContent?.trim().toLowerCase()
    );
    expect(messages.some((text) => text?.includes('email'))).toBeTrue();
  });

  it('does not sign in when the form is invalid', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('calls the facade with valid credentials', () => {
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

  /**
   * With no `type="submit"` control the browser performs no implicit submission either,
   * so Enter has to be bound explicitly or the keyboard path is simply gone. Both fields
   * carry it, because "Enter submits" is a property of the form and not of the last
   * field in it.
   */
  it('submits on Enter from either field', () => {
    const el = host(fixture);
    fillInput(el, '#email', 'user@example.com');
    fillInput(el, '#password', 'Password1');
    fixture.detectChanges();

    pressEnter('#email');
    expect(auth.signIn).toHaveBeenCalledTimes(1);

    pressEnter('#password');
    expect(auth.signIn).toHaveBeenCalledTimes(2);
  });

  it('disables the submit button while a sign-in is in flight', () => {
    auth.isBusy.set(true);
    fixture.detectChanges();
    const button = submitButton();
    expect(button.disabled).toBeTrue();
    expect(button.textContent?.trim()).toBe('Signing in…');
  });
});
