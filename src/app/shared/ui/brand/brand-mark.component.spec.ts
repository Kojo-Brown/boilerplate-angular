import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { BRAND_MARK } from '@/app/core/images';
import { requireEl } from '@/testing';
import { BrandMarkComponent } from './brand-mark.component';

@Component({
  selector: 'app-mark-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandMarkComponent],
  template: `<app-brand-mark [size]="size()" [alt]="alt()" />`,
})
class MarkHostComponent {
  readonly size = signal(28);
  readonly alt = signal('');
}

describe('BrandMarkComponent', () => {
  async function render(): Promise<{
    img: HTMLImageElement;
    fixture: ComponentFixture<MarkHostComponent>;
  }> {
    const fixture = TestBed.createComponent(MarkHostComponent);
    await fixture.whenStable();
    return {
      img: requireEl<HTMLImageElement>(fixture.nativeElement as HTMLElement, 'img'),
      fixture,
    };
  }

  it('resolves src through NgOptimizedImage', async () => {
    const { img } = await render();

    expect(img.getAttribute('src')).toBe(BRAND_MARK.src);
    expect(img.hasAttribute('ngsrc')).toBeFalse();
  });

  it('renders square at the requested size', async () => {
    const { img } = await render();

    expect(img.getAttribute('width')).toBe('28');
    expect(img.getAttribute('height')).toBe('28');
  });

  it('is lazy and unprioritised, because a sidebar mark is never the LCP element', async () => {
    const { img } = await render();

    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('fetchpriority')).toBe('auto');
  });

  it('defaults to an empty alt, for use beside the product name in text', async () => {
    const { img } = await render();

    expect(img.getAttribute('alt')).toBe('');
  });

  it('carries an alt when the caller supplies one', async () => {
    const { img, fixture } = await render();

    fixture.componentInstance.alt.set('Example Inc.');
    await fixture.whenStable();

    expect(img.getAttribute('alt')).toBe('Example Inc.');
  });

  it('keeps the same element when alt changes, rather than recreating the image', async () => {
    // `NgOptimizedImage` refuses a post-init change to `width`, `height` or `priority`
    // (NG02953) because they are written onto the host element once. `alt` is an ordinary
    // binding, and this pins that distinction: a caller may relabel the mark without the
    // browser re-fetching it.
    const { img, fixture } = await render();

    fixture.componentInstance.alt.set('Example Inc.');
    await fixture.whenStable();

    expect(requireEl<HTMLImageElement>(fixture.nativeElement as HTMLElement, 'img')).toBe(img);
  });
});
