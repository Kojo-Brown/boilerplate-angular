import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { host, requireEl } from '@/testing';
import type { Announcement } from './live-region.component';
import { announcement, LiveRegionComponent } from './live-region.component';

@Component({
  selector: 'app-live-region-host',
  standalone: true,
  imports: [LiveRegionComponent],
  template: `<app-live-region [announcement]="current()" [politeness]="politeness()" />`,
})
class HostComponent {
  readonly current = signal<Announcement | null>(null);
  readonly politeness = signal<'polite' | 'assertive'>('polite');
}

/** The region element, which exists for the whole life of the component. */
function region(fixture: ComponentFixture<HostComponent>): HTMLElement {
  return requireEl<HTMLElement>(host(fixture), '[aria-live]');
}

/** Wait past the clear-to-announce delay and render what it wrote. */
async function afterAnnounceDelay(fixture: ComponentFixture<HostComponent>): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 150));
  fixture.detectChanges();
}

describe('LiveRegionComponent', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  /**
   * The one that matters most, and the one no visual check would ever catch.
   *
   * A screen reader registers a live region as it enters the accessibility tree and
   * watches it from then on. A region created and filled in the same task is a region
   * that, as far as the reader is concerned, has always said that — and it says nothing.
   */
  it('renders the region empty, before it has anything to announce', () => {
    expect(region(fixture).textContent?.trim()).toBe('');
    expect(region(fixture).getAttribute('aria-live')).toBe('polite');
    expect(region(fixture).getAttribute('aria-atomic')).toBe('true');
  });

  it('announces a message', async () => {
    fixture.componentInstance.current.set(announcement('Posts, page loaded'));
    fixture.detectChanges();

    await afterAnnounceDelay(fixture);

    expect(region(fixture).textContent?.trim()).toBe('Posts, page loaded');
  });

  /**
   * The clear half of clear-then-write, asserted as the DOM state it has to pass through.
   *
   * Without it, writing the same string into the region is not a mutation and therefore
   * not an announcement.
   */
  it('empties the region before writing, so the text is always a change', async () => {
    fixture.componentInstance.current.set(announcement('First'));
    fixture.detectChanges();
    await afterAnnounceDelay(fixture);
    expect(region(fixture).textContent?.trim()).toBe('First');

    fixture.componentInstance.current.set(announcement('Second'));
    fixture.detectChanges();

    expect(region(fixture).textContent?.trim()).toBe('');

    await afterAnnounceDelay(fixture);
    expect(region(fixture).textContent?.trim()).toBe('Second');
  });

  /**
   * The reason {@link Announcement} carries an id.
   *
   * Two navigations onto two rows of the same list resolve to the same title. If the
   * region is driven by the string alone, `input()`'s equality check swallows the second
   * and the visitor hears nothing at all.
   */
  it('announces identical text twice when it arrives as two announcements', async () => {
    const seen: string[] = [];

    fixture.componentInstance.current.set(announcement('Post, page loaded'));
    fixture.detectChanges();
    await afterAnnounceDelay(fixture);
    seen.push(region(fixture).textContent?.trim() ?? '');

    fixture.componentInstance.current.set(announcement('Post, page loaded'));
    fixture.detectChanges();
    expect(region(fixture).textContent?.trim()).toBe('');

    await afterAnnounceDelay(fixture);
    seen.push(region(fixture).textContent?.trim() ?? '');

    expect(seen).toEqual(['Post, page loaded', 'Post, page loaded']);
  });

  /**
   * Superseding, not queueing. Two announcements inside the delay mean the first describes
   * a page the visitor has already left, and reading both in order reports a navigation
   * that was abandoned as though it had completed.
   */
  it('drops an announcement that a newer one overtakes', async () => {
    fixture.componentInstance.current.set(announcement('Overtaken'));
    fixture.detectChanges();
    fixture.componentInstance.current.set(announcement('Current'));
    fixture.detectChanges();

    await afterAnnounceDelay(fixture);

    expect(region(fixture).textContent?.trim()).toBe('Current');
  });

  it('clears the region for an empty message without announcing anything', async () => {
    fixture.componentInstance.current.set(announcement('Something'));
    fixture.detectChanges();
    await afterAnnounceDelay(fixture);

    fixture.componentInstance.current.set(announcement(''));
    fixture.detectChanges();
    await afterAnnounceDelay(fixture);

    expect(region(fixture).textContent?.trim()).toBe('');
  });

  it('exposes the requested politeness', () => {
    fixture.componentInstance.politeness.set('assertive');
    fixture.detectChanges();

    expect(region(fixture).getAttribute('aria-live')).toBe('assertive');
  });

  /**
   * `sr-only` is the clip-rect pattern and not `display: none`, `visibility: hidden` or
   * `aria-hidden`, each of which removes the element from the accessibility tree — which
   * is the tree the announcement is read from. Hidden that way, the region is silent.
   */
  it('hides the region without removing it from the accessibility tree', () => {
    const element = region(fixture);

    expect(element.classList).toContain('sr-only');
    expect(element.hasAttribute('aria-hidden')).toBeFalse();
    expect(element.hasAttribute('hidden')).toBeFalse();
  });

  it('gives consecutive announcements distinct identities', () => {
    expect(announcement('same').id).not.toBe(announcement('same').id);
  });

  /**
   * The timer outlives the component unless something clears it. Destroying the fixture
   * detaches the element but does not discard a `setTimeout` that closes over it, so
   * without the `DestroyRef` teardown the callback still runs and still writes — into a
   * region nothing is listening to, holding the component alive until it fires.
   */
  it('stops a pending announcement when the component is destroyed', async () => {
    fixture.componentInstance.current.set(announcement('Never spoken'));
    fixture.detectChanges();
    const element = region(fixture);
    fixture.destroy();

    await new Promise<void>((resolve) => setTimeout(resolve, 150));

    expect(element.textContent?.trim()).toBe('');
  });
});
