import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemeToggleComponent } from './theme-toggle.component';
import { ThemeService } from '@/app/core/theme/theme.service';

describe('ThemeToggleComponent', () => {
  let fixture: ComponentFixture<ThemeToggleComponent>;
  let themeService: ThemeService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ThemeToggleComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeToggleComponent);
    themeService = TestBed.inject(ThemeService);
    fixture.detectChanges();
  });

  afterEach(() => localStorage.clear());

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('should show moon icon when theme is light', () => {
    themeService.setTheme('light');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Switch to dark mode');
  });

  it('should show sun icon when theme is dark', () => {
    themeService.setTheme('dark');
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Switch to light mode');
  });

  it('should call themeService.toggle() when button is clicked', () => {
    spyOn(themeService, 'toggle');
    const button = fixture.nativeElement.querySelector('button');
    button.click();
    expect(themeService.toggle).toHaveBeenCalled();
  });
});
