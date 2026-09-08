import { TestBed } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import { ReleaseNotesComponent } from './release-notes.component';

describe('ReleaseNotesComponent', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [ReleaseNotesComponent] });
    const fixture = TestBed.createComponent(ReleaseNotesComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('lists the release notes newest first', () => {
    const fixture = create();

    const entries = Array.from(host(fixture).querySelectorAll('li'));
    expect(entries.length).toBeGreaterThan(0);
    const versions = entries.map((entry) => requireEl<HTMLElement>(entry, 'span').textContent);
    expect(versions).toEqual([...versions].sort().reverse());
  });

  it('labels its landmark, so a screen reader can skip it', () => {
    // It is an `aside` that appears four seconds after the page settled. Unlabelled, it
    // is an anonymous complementary region that a user has to enter to identify.
    const fixture = create();

    const aside = requireEl<HTMLElement>(host(fixture), 'aside');
    const labelId = aside.getAttribute('aria-labelledby');
    expect(labelId).not.toBeNull();
    expect(requireEl<HTMLElement>(host(fixture), `#${labelId}`).textContent).toContain(
      "What's new"
    );
  });

  it('removes itself when dismissed', () => {
    const fixture = create();

    requireEl<HTMLButtonElement>(host(fixture), '[data-testid="dismiss-release-notes"]').click();
    fixture.detectChanges();

    expect(host(fixture).querySelector('[data-testid="release-notes"]')).toBeNull();
  });
});
