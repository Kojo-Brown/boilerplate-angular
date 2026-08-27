import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { DashboardShellComponent } from './dashboard-shell.component';
import { AuthFacade } from '@/app/core/auth';
import { createFakeAuthFacade, createMockUser } from '@/testing';
import type { FakeAuthFacade } from '@/testing';

describe('DashboardShellComponent', () => {
  let auth: FakeAuthFacade;

  /**
   * `resetTestingModule` first so a spec that wants a signed-in user can call this again
   * over the default configured in `beforeEach`, rather than layering a second provider
   * for the same token on top of the first.
   */
  async function setup(facade: FakeAuthFacade = createFakeAuthFacade()): Promise<void> {
    TestBed.resetTestingModule();
    auth = facade;
    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [provideRouter([]), { provide: AuthFacade, useValue: auth }],
    }).compileComponents();
  }

  beforeEach(async () => {
    await setup();
  });

  it('renders nav links for Overview and Posts', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const links = fixture.debugElement.queryAll(By.directive(RouterLink));
    const hrefs = links.map((l) => l.attributes['routerLink']);
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/dashboard/posts');
  });

  it('signs out through the facade when the sign-out button is clicked', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const btns = fixture.debugElement.queryAll(By.css('button'));
    const logoutBtn = btns.find(
      (b) => (b.nativeElement as HTMLButtonElement).textContent?.trim() === 'Sign out'
    );
    if (!logoutBtn) {
      throw new Error('Expected the dashboard shell to render a "Sign out" button.');
    }
    logoutBtn.triggerEventHandler('click', null);
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('renders a router-outlet', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const outlet = fixture.debugElement.query(By.css('router-outlet'));
    expect(outlet).toBeTruthy();
  });

  it('names the signed-in user above the sign-out button', async () => {
    await setup(createFakeAuthFacade({ user: createMockUser({ name: 'Ada Lovelace' }) }));

    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    const footer = fixture.nativeElement as HTMLElement;
    expect(footer.textContent).toContain('Ada Lovelace');
    expect(footer.textContent).toContain('test@example.com');
  });

  it('renders no name block when nobody is signed in', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[sidebar-footer] p'))).toBeNull();
  });
});
