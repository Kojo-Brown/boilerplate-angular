import { installFakeMediaQuery } from './media-query';

const QUERY = '(min-width: 768px)';

describe('installFakeMediaQuery', () => {
  it('answers matchMedia from the supplied map', () => {
    installFakeMediaQuery({ [QUERY]: true });
    expect(window.matchMedia(QUERY).matches).toBeTrue();
  });

  it('reports false for a query it was not given', () => {
    installFakeMediaQuery();
    expect(window.matchMedia(QUERY).matches).toBeFalse();
  });

  it('returns the same MediaQueryList for repeated calls with the same query', () => {
    installFakeMediaQuery();
    expect(window.matchMedia(QUERY)).toBe(window.matchMedia(QUERY));
  });

  it('notifies listeners and updates matches when set() is called', () => {
    const media = installFakeMediaQuery({ [QUERY]: false });
    const list = window.matchMedia(QUERY);
    const seen: boolean[] = [];
    list.addEventListener('change', (event) => seen.push(event.matches));

    media.set(QUERY, true);

    expect(seen).toEqual([true]);
    expect(list.matches).toBeTrue();
  });

  it('counts registered listeners and forgets removed ones', () => {
    const media = installFakeMediaQuery();
    const list = window.matchMedia(QUERY);
    const listener = (): void => undefined;

    expect(media.listenerCount(QUERY)).toBe(0);
    list.addEventListener('change', listener);
    expect(media.listenerCount(QUERY)).toBe(1);
    list.removeEventListener('change', listener);
    expect(media.listenerCount(QUERY)).toBe(0);
  });

  it('exposes the query as media', () => {
    installFakeMediaQuery();
    expect(window.matchMedia(QUERY).media).toBe(QUERY);
  });

  it('implements dispatchEvent as a no-op that reports success', () => {
    installFakeMediaQuery();
    expect(window.matchMedia(QUERY).dispatchEvent(new Event('change'))).toBeTrue();
  });
});
