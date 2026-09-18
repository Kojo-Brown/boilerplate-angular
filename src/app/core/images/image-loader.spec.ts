import { IMAGE_LOADER } from '@angular/common';
import type { ImageLoader } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { createImageLoader, provideAppImageLoader } from './image-loader';

describe('createImageLoader', () => {
  const loader = createImageLoader({ baseUrl: 'https://images.example.test' });

  it('asks the CDN for the requested width, in a modern format', () => {
    const url = new URL(loader({ src: '/img/brand-mark.png', width: 320 }));

    expect(url.origin).toBe('https://images.example.test');
    expect(url.pathname).toBe('/img/brand-mark.png');
    expect(url.searchParams.get('w')).toBe('320');
    expect(url.searchParams.get('fm')).toBe('auto');
    expect(url.searchParams.get('q')).toBe('75');
  });

  it('omits the width parameter when it is not given a width', () => {
    // This is the call `NgOptimizedImage` makes to compute `src` — the candidate a browser
    // that ignores `srcset` will use. A `w=0` here is either an error or a one-pixel image.
    const url = new URL(loader({ src: 'img/brand-mark.png' }));

    expect(url.searchParams.has('w')).toBeFalse();
    expect(url.pathname).toBe('/img/brand-mark.png');
  });

  it('rounds a fractional width rather than passing it through', () => {
    // Density descriptors multiply the declared width, so `width="33"` at 1.5x arrives here
    // as 49.5. A CDN handed that either 400s or, worse, treats it as a cache-busting
    // variant of the integer it rounds to internally.
    const url = new URL(loader({ src: 'a.png', width: 49.5 }));

    expect(url.searchParams.get('w')).toBe('50');
  });

  it('joins a root-relative source to the base with exactly one slash', () => {
    // Both spellings a template might use have to land on the same CDN path, or the CDN
    // caches two entries for one image.
    expect(loader({ src: '/img/a.png', width: 10 })).toContain(
      'https://images.example.test/img/a.png?'
    );
    expect(loader({ src: 'img/a.png', width: 10 })).toContain(
      'https://images.example.test/img/a.png?'
    );
  });

  it('treats a source beginning with two slashes as protocol-relative, not as a path', () => {
    // `//host/path` is a URL with the scheme left to the document, so it is somebody else's
    // origin and must not be rewritten — and by the same rule `///img/a.png` is a
    // protocol-relative URL with an empty host rather than an over-slashed local path.
    // Guessing the other way would silently point a CDN request at our own origin.
    expect(loader({ src: '///img/a.png', width: 10 })).toBe('///img/a.png');
  });

  it('strips a trailing slash from the configured base URL', () => {
    const trailing = createImageLoader({ baseUrl: 'https://images.example.test/assets/' });

    expect(trailing({ src: 'a.png', width: 10 })).toContain(
      'https://images.example.test/assets/a.png?'
    );
  });

  it('returns an absolute source unchanged', () => {
    // Rewriting it would ask our CDN for a path it has never heard of, and would turn this
    // application into an open image proxy for any URL a caller binds.
    const src = 'https://other.example.test/photo.jpg';

    expect(loader({ src, width: 640 })).toBe(src);
  });

  it('returns a protocol-relative source unchanged', () => {
    const src = '//other.example.test/photo.jpg';

    expect(loader({ src, width: 640 })).toBe(src);
  });

  it('returns a data URI unchanged', () => {
    const src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

    expect(loader({ src, width: 640 })).toBe(src);
  });

  it('requests a placeholder at the placeholder width and a lower quality', () => {
    const url = new URL(loader({ src: 'a.png', width: 640, isPlaceholder: true }));

    expect(url.searchParams.get('w')).toBe('30');
    expect(Number(url.searchParams.get('q'))).toBeLessThan(75);
  });

  it('never raises quality for a placeholder above the configured quality', () => {
    const frugal = createImageLoader({ baseUrl: 'https://images.example.test', quality: 25 });
    const url = new URL(frugal({ src: 'a.png', isPlaceholder: true }));

    expect(url.searchParams.get('q')).toBe('25');
  });

  it('passes a fit through to the CDN', () => {
    const url = new URL(loader({ src: 'a.png', width: 64, loaderParams: { fit: 'cover' } }));

    expect(url.searchParams.get('fit')).toBe('cover');
  });

  it('omits fit when the caller does not ask for one', () => {
    const url = new URL(loader({ src: 'a.png', width: 64, loaderParams: {} }));

    expect(url.searchParams.has('fit')).toBeFalse();
  });

  it('falls back to the defaults when an option is explicitly undefined', () => {
    // The shape a caller assembling options from a config object produces —
    // `{ baseUrl, format: cfg.format }` with nothing configured. The types allow it, and
    // an object spread over the defaults would copy the undefined straight through and put
    // `fm=undefined&q=undefined` in every URL the CDN is asked for.
    const sparse = createImageLoader({
      baseUrl: 'https://images.example.test',
      format: undefined,
      quality: undefined,
      placeholderWidth: undefined,
    });
    const url = new URL(sparse({ src: 'a.png', width: 64 }));

    expect(url.searchParams.get('fm')).toBe('auto');
    expect(url.searchParams.get('q')).toBe('75');
    expect(new URL(sparse({ src: 'a.png', isPlaceholder: true })).searchParams.get('w')).toBe('30');
  });

  it('honours a configured format and quality', () => {
    const configured = createImageLoader({
      baseUrl: 'https://images.example.test',
      format: 'webp',
      quality: 90,
    });
    const url = new URL(configured({ src: 'a.png', width: 64 }));

    expect(url.searchParams.get('fm')).toBe('webp');
    expect(url.searchParams.get('q')).toBe('90');
  });
});

describe('provideAppImageLoader', () => {
  /** What `inject(IMAGE_LOADER)` resolves to with nothing provided: Angular's own no-op. */
  function defaultLoader(): ImageLoader {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    return TestBed.inject(IMAGE_LOADER);
  }

  it('provides nothing at all when no CDN is configured', () => {
    expect(provideAppImageLoader('')).toEqual([]);
  });

  it('leaves Angular’s own no-op loader in place when no CDN is configured', () => {
    // Identity, not behaviour, is the assertion, and `noopImageLoader` is not exported —
    // so this compares against whatever the token's default factory returns.
    // `NgOptimizedImage` decides whether to emit a `srcset` by comparing the injected
    // loader against that function with `!==`. A pass-through loader of ours would pass
    // every behavioural test above and still make the directive emit
    // `a.png 1x, a.png 2x` from a loader that ignores width — two identical files, one of
    // them claimed to be twice the density.
    const expected = defaultLoader();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideAppImageLoader('')] });

    expect(TestBed.inject(IMAGE_LOADER)).toBe(expected);
  });

  it('provides a CDN loader when one is configured', () => {
    const noop = defaultLoader();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideAppImageLoader('https://images.example.test')],
    });
    const loader = TestBed.inject(IMAGE_LOADER);

    expect(loader).not.toBe(noop);
    expect(loader({ src: 'a.png', width: 64 })).toContain('https://images.example.test/a.png?w=64');
  });
});
