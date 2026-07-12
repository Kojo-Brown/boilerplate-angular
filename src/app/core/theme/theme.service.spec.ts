import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let html: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
    html = TestBed.inject(DOCUMENT).documentElement;
    TestBed.flushEffects();
  });

  afterEach(() => localStorage.clear());

  it('should default to light theme when no preference is stored and system prefers light', () => {
    spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(svc.theme()).toBe('light');
  });

  it('should read stored theme preference from localStorage', () => {
    localStorage.setItem('app_theme', 'dark');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc = TestBed.inject(ThemeService);
    TestBed.flushEffects();
    expect(svc.theme()).toBe('dark');
  });

  it('should apply dark class to html element when theme is dark', () => {
    service.setTheme('dark');
    TestBed.flushEffects();
    expect(html.classList.contains('dark')).toBeTrue();
  });

  it('should remove dark class from html element when theme is light', () => {
    service.setTheme('dark');
    TestBed.flushEffects();
    service.setTheme('light');
    TestBed.flushEffects();
    expect(html.classList.contains('dark')).toBeFalse();
  });

  it('should persist theme to localStorage', () => {
    service.setTheme('dark');
    TestBed.flushEffects();
    expect(localStorage.getItem('app_theme')).toBe('dark');
  });

  it('should toggle from light to dark', () => {
    service.setTheme('light');
    TestBed.flushEffects();
    service.toggle();
    TestBed.flushEffects();
    expect(service.theme()).toBe('dark');
    expect(html.classList.contains('dark')).toBeTrue();
  });

  it('should toggle from dark to light', () => {
    service.setTheme('dark');
    TestBed.flushEffects();
    service.toggle();
    TestBed.flushEffects();
    expect(service.theme()).toBe('light');
    expect(html.classList.contains('dark')).toBeFalse();
  });
});
