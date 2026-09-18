import { AVATAR_COUNT, AVATAR_INTRINSIC_SIZE, BRAND_MARK, avatarFor } from './image-assets';

describe('avatarFor', () => {
  it('returns the same avatar for the same author every time', () => {
    // The requirement behind this is SSR, not tidiness: the resolved `src` is written into
    // the prerendered HTML, so an author whose avatar changed between the server render and
    // hydration would have the already-fetched image thrown away.
    expect(avatarFor('ada.sample@example.test')).toBe(avatarFor('ada.sample@example.test'));
  });

  it('stays inside the set of fixtures that exist', () => {
    const paths = new Set<string>();
    for (let index = 0; index < 500; index++) {
      paths.add(avatarFor(`actor-${index}@example.test`));
    }

    for (const path of paths) {
      expect(path).toMatch(/^\/img\/avatar-[1-6]\.png$/);
    }
    // A hash that collapsed onto one bucket would satisfy the pattern above and still be
    // broken, so assert the spread as well.
    expect(paths.size).toBe(AVATAR_COUNT);
  });

  it('handles an empty id without leaving the fixture set', () => {
    expect(avatarFor('')).toMatch(/^\/img\/avatar-[1-6]\.png$/);
  });

  it('distinguishes ids that differ only in their last character', () => {
    // A hash that only mixed the first few bytes would map a whole directory of
    // `…@example.test` addresses onto one tile.
    expect(avatarFor('actor-1@example.test')).not.toBe(avatarFor('actor-2@example.test'));
  });

  it('mixes non-ASCII ids without producing a NaN bucket', () => {
    expect(avatarFor('Ama Serwaa 🇬🇭')).toMatch(/^\/img\/avatar-[1-6]\.png$/);
  });
});

describe('image asset declarations', () => {
  it('declares the brand mark at the size the fixture is generated at', () => {
    expect(BRAND_MARK.src).toBe('/img/brand-mark.png');
    expect(BRAND_MARK.intrinsicSize).toBe(256);
  });

  it('declares the avatar intrinsic size the fixtures are generated at', () => {
    expect(AVATAR_INTRINSIC_SIZE).toBe(128);
  });
});
