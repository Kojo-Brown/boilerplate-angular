import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import type { ActivityEntry } from './activity-widget.component';
import { ActivityWidgetComponent } from './activity-widget.component';

const ENTRIES: readonly ActivityEntry[] = [
  { id: 'a1', actor: 'Ama', action: 'published a post', minutesAgo: 4 },
  { id: 'a2', actor: 'Kwesi', action: 'invited two teammates', minutesAgo: 21 },
  { id: 'a3', actor: 'Yaa', action: 'closed an invoice', minutesAgo: 55 },
];

describe('ActivityWidgetComponent', () => {
  let fixture: ComponentFixture<ActivityWidgetComponent>;

  const rows = (): HTMLElement[] => Array.from(host(fixture).querySelectorAll('li'));

  beforeEach(() => {
    fixture = TestBed.createComponent(ActivityWidgetComponent);
    fixture.componentRef.setInput('entries', ENTRIES);
    fixture.detectChanges();
  });

  it('lists every entry when the limit exceeds the feed', () => {
    expect(rows().length).toBe(3);
    expect(rows()[0].textContent).toContain('Ama');
    expect(rows()[0].textContent).toContain('4m ago');
  });

  it('accepts a string limit, because the input carries numberAttribute', () => {
    fixture.componentRef.setInput('limit', '2');
    fixture.detectChanges();

    expect(fixture.componentInstance.limit()).toBe(2);
    expect(rows().length).toBe(2);
  });

  it('treats a negative limit as none rather than slicing from the end', () => {
    // `slice(0, -1)` would drop the *last* entry — a limit of -1 showing two rows.
    fixture.componentRef.setInput('limit', -1);
    fixture.detectChanges();

    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain('Nothing yet.');
  });

  it('shows the empty state for an empty feed', () => {
    fixture.componentRef.setInput('entries', []);
    fixture.detectChanges();

    expect(host(fixture).textContent).toContain('Nothing yet.');
  });

  it('emits the entry id that was chosen', () => {
    const emitted: string[] = [];
    fixture.componentInstance.select.subscribe((value) => emitted.push(value));

    requireEl<HTMLButtonElement>(rows()[1], 'button').click();

    expect(emitted).toEqual(['a2']);
  });

  it('hides the feed when collapsed', () => {
    requireEl<HTMLButtonElement>(host(fixture), 'header button').click();
    fixture.detectChanges();

    expect(rows().length).toBe(0);
    expect(fixture.componentInstance.collapsed()).toBeTrue();
  });
});
