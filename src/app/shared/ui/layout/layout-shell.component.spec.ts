import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import { LayoutShellComponent } from './layout-shell.component';

function createFixture(brandName = 'App') {
  const fixture = TestBed.createComponent(LayoutShellComponent);
  fixture.componentInstance.brandName = brandName;
  fixture.detectChanges();
  return fixture;
}

describe('LayoutShellComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LayoutShellComponent],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('starts with the mobile drawer closed', () => {
    const fixture = createFixture();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('opens the mobile drawer when toggleDrawer is called', () => {
    const fixture = createFixture();
    fixture.componentInstance.toggleDrawer();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeTrue();
  });

  it('toggles the drawer closed when called a second time', () => {
    const fixture = createFixture();
    fixture.componentInstance.toggleDrawer();
    fixture.componentInstance.toggleDrawer();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('opens drawer when hamburger button is clicked', () => {
    const fixture = createFixture();
    const hamburger = fixture.debugElement.query(
      By.css('[aria-label="Toggle navigation menu"]')
    );
    hamburger.triggerEventHandler('click', null);
    fixture.detectChanges();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeTrue();
  });

  it('closes the drawer when closeDrawer is called', () => {
    const fixture = createFixture();
    fixture.componentInstance.isMobileDrawerOpen.set(true);
    fixture.componentInstance.closeDrawer();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('renders the backdrop when the drawer is open', () => {
    const fixture = createFixture();
    fixture.componentInstance.isMobileDrawerOpen.set(true);
    fixture.detectChanges();
    const backdrop = fixture.debugElement.query(By.css('[data-testid="drawer-backdrop"]'));
    expect(backdrop).toBeTruthy();
  });

  it('does not render the backdrop when the drawer is closed', () => {
    const fixture = createFixture();
    const backdrop = fixture.debugElement.query(By.css('[data-testid="drawer-backdrop"]'));
    expect(backdrop).toBeNull();
  });

  it('closes the drawer when backdrop is clicked', () => {
    const fixture = createFixture();
    fixture.componentInstance.isMobileDrawerOpen.set(true);
    fixture.detectChanges();
    const backdrop = fixture.debugElement.query(By.css('[data-testid="drawer-backdrop"]'));
    backdrop.triggerEventHandler('click', null);
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('closes the drawer when ESC key is pressed', () => {
    const fixture = createFixture();
    fixture.componentInstance.isMobileDrawerOpen.set(true);
    fixture.componentInstance.onEscKey();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('closes the drawer after navigation', async () => {
    const fixture = createFixture();
    fixture.componentInstance.isMobileDrawerOpen.set(true);
    const router = TestBed.inject(Router);
    await router.navigate([]);
    fixture.detectChanges();
    expect(fixture.componentInstance.isMobileDrawerOpen()).toBeFalse();
  });

  it('renders a router-outlet for page content', () => {
    const fixture = createFixture();
    const outlet = fixture.debugElement.query(By.directive(RouterOutlet));
    expect(outlet).toBeTruthy();
  });

  it('displays the brandName in the sidebar header', () => {
    const fixture = createFixture('My App');
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('My App');
  });

  it('renders the close button inside the sidebar on mobile', () => {
    const fixture = createFixture();
    const closeBtn = fixture.debugElement.query(
      By.css('[aria-label="Close navigation menu"]')
    );
    expect(closeBtn).toBeTruthy();
  });
});
