import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AUTH_BANNER } from '@/app/core/images';

/**
 * The banner across the top of the sign-in and registration cards — and the one image in
 * this application that is genuinely a Largest Contentful Paint candidate.
 *
 * ## What `priority` claims, and why it is true here and nowhere else
 *
 * `priority` asserts that this element is the largest one painted in the first frame.
 * Angular acts on it by setting `loading="eager"`, `fetchpriority="high"` and
 * `decoding="sync"`, and — during server rendering — emitting a `<link rel="preload">` into
 * the `<head>`. On a prerendered page that last part is the whole win: the request leaves
 * from the static HTML, before the parser has reached this tag and long before any
 * JavaScript runs.
 *
 * `/login` and `/register` are prerendered (`app.routes.server.ts`) and the card is all
 * there is on them. At 448×168 this banner covers ~75,000 CSS pixels² against roughly
 * 18,000 for the heading below it, so it is the largest element by a wide margin on both.
 * That is the reasoning `priority` needs, and it does not generalise — which is why this
 * is a separate component from `BrandMarkComponent` with `priority` baked in rather than a
 * shared component with a flag, and why `assert-image-hygiene.mjs` refuses a `priority`
 * image inside `@for` or `@defer`.
 *
 * ## Why fixed dimensions rather than `fill`
 *
 * The card is `max-w-md`, so the banner's rendered width is capped at 448 CSS pixels and
 * known at build time. Declaring it lets the browser reserve a correctly-proportioned box
 * from the HTML, which is what keeps the heading below from jumping when the image decodes
 * — and with an image CDN configured, the directive emits a 1×/2× density `srcset`, the
 * right shape for a fixed-size image. `fill` plus `sizes` would be the answer for a
 * banner that actually spanned the viewport; this one does not.
 *
 * The image is decorative: the heading beside it carries the page's meaning, so `alt` is
 * empty rather than a description of a gradient.
 *
 * @see [`docs/images.md`](../../../../../docs/images.md)
 */
@Component({
  selector: 'app-brand-banner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <img
      [ngSrc]="banner.src"
      [width]="banner.renderedWidth"
      [height]="banner.renderedHeight"
      priority
      alt=""
      class="h-auto w-full rounded-[var(--radius)] object-cover"
    />
  `,
})
export class BrandBannerComponent {
  protected readonly banner = AUTH_BANNER;
}
