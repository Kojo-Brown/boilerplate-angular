import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { BRAND_MARK } from '@/app/core/images';

/**
 * The product mark, as an `<img>` under `NgOptimizedImage`.
 *
 * Small, fixed-size and **lazy**, which is the ordinary case and the one worth having a
 * component for. The attributes easiest to get subtly wrong in a copied tag are exactly the
 * ones here: the `width`/`height` pair that lets the browser reserve the box before the
 * bytes arrive, and the intrinsic size the file is generated at. Taking the source from
 * {@link BRAND_MARK} means a regenerated fixture at a different resolution breaks a spec
 * rather than a page.
 *
 * It is deliberately not `priority`. `priority` claims the element is the largest one
 * painted in the first frame, and a 28-pixel mark in a sidebar is never that — the claim
 * would cost the page a high-priority request competing with whatever the real largest
 * element is. {@link file://./brand-banner.component.ts | BrandBannerComponent} is the
 * image on the two pages where that claim is true.
 *
 * `alt` is empty by default, which is correct wherever the mark sits beside the product
 * name in text: a screen reader that read both would say it twice. A caller that draws the
 * mark *instead of* the name supplies one.
 *
 * @see [`docs/images.md`](../../../../../docs/images.md)
 */
@Component({
  selector: 'app-brand-mark',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <img
      [ngSrc]="src"
      [width]="size()"
      [height]="size()"
      [alt]="alt()"
      class="rounded-[var(--radius)]"
    />
  `,
})
export class BrandMarkComponent {
  /** Rendered size in CSS pixels, square. */
  readonly size = input(28);

  /** Alternative text; empty when the product name is already in text beside it. */
  readonly alt = input('');

  protected readonly src = BRAND_MARK.src;
}
