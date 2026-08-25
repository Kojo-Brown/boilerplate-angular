import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { createFakeThemePreferenceStore } from '@/testing';
import type { FakeThemePreferenceOptions, FakeThemePreferenceStore } from '@/testing';
import { THEME_PREFERENCE_STORE } from './theme-preference';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let preference: FakeThemePreferenceStore;
  let html: HTMLElement;

  /**
   * The service reads its initial theme while it is being constructed, so a spec that
   * cares about that read has to seed the preference *before* injecting. Every spec goes
   * through here rather than through a `beforeEach`, which is what removed the
   * `TestBed.resetTestingModule()` dance the old version of this suite needed.
   */
  function setup(options: FakeThemePreferenceOptions = {}): void {
    preference = createFakeThemePreferenceStore(options);
    TestBed.configureTestingModule({
      providers: [{ provide: THEME_PREFERENCE_STORE, useValue: preference }],
    });
    service = TestBed.inject(ThemeService);
    html = TestBed.inject(DOCUMENT).documentElement;
    TestBed.tick();
  }

  afterEach(() => html.classList.remove('dark'));

  describe('initial theme', () => {
    it('uses the stored preference when there is one', () => {
      setup({ stored: 'dark', system: 'light' });
      expect(service.theme()).toBe('dark');
    });

    it('falls back to the system preference when nothing is stored', () => {
      setup({ stored: null, system: 'dark' });
      expect(service.theme()).toBe('dark');
    });

    it('does not consult the system preference once a choice is stored', () => {
      setup({ stored: 'light', system: 'dark' });
      expect(service.theme()).toBe('light');
    });
  });

  describe('applying a theme', () => {
    it('adds the dark class to the html element', () => {
      setup({ stored: 'light' });
      service.setTheme('dark');
      TestBed.tick();
      expect(html.classList.contains('dark')).toBeTrue();
    });

    it('removes the dark class again', () => {
      setup({ stored: 'dark' });
      service.setTheme('light');
      TestBed.tick();
      expect(html.classList.contains('dark')).toBeFalse();
    });

    it('persists the theme through the preference store', () => {
      setup({ stored: 'light' });
      service.setTheme('dark');
      TestBed.tick();
      expect(preference.stored).toBe('dark');
    });

    it('toggles from light to dark', () => {
      setup({ stored: 'light' });
      service.toggle();
      TestBed.tick();
      expect(service.theme()).toBe('dark');
      expect(html.classList.contains('dark')).toBeTrue();
    });

    it('toggles from dark to light', () => {
      setup({ stored: 'dark' });
      service.toggle();
      TestBed.tick();
      expect(service.theme()).toBe('light');
      expect(html.classList.contains('dark')).toBeFalse();
    });
  });

  describe('recorded history', () => {
    it('labels each write so the log says what happened, not just that it did', () => {
      setup({ stored: 'light' });
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
      setup({ stored: 'light' });
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
      expect(preference.stored).toBe('light');
    });

    it('redoes what it undid', () => {
      setup({ stored: 'light' });
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
      setup({ stored: 'light' });
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
