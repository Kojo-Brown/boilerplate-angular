import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthFacade } from '@/app/core/auth';
import type { AuthFacadeApi } from '@/app/core/auth';
import { createFakeAuthFacade } from './auth-facade';
import { createMockUser } from './mock-factories';

/**
 * The facade's published surface, as a record so the compiler enforces the list:
 * a member added to `AuthFacadeApi` and not to this object is a type error, and so is a
 * name here that the interface does not have.
 */
const PUBLISHED: Record<keyof AuthFacadeApi, true> = {
  currentUser: true,
  isSignedIn: true,
  isBusy: true,
  errorMessage: true,
  signIn: true,
  signUp: true,
  signOut: true,
  dismissError: true,
};

/** Members of the class that are implementation, and are expected not to be published. */
const PRIVATE_MEMBERS = ['store'];

function surfaceOf(instance: object): string[] {
  const own = Object.keys(instance);
  const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(instance) as object).filter(
    (name) => name !== 'constructor'
  );
  return [...own, ...proto];
}

describe('createFakeAuthFacade', () => {
  describe('substitutability', () => {
    it('answers every member the facade publishes', () => {
      const fake = createFakeAuthFacade() as unknown as Record<string, unknown>;

      const missing = Object.keys(PUBLISHED).filter((member) => !(member in fake));

      expect(missing).toEqual([]);
    });

    /**
     * The direction the type system cannot check: `AuthFacade implements AuthFacadeApi`
     * proves the class has *at least* the interface, never at most. A public member
     * added to the class and left off the interface would be invisible to `FakeAuthFacade`
     * and to every consumer that depends on the narrow shape — which is the whole point
     * of having one.
     */
    it('is the whole of what the facade publishes', () => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });

      const unpublished = surfaceOf(TestBed.inject(AuthFacade)).filter(
        (member) => !(member in PUBLISHED) && !PRIVATE_MEMBERS.includes(member)
      );

      expect(unpublished).toEqual([]);
    });
  });

  describe('defaults', () => {
    it('is signed out, idle and error-free', () => {
      const fake = createFakeAuthFacade();

      expect(fake.isSignedIn()).toBeFalse();
      expect(fake.currentUser()).toBeNull();
      expect(fake.isBusy()).toBeFalse();
      expect(fake.errorMessage()).toBeNull();
    });

    it('is signed in when given a user, because the facade cannot report otherwise', () => {
      const fake = createFakeAuthFacade({ user: createMockUser() });

      expect(fake.isSignedIn()).toBeTrue();
    });

    it('still lets a spec pin the flag on its own', () => {
      expect(
        createFakeAuthFacade({ user: createMockUser(), isSignedIn: false }).isSignedIn()
      ).toBeFalse();
    });
  });

  describe('reads', () => {
    it('are writable signals, so a spec can move them after the first render', () => {
      const fake = createFakeAuthFacade();

      fake.errorMessage.set('Invalid credentials');
      fake.isBusy.set(true);

      expect(fake.errorMessage()).toBe('Invalid credentials');
      expect(fake.isBusy()).toBeTrue();
    });
  });

  describe('commands', () => {
    it('record their arguments', () => {
      const fake = createFakeAuthFacade();

      fake.signIn({ email: 'test@example.com', password: 'password' });

      expect(fake.signIn).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });
  });
});
