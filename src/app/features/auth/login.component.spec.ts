import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import type { ComponentFixture, DeferBlockFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthFacade } from '@/app/core/auth';
import { createFakeAuthFacade, host, settleUntil } from '@/testing';
import type { FakeAuthFacade } from '@/testing';

/**
 * The page around the form: what a visitor sees before the sign-in block hydrates, and
 * what happens once they are signed in. The form's own behaviour is
 * `login-form.component.spec.ts`.
 *
 * Every fixture here is client-rendered, so the `hydrate on interaction` trigger never
 * applies — there is no dehydrated markup in a `TestBed`. What the block falls back to is
 * the compiler's implicit `on idle`, which is why these specs drive the block explicitly
 * rather than waiting for one.
 */
describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let auth: FakeAuthFacade;
  let navigateByUrl: jasmine.Spy;

  function create(
    deferBlockBehavior = DeferBlockBehavior.Manual
  ): ComponentFixture<LoginComponent> {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      deferBlockBehavior,
      // A real Router (not a stub) so `routerLink` can build hrefs — RouterLink calls
      // `createUrlTree`/`serializeUrl`, which a hand-rolled spy object does not implement.
      providers: [{ provide: AuthFacade, useValue: auth }, provideRouter([])],
    });
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl');
    const created = TestBed.createComponent(LoginComponent);
    created.detectChanges();
    return created;
  }

  beforeEach(() => {
    auth = createFakeAuthFacade();
  });

  /** The default fixture: manual defer triggers, so a spec says when the block renders. */
  function manual(): void {
    fixture = create();
  }

  it('should create', () => {
    manual();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the heading without waiting for the form', () => {
    manual();
    // The point of the split: everything here is in the prerendered, already-hydrated
    // part of the page, so it is readable while the block is still dehydrated.
    expect(host(fixture).querySelector('h1')?.textContent?.trim()).toBe('Welcome back');
  });

  it('should display the error the facade reports', () => {
    manual();
    auth.errorMessage.set('Invalid credentials');
    fixture.detectChanges();
    expect(host(fixture).querySelector('[role="alert"]')?.textContent?.trim()).toContain(
      'Invalid credentials'
    );
  });

  it('should have a link to the register page', () => {
    manual();
    expect(host(fixture).querySelector<HTMLAnchorElement>('a[href="/register"]')).toBeTruthy();
  });

  it('should navigate to the dashboard once authenticated', () => {
    manual();
    expect(navigateByUrl).not.toHaveBeenCalled();
    auth.isSignedIn.set(true);
    fixture.detectChanges();
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  describe('the deferred sign-in block', () => {
    async function only(): Promise<DeferBlockFixture> {
      manual();
      const blocks = await fixture.getDeferBlocks();
      // A second block would make "the sign-in block" ambiguous — `@defer` blocks have no
      // names, so index is the only handle and a new one silently shifts it.
      expect(blocks.length).withContext('LoginComponent should defer exactly one block').toBe(1);
      return blocks[0];
    }

    it('holds the form back until the block renders', async () => {
      const block = await only();
      expect(host(fixture).querySelector('app-login-form')).toBeNull();

      await block.render(DeferBlockState.Complete);
      expect(host(fixture).querySelector('app-login-form')).toBeTruthy();
    });

    it('resolves to the real form component', async () => {
      const block = await only();
      await block.render(DeferBlockState.Complete);

      const el = host(fixture);
      expect(el.querySelector('#email')).toBeTruthy();
      expect(el.querySelector('#password')).toBeTruthy();
    });

    /**
     * With `Playthrough` the block behaves as it would in a browser — which on a
     * client-rendered page means the implicit `on idle` the compiler adds, because a
     * block declaring only `hydrate` triggers would otherwise have none. That fallback is
     * what keeps `/login` working when it is navigated to from inside the app rather than
     * loaded cold.
     */
    it('loads on its own when nothing is hydrating', async () => {
      fixture = create(DeferBlockBehavior.Playthrough);

      // `settleUntil` rather than `whenStable`: `on idle` is scheduled through
      // `requestIdleCallback`, which registers no `PendingTask` for Angular to be stable
      // about — so the wait is for the outcome, not for the framework's idea of quiet.
      await settleUntil(fixture, () => host(fixture).querySelector('app-login-form') !== null);

      expect(host(fixture).querySelector('app-login-form')).toBeTruthy();
    });
  });
});
