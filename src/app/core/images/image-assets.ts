/**
 * Where the checked-in placeholder images live, and which one belongs to whom.
 *
 * The paths are constants rather than string literals in templates because they are a
 * contract with two things outside the template: `public/img/`, whose contents
 * `scripts/dev/make-placeholder-images.mjs` generates, and the `width`/`height` every
 * `<img>` under `NgOptimizedImage` has to declare. A renamed file or a regenerated set at a
 * different resolution then breaks a spec here rather than a page in production.
 */

/** The brand mark, and its intrinsic size in pixels. Square. */
export const BRAND_MARK = {
  src: '/img/brand-mark.png',
  intrinsicSize: 256,
} as const;

/**
 * The banner across the top of the sign-in and registration cards.
 *
 * `renderedWidth`/`renderedHeight` are here and not only in the template because they are
 * the aspect ratio the file is generated at: `NgOptimizedImage` compares the two against
 * the decoded image and warns (NG02952) when they disagree, and a banner stretched by a
 * mismatch is the kind of thing that survives review. 448 is the `max-w-md` card's inner
 * width at the padding both auth pages use.
 */
export const AUTH_BANNER = {
  src: '/img/auth-banner.png',
  renderedWidth: 448,
  renderedHeight: 168,
} as const;

/** How many avatar fixtures `public/img/` holds. */
export const AVATAR_COUNT = 6;

/** Intrinsic size of every avatar fixture, in pixels. Square. */
export const AVATAR_INTRINSIC_SIZE = 128;

/**
 * Pick one of the avatar fixtures for an author, deterministically.
 *
 * A real application takes an avatar URL from its API and this function does not exist.
 * What stands in for it here has to satisfy one requirement that is easy to miss: the same
 * author must get the same URL on every call, in the browser and on the server alike.
 * `NgOptimizedImage` writes the resolved URL into the prerendered HTML, and a
 * non-deterministic source would hydrate to a different `src` than the server sent — which
 * discards the image the browser had already fetched and, for a `priority` image, the
 * `<link rel="preload">` that went with it.
 *
 * So: FNV-1a over the id, which is four lines, stable across platforms, and has no
 * dependency on hash iteration order or on `Math.random`. Collisions are not a problem —
 * two authors sharing a placeholder tile is the expected outcome with six of them.
 */
export function avatarFor(authorId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < authorId.length; index++) {
    hash ^= authorId.charCodeAt(index);
    // FNV-1a's 32-bit prime, via `Math.imul` so the multiply stays 32-bit rather than
    // overflowing into a float and losing the low bits.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `/img/avatar-${(hash % AVATAR_COUNT) + 1}.png`;
}
