# Images

Every `<img>` in this application goes through `NgOptimizedImage`, there is one `priority`
image and it is on the two prerendered routes, and a CI gate refuses a tag that opts out.
This document is why each of those is a rule rather than a habit.

## What the directive is for

`NgOptimizedImage` matches on `ngSrc`. That is the whole opt-in mechanism, and it is worth
saying plainly: an `<img src="…">` is not optimised, and nothing tells you. What you give
up divides neatly along the two loading metrics this repository already measures in the
field (see [`docs/web-vitals.md`](./web-vitals.md)):

**CLS.** An `<img>` with no `width`/`height` has no aspect ratio until its bytes arrive, so
the browser lays out the page around a zero-height box and reflows everything below when
the image decodes. The directive makes both attributes mandatory and writes them onto the
element, which is what lets the browser reserve the space. `fill` is the opt-out, for an
image sized entirely by CSS.

**LCP.** The largest image on the page should be requested in the first wave and every
other image should not be. `priority` says which. Angular acts on it by setting
`loading="eager"`, `fetchpriority="high"` and `decoding="sync"` — and, during server
rendering, emitting a `<link rel="preload" as="image">` into the `<head>`. Everything
without it gets `loading="lazy"`.

Angular checks a good deal of this itself, at runtime, in development, in the component
that happens to be rendering. That is weaker than it sounds: a missing `width` throws only
from a render that reaches the element, so an `<img>` on a route no spec exercises ships
fine. `scripts/ci/assert-image-hygiene.mjs` asserts the same policy against every template,
once, in CI.

## The three images, and why each is loaded the way it is

### `/login` and `/register`: the banner, `priority`

`BrandBannerComponent` is the one genuine Largest Contentful Paint candidate here. At
448×168 it covers roughly 75,000 CSS pixels² against about 18,000 for the heading beneath
it, so it is the largest element on both pages by a wide margin — and both routes are
prerendered (`app.routes.server.ts`), which is what makes `priority` pay rather than merely
sound careful. The preload link goes into static HTML, so the request leaves before the
parser has reached the tag and long before any JavaScript runs.

That link is the part nothing else can check. `PreloadLinkCreator` runs on the server only,
so no browser-run spec can see it; `assert-ssr.mjs` reads the prerendered `index.html` for
both routes and asserts the `<img>` is there, that it is eager, and that the link exists.

Dimensions are declared rather than `fill`, because the card is `max-w-md` and the rendered
width is therefore known at build time. `fill` plus `sizes` would be right for a banner
that actually spanned the viewport; this one does not.

### The sidebar: the mark, lazy

`BrandMarkComponent` is 28 pixels square in the shell's sidebar header. It is deliberately
**not** `priority`, and that is the point of it being a separate component rather than
`BrandBannerComponent` with a flag: `priority` is a claim about a specific page, a shared
component cannot make it on a caller's behalf, and a `priority` image that is not the LCP
element is actively harmful — its high-priority request competes with whatever the real
largest element is.

### The insights panel: avatars, lazy, inside a `@for`

One avatar per author row in `insights-panel.component.ts`, and the place where this half of
the work meets the other half. The rows are keyed `track tally.authorId`. Keyed by anything
unstable — object identity against the TanStack refetch, or `$index` — every row would be
destroyed and rebuilt on each refetch, and because a fresh `<img>` element has never had a
`src`, **every avatar would be requested again**. The rendered page would look identical.
[`docs/track-expressions.md`](./track-expressions.md) is the argument in full; this is the
symptom that makes it concrete.

`avatarUrl` is resolved onto the row in `tallyByAuthor` rather than called from the
template, so the URL is a property of the data the block is keyed on.

## The loader, and the pass-through trap

`environment.imageCdnUrl` is empty in both checked-in builds, for the reason `vitalsUrl` is:
a boilerplate has no CDN to name, and a default that guessed at one would route every
downstream application's images through somewhere its author never chose. Images come from
`public/` on the application's own origin.

The obvious way to express "no CDN" is a loader that returns `config.src` unchanged. **It is
wrong, and wrong silently.** `NgOptimizedImage` decides whether to generate a `srcset` by
comparing the injected loader against its own `noopImageLoader` *by identity*:

```js
// @angular/common
return !this.disableOptimizedSrcset && !this.srcset && this.imageLoader !== noopImageLoader && !oversizedImage;
```

A pass-through of ours is not that function, so the directive concludes a CDN is present and
emits a density `srcset` — `img.png 1x, img.png 2x` — from a loader that ignores the width
it was handed. Both candidates are the same file, so a 2× display downloads a 1× asset while
being told it is 2×.

So `provideAppImageLoader('')` returns an **empty provider array**. The token's default
factory stays in place, the identity check succeeds, and the directive correctly emits `src`
alone. `image-loader.spec.ts` asserts that by identity rather than by behaviour, because
behaviour is exactly what a pass-through would get right.

Point `imageCdnUrl` at a real service and `createImageLoader` builds `?w=…&fm=auto&q=75`,
the shape Imgix, ImageKit, Cloudinary's fetch API and `imgproxy` all accept some spelling
of. Two of its behaviours are load-bearing and neither is obvious:

- **An absolute, protocol-relative or `data:` source is returned unchanged.** Rewriting
  `https://…` would ask our CDN for a path it does not have, and it would turn this
  application into an open image proxy for any URL a caller binds. By the same rule
  `///img/a.png` is a protocol-relative URL with an empty host, not an over-slashed local
  path, and is left alone.
- **A request with no width omits `w` entirely.** The directive calls the loader once with
  no width to compute `src` — the candidate a browser that ignores `srcset` uses — and a CDN
  handed `w=0` answers with an error or a one-pixel image.

Angular ships built-in loaders for Imgix, ImageKit, Cloudinary and Netlify, and warns
(NG02962) if you point a custom loader at one of those hosts. Use the built-in; this is for
an in-house transform service, a CloudFront distribution in front of one, or self-hosted
`imgproxy`.

If you do configure a cross-origin CDN, add a `<link rel="preconnect">` for it to
`src/index.html`. Angular's `PreconnectLinkChecker` warns about a `priority` image on an
origin with no preconnect, and it is right to: the DNS and TLS handshake in front of the
preload undoes most of what the preload bought.

## The gate

`scripts/ci/assert-image-hygiene.mjs` parses every component template with the Angular
compiler's own parser and enforces six rules:

1. **`ngSrc`, never `src`/`srcset`.** Using `src` opts out of everything above, silently.
2. **`NgOptimizedImage` in the component's `imports`.** The rule with the sharpest teeth,
   because `ngSrc` is an *attribute*: with the directive missing nothing matches it, Angular
   emits a literal `ngsrc` on the element, no `src` is ever set, and the image is simply
   broken — with no compiler error, no lint error and no runtime warning. A bound `[ngSrc]`
   would at least fail to compile; the static form is the trap. It is also why every spec
   here asserts on `src` rather than on `ngSrc`.
3. **`width` and `height`, or `fill`** — never both, never neither.
4. **`alt`.** `alt=""` is accepted and is the right answer for decoration. What is rejected
   is not having decided.
5. **`priority` is not inside `@for` or `@defer`** (placeholder and loading views
   included). A structural claim rather than an attribute one, and where the gate earns the
   template AST. An image repeated over a collection is not the LCP element — `priority` on
   a row preloads every row, which is the opposite of prioritising — and an image inside a
   `@defer` block cannot be, since the block's chunk is fetched after the first paint.
6. **At most one `priority` image per template.** There is one largest element. Angular
   warns past ten, which catches wholesale misuse and not the second one.

Every rule is proved against a fixture written to provoke it, by the gate itself, on every
run, before it certifies anything. Nothing under `scripts/` is in Karma's build graph, so a
rule that had stopped firing would otherwise pass the repository quietly.

**What the gate cannot see:** a component that wraps an `<img>` and is then used inside a
`@for` elsewhere. `<app-brand-banner />` inside a repeated row would be a `priority` image
per row, and rule 5 would not fire, because the two templates are two independent checks.
Rule 6's per-template scope has the same edge.

## The fixtures

`public/img/` holds eight generated PNGs. They exist because `NgOptimizedImage` reads
intrinsic dimensions off the decoded image to check them against the declared
`width`/`height`, and a broken `<img>` reports no intrinsic size at all — so the directive
cannot be demonstrated, gated or measured without real files, and this application has no
image data of its own.

`scripts/dev/make-placeholder-images.mjs` produces them and `pnpm check:fixtures` fails if
they have drifted from it. That check compares bytes, deflate's output included, which is a
stronger claim than [`docs/route-budgets.md`](./route-budgets.md) is willing to make about
zlib — it reports transfer sizes and never asserts on them, because "zlib's output moves a
few bytes between Node builds". Asserting here is deliberate: the CI matrix runs this check
on every Node major in `engines.node` and all three agree byte for byte, which is what turns
"reproducible" from a claim into a result. The script's header says what to do if a future
runtime breaks that. Generated rather than drawn for the
reason `activity-log.data.ts` generates its rows: a fixture nobody can rebuild is a fixture
nobody can change. They are deliberately plain flat bands of colour — an avatar that looked
like a photograph of a person would invite someone to ship it, the same reasoning that makes
the actors in `activity-log.data.ts` `*.sample@example.test`.

Intrinsic sizes are larger than any rendered size, because a fixed `<img>` under a
configured loader is served at `width` and `2 × width`: the source has to cover the 2×
candidate or the retina image is an upscale.

PNG is written by hand there rather than through a dependency. The format's minimum is three
chunks — IHDR, IDAT, IEND — each length-prefixed and CRC-32 tagged, with IDAT holding
zlib-deflated scanlines. `node:zlib` supplies the only part worth a library; adding an
image-processing dependency to produce eight flat-coloured rectangles would be the larger
cost.

## What this cost, measured

The `initial` budget moved **567 kB → 574 kB**, and the raw initial total 565.02 kB →
571.43 kB. The reason is not the images — they are assets, not bundle — and it is not the
three components, which account for about 1.2 kB between them. It is 5.16 kB of
`@angular/common`'s `common.mjs` landing in `main`.

This is the same phenomenon `docs/route-budgets.md` records for the rxjs barrel. `common.mjs`
was already assigned to an initial chunk (44 bytes of it live in the baseline build), so
adding any new consumer of that module makes more of it survive tree-shaking *there* rather
than moving into the lazy chunks that use it. Providing the loader from the two lazy route
trees instead of `app.config.ts` was measured and recovers 1.02 kB of the 6.41 kB — so the
directive is chunk-assigned to `main` either way, and no route change can shift it. The root
provider was kept: 1 kB is not worth a loader that a future eager `<img>` would silently not
get, which is a failure mode no gate here can catch.

Every per-route budget held. Each route that draws an image grew 0.67–0.73 kB and none
needed moving; `/unauthorized` and `/admin`, which draw none, are unchanged to the byte.

## See also

- [`docs/track-expressions.md`](./track-expressions.md) — why a wrong `track` re-downloads
  every avatar.
- [`docs/web-vitals.md`](./web-vitals.md) — the field measurement of LCP and CLS.
- [`docs/ssr.md`](./ssr.md) — what prerendering promises, and what `assert-ssr.mjs` checks.
- [`docs/route-budgets.md`](./route-budgets.md) — how a route's cost is priced.
