import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, RouterLink } from '@angular/router';
import { DashboardShellComponent } from './dashboard-shell.component';
import { AuthStore } from '@/app/store/auth/auth.store';

describe('DashboardShellComponent', () => {
  const mockAuthStore = {
    logout: jasmine.createSpy('logout'),
    isAuthenticated: () => true,
    isAdmin: () => false,
    currentUser: () => null,
    userRole: () => null,
    isLoading: () => false,
    error: () => null,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardShellComponent],
      providers: [
        provideRouter([]),
        { provide: AuthStore, useValue: mockAuthStore },
      ],
    }).compileComponents();
  });

  it('renders nav links for Overview and Posts', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const links = fixture.debugElement.queryAll(By.directive(RouterLink));
    const hrefs = links.map((l) => l.attributes['routerLink']);
    expect(hrefs).toContain('/dashboard');
    expect(hrefs).toContain('/dashboard/posts');
  });

  it('calls authStore.logout() when sign-out button is clicked', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const btns = fixture.debugElement.queryAll(By.css('button'));
    const logoutBtn = btns.find(
      (b) => (b.nativeElement as HTMLButtonElement).textContent?.trim() === 'Sign out'
    );
    expect(logoutBtn).toBeTruthy();
    logoutBtn!.triggerEventHandler('click', null);
    expect(mockAuthStore.logout).toHaveBeenCalled();
  });

  it('renders a router-outlet', () => {
    const fixture = TestBed.createComponent(DashboardShellComponent);
    fixture.detectChanges();
    const outlet = fixture.debugElement.query(By.css('router-outlet'));
    expect(outlet).toBeTruthy();
  });
});
