import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AUTH_BANNER } from '@/app/core/images';
import { requireEl } from '@/testing';
import { BrandBannerComponent } from './brand-banner.component';

@Component({
  selector: 'app-banner-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BrandBannerComponent],
  template: `<app-brand-banner />`,
})
class BannerHostComponent {}

describe('BrandBannerComponent', () => {
  async function render(): Promise<HTMLImageElement> {
    const fixture = TestBed.createComponent(BannerHostComponent);
    await fixture.whenStable();
    return requireEl<HTMLImageElement>(fixture.nativeElement as HTMLElement, 'img');
  }

  it('resolves src through NgOptimizedImage rather than leaving a literal ngsrc attribute', async () => {
    // The failure this guards is silent: with the directive missing from `imports` nothing
    // matches `ngSrc`, Angular emits `ngsrc="…"` as a plain attribute, and no `src` is ever
    // set. Asserting on `src` — not on `ngSrc` — is what tells the two apart.
    const img = await render();

    expect(img.getAttribute('src')).toBe(AUTH_BANNER.src);
    expect(img.hasAttribute('ngsrc')).toBeFalse();
  });

  it('declares the dimensions the fixture is generated at, so the box is reserved', async () => {
    const img = await render();

    expect(img.getAttribute('width')).toBe(String(AUTH_BANNER.renderedWidth));
    expect(img.getAttribute('height')).toBe(String(AUTH_BANNER.renderedHeight));
  });

  it('asks the browser to fetch it in the first wave', async () => {
    // What `priority` actually does, rather than that the input is set: anything less
    // would pass with the attribute present and the directive absent.
    const img = await render();

    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('decoding')).toBe('sync');
  });

  it('emits no srcset when no image CDN is configured', async () => {
    // With the token's default no-op loader in place there are no density variants to
    // offer, and offering them anyway would advertise the same file twice at two
    // densities. `image-loader.spec.ts` covers why a pass-through loader breaks this.
    const img = await render();

    expect(img.hasAttribute('srcset')).toBeFalse();
  });

  it('is decorative, so it contributes nothing to the accessibility tree', async () => {
    const img = await render();

    expect(img.getAttribute('alt')).toBe('');
  });
});
