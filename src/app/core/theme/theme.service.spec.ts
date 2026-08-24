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

  // These use `TestBed.tick()`; the specs above still call the deprecated
  // `TestBed.flushEffects()` and are left alone rather than rewritten here.
  describe('recorded history', () => {
    it('labels each write so the log says what happened, not just that it did', () => {
      service.setTheme('dark');
      service.toggle();
      TestBed.tick();

      expect(service.history().map((entry) => entry.label)).toEqual([
        '@@init',
        'theme/set',
        'theme/toggle',
      ]);
    });

    it('undoes a theme change, down to the applied DOM class', () => {
      service.setTheme('light');
      service.setTheme('dark');
      TestBed.tick();
      expect(html.classList.contains('dark')).toBeTrue();

      service.undo();
      TestBed.tick();

      expect(service.theme()).toBe('light');
      // The whole point of time travel over *this* state: the effect re-runs, so the
      // jump is visible in the document and in storage, not only in the signal.
      expect(html.classList.contains('dark')).toBeFalse();
      expect(localStorage.getItem('app_theme')).toBe('light');
    });

    it('redoes what it undid', () => {
      service.setTheme('light');
      service.setTheme('dark');
      TestBed.tick();

      service.undo();
      TestBed.tick();
      service.redo();
      TestBed.tick();

      expect(service.theme()).toBe('dark');
      expect(html.classList.contains('dark')).toBeTrue();
    });

    it('reports whether travel is possible in each direction', () => {
      expect(service.canUndo()).toBeFalse();
      expect(service.canRedo()).toBeFalse();

      service.setTheme('dark');
      TestBed.tick();
      expect(service.canUndo()).toBeTrue();
      expect(service.canRedo()).toBeFalse();

      service.undo();
      TestBed.tick();
      expect(service.canRedo()).toBeTrue();
    });
  });
});
