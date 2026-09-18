import { IMAGE_LOADER } from '@angular/common';
import type { ImageLoader, ImageLoaderConfig } from '@angular/common';
import type { Provider } from '@angular/core';

/**
 * What an image CDN is asked for, beyond a width.
 *
 * `NgOptimizedImage` passes `loaderParams` through untouched, so this is the one place a
 * caller can reach the CDN's own vocabulary. It is typed rather than `Record<string,
 * unknown>` because a mistyped key is silently ignored by every CDN on the market: the
 * image comes back uncropped and nothing reports it.
 */
export interface AppImageLoaderParams {
  /**
   * How the image fills the requested box when its aspect ratio differs.
   *
   * `cover` crops, which is what an avatar in a circular frame wants. `contain` letterboxes.
   */
  readonly fit?: 'cover' | 'contain';
}

/** How {@link createImageLoader} builds a URL. */
export interface ImageLoaderOptions {
  /**
   * Origin and optional path prefix the CDN serves from, without a trailing slash —
   * `https://images.example.test` or `https://cdn.example.test/assets`.
   */
  readonly baseUrl: string;
  /**
   * Value for the format parameter. `auto` lets the CDN pick AVIF or WebP from the
   * request's `Accept` header, which is the whole reason to route images through one:
   * negotiating a modern format per browser is not something a checked-in `.png` can do.
   */
  readonly format?: string;
  /** Compression quality, 1–100. */
  readonly quality?: number;
  /**
   * Width, in pixels, requested for a blur-up placeholder.
   *
   * Small on purpose: a placeholder is inlined into a `background-image` before the real
   * image arrives, so every byte of it is on the critical path. Angular's own
   * `IMAGE_CONFIG.placeholderResolution` default is 30.
   */
  readonly placeholderWidth?: number;
}

const DEFAULT_OPTIONS = {
  format: 'auto',
  quality: 75,
  placeholderWidth: 30,
} as const;

/** Sources a loader must hand back untouched. */
const ABSOLUTE_OR_INLINE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Build an `IMAGE_LOADER` function for a CDN that takes its parameters in the query string.
 *
 * The shape — `?w=…&fm=…&q=…` — is what Imgix, ImageKit, Cloudinary's fetch API and
 * Netlify Image CDN all accept some spelling of, and Angular ships built-in loaders for
 * those four. This is for the case those do not cover: an in-house transform service, a
 * CloudFront distribution in front of one, or a self-hosted `imgproxy`. Point
 * `environment.imageCdnUrl` at a CDN Angular already knows and the framework warns you
 * (NG02962) to use its loader instead of this one.
 *
 * Two behaviours are worth stating because getting either wrong is silent:
 *
 *   - **An absolute or inline source is returned unchanged.** Rewriting `https://…` would
 *     ask our CDN for a path it does not have, and a `data:` URI would be mangled into a
 *     URL. It also stops this application from becoming an open image proxy for any
 *     third-party URL a caller happens to bind.
 *   - **A request with no width omits the width parameter** rather than sending `w=0` or
 *     `w=undefined`. `NgOptimizedImage` calls the loader once with no width to compute
 *     `src` — the fallback the browser uses when it ignores `srcset` — and a CDN handed a
 *     zero width answers with either an error or a 1-pixel image.
 */
export function createImageLoader(options: ImageLoaderOptions): ImageLoader {
  const { format, quality, placeholderWidth } = { ...DEFAULT_OPTIONS, ...options };
  const base = options.baseUrl.replace(/\/+$/, '');

  return (config: ImageLoaderConfig): string => {
    if (ABSOLUTE_OR_INLINE.test(config.src)) return config.src;

    const params = new URLSearchParams();

    // A placeholder's width is the placeholder's, not the layout's: Angular asks for one by
    // passing `isPlaceholder` alongside `IMAGE_CONFIG.placeholderResolution`, and a caller
    // that has configured a different resolution here should get that one.
    const width = config.isPlaceholder ? placeholderWidth : config.width;
    if (typeof width === 'number' && width > 0) {
      params.set('w', String(Math.round(width)));
    }

    params.set('fm', format);
    // A blurred 30-pixel square does not need 75% quality, and the placeholder is the one
    // request that is unambiguously on the critical path.
    params.set('q', String(config.isPlaceholder ? Math.min(quality, 40) : quality));

    const fit = (config.loaderParams as AppImageLoaderParams | undefined)?.fit;
    if (fit) params.set('fit', fit);

    return `${base}/${config.src.replace(/^\/+/, '')}?${params.toString()}`;
  };
}

/**
 * Wire {@link createImageLoader} when an image CDN is configured, and nothing when it is not.
 *
 * ## Why "nothing" rather than a pass-through loader
 *
 * `environment.imageCdnUrl` is empty in both checked-in builds, for the reason
 * `environment.vitalsUrl` is: a boilerplate has no CDN to name, and a default that guessed
 * at one would route every downstream application's images through somewhere its author
 * never chose. Images then come from `public/` on the application's own origin.
 *
 * The tempting way to write that is a loader that returns `config.src` unchanged. It is
 * wrong, and wrong in a way nothing reports. `NgOptimizedImage` decides whether to generate
 * a `srcset` by comparing the injected loader against its own `noopImageLoader` *by
 * identity*. A pass-through of ours is not that function, so the directive concludes a CDN
 * is present and emits a density `srcset` — `img.png 1x, img.png 2x` — from a loader that
 * ignores the width it was given. Both candidates are the same file, so a 2× display
 * downloads a 1× asset while being told it is 2×. Providing no loader at all leaves the
 * token's default factory in place, the identity check succeeds, and the directive
 * correctly emits `src` alone.
 *
 * Which is why this returns an empty provider array rather than a loader, and why the
 * branch is a comparison against a build-time constant: the bundler drops
 * `createImageLoader` from a build that has no CDN configured.
 *
 * @see [`docs/images.md`](../../../../docs/images.md)
 */
export function provideAppImageLoader(imageCdnUrl: string): Provider[] {
  if (imageCdnUrl === '') return [];
  return [{ provide: IMAGE_LOADER, useValue: createImageLoader({ baseUrl: imageCdnUrl }) }];
}
