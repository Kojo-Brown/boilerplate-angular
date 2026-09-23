import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RegisterComponent } from './register.component';
import { InviteService } from './invite.service';
import { AuthFacade } from '@/app/core/auth';
import {
  createFakeAuthFacade,
  createFakeInviteChecker,
  fillInput,
  host,
  requireEl,
} from '@/testing';
import type { FakeAuthFacade, FakeInviteChecker } from '@/testing';

/** `asyncCrossFieldValidator`'s default, which `RegisterComponent` does not override. */
const INVITE_DEBOUNCE = 400;

describe('RegisterComponent', () => {
  let fixture: ComponentFixture<RegisterComponent>;
  let component: RegisterComponent;

  /** The same double the login spec uses — see the note there. */
  let auth: FakeAuthFacade;
  let invites: FakeInviteChecker;

  // A real Router (not a stub) so `routerLink` can build hrefs, and so `ActivatedRoute`
  // — which RouterLink injects — is present. A spy object supplies neither.
  let navigate: jasmine.Spy;

  const submitButton = (): HTMLButtonElement =>
    requireEl<HTMLButtonElement>(host(fixture), 'button[type="submit"]');

  beforeEach(async () => {
    auth = createFakeAuthFacade();
    invites = createFakeInviteChecker();

    await TestBed.configureTestingModule({
      imports: [RegisterComponent],
      providers: [
        { provide: AuthFacade, useValue: auth },
        { provide: InviteService, useValue: invites },
        provideRouter([]),
      ],
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

  it('should not sign up when form is invalid', () => {
    submitButton().click();
    fixture.detectChanges();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('should call the facade without confirmPassword on valid submit', () => {
    const el = host(fixture);
    fillInput(el, '#name', 'Jane Smith');
    fillInput(el, '#email', 'jane@example.com');
    fillInput(el, '#password', 'Password1');
    fillInput(el, '#confirmPassword', 'Password1');
    fixture.detectChanges();

    submitButton().click();
    fixture.detectChanges();

    expect(auth.signUp).toHaveBeenCalledWith({
      name: 'Jane Smith',
      email: 'jane@example.com',
      password: 'Password1',
    });
  });

  it('should display API error from store', () => {
    auth.errorMessage.set('Email already in use');
    fixture.detectChanges();
    const alert = host(fixture).querySelector('[role="alert"]');
    expect(alert?.textContent?.trim()).toContain('Email already in use');
  });

  it('should disable button while loading', () => {
    auth.isBusy.set(true);
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
    auth.isSignedIn.set(true);
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

    expect(auth.signUp).not.toHaveBeenCalled();
  });
  describe('the invite code, checked against the email', () => {
    /** Fills the form except for the invite code, which each spec drives itself. */
    function fillCredentials(): HTMLElement {
      const el = host(fixture);
      fillInput(el, '#name', 'Jane Smith');
      fillInput(el, '#email', 'jane@example.com');
      fillInput(el, '#password', 'Password1');
      fillInput(el, '#confirmPassword', 'Password1');
      return el;
    }

    const inviteMessage = (): string | null =>
      host(fixture).querySelector('#inviteCode ~ p')?.textContent?.trim() ?? null;

    it('renders the invite field', () => {
      expect(host(fixture).querySelector('#inviteCode')).toBeTruthy();
    });

    it('does not check anything while the code is blank', fakeAsync(() => {
      fillCredentials();
      tick(INVITE_DEBOUNCE);
      expect(invites.check).not.toHaveBeenCalled();
    }));

    it('does not check against an email the schema would reject', fakeAsync(() => {
      const el = host(fixture);
      fillInput(el, '#email', 'jane@');
      fillInput(el, '#inviteCode', 'WS-0000-0001');
      tick(INVITE_DEBOUNCE);
      expect(invites.check).not.toHaveBeenCalled();
    }));

    it('collapses the keystrokes of one code into a single check', fakeAsync(() => {
      const el = fillCredentials();
      for (const code of ['W', 'WS', 'WS-0', 'WS-0000-0001']) {
        fillInput(el, '#inviteCode', code);
        tick(INVITE_DEBOUNCE / 4);
      }
      tick(INVITE_DEBOUNCE);

      expect(invites.check).toHaveBeenCalledOnceWith('jane@example.com', 'WS-0000-0001');
    }));

    it('reports the check while it is in flight and blocks submission', fakeAsync(() => {
      const el = fillCredentials();
      fillInput(el, '#inviteCode', 'WS-0000-0001');
      fixture.detectChanges();

      expect(submitButton().disabled).toBeTrue();
      expect(inviteMessage()).toBe('Checking invite code…');

      submitButton().click();
      fixture.detectChanges();
      expect(auth.signUp).not.toHaveBeenCalled();

      tick(INVITE_DEBOUNCE);
      fixture.detectChanges();
      expect(submitButton().disabled).toBeFalse();
    }));

    it('renders the message the server sends back', fakeAsync(() => {
      invites.answer = () => ({ problem: 'That code has expired' });

      const el = fillCredentials();
      fillInput(el, '#inviteCode', 'WS-0000-0001');
      tick(INVITE_DEBOUNCE);
      fixture.detectChanges();

      expect(inviteMessage()).toBe('That code has expired');

      submitButton().click();
      fixture.detectChanges();
      expect(auth.signUp).not.toHaveBeenCalled();
    }));

    it('re-checks the code when the email is corrected', fakeAsync(() => {
      invites.answer = (email) =>
        email === 'jane@example.com' ? { problem: 'Issued to another address' } : { problem: null };

      const el = fillCredentials();
      fillInput(el, '#inviteCode', 'WS-0000-0001');
      tick(INVITE_DEBOUNCE);
      fixture.detectChanges();
      expect(inviteMessage()).toBe('Issued to another address');

      // Nothing touches the invite field here: the code is the same string it always was.
      fillInput(el, '#email', 'jane@other.example');
      tick(INVITE_DEBOUNCE);
      fixture.detectChanges();

      expect(invites.check).toHaveBeenCalledWith('jane@other.example', 'WS-0000-0001');
      expect(inviteMessage()).toBe('Leave blank to create a personal workspace');
    }));

    it('submits the trimmed code once the check accepts it', fakeAsync(() => {
      const el = fillCredentials();
      fillInput(el, '#inviteCode', '  WS-0000-0001  ');
      tick(INVITE_DEBOUNCE);
      fixture.detectChanges();

      submitButton().click();
      fixture.detectChanges();

      expect(auth.signUp).toHaveBeenCalledWith({
        name: 'Jane Smith',
        email: 'jane@example.com',
        password: 'Password1',
        inviteCode: 'WS-0000-0001',
      });
    }));
  });
});
