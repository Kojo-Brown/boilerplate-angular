import { hideScrollScaffolding } from './hide-scroll-scaffolding';

/**
 * The shape `CdkVirtualScrollViewport` renders, built by hand.
 *
 * A fixture would prove the happy path and nothing else: the point of these specs is the
 * *failure*, and a real viewport cannot be talked into not rendering its own template. So
 * the structure is assembled here instead, and
 * `VirtualTableComponent`'s own spec asserts that what the CDK actually renders still
 * matches it — the two together are what make the upgrade tripwire real.
 */
function viewportElement({ wrapper = true, spacer = true } = {}): HTMLElement {
  const viewport = document.createElement('cdk-virtual-scroll-viewport');

  if (wrapper) {
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'cdk-virtual-scroll-content-wrapper';
    contentWrapper.appendChild(document.createElement('div'));
    viewport.appendChild(contentWrapper);
  }

  if (spacer) {
    const spacerEl = document.createElement('div');
    spacerEl.className = 'cdk-virtual-scroll-spacer';
    viewport.appendChild(spacerEl);
  }

  return viewport;
}

describe('hideScrollScaffolding', () => {
  it('marks the content wrapper presentational so its rows belong to the rowgroup', () => {
    const viewport = viewportElement();

    hideScrollScaffolding(viewport);

    expect(
      viewport.querySelector('.cdk-virtual-scroll-content-wrapper')?.getAttribute('role')
    ).toBe('presentation');
  });

  it('hides the spacer, which exists only to size the scrollbar', () => {
    const viewport = viewportElement();

    hideScrollScaffolding(viewport);

    expect(viewport.querySelector('.cdk-virtual-scroll-spacer')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });

  it('leaves the rows themselves untouched', () => {
    const viewport = viewportElement();
    const row = viewport.querySelector('.cdk-virtual-scroll-content-wrapper > div');

    hideScrollScaffolding(viewport);

    expect(row?.hasAttribute('role')).toBeFalse();
    expect(row?.hasAttribute('aria-hidden')).toBeFalse();
  });

  it('throws when the content wrapper is gone, naming which element is missing', () => {
    const viewport = viewportElement({ wrapper: false });

    expect(() => hideScrollScaffolding(viewport)).toThrowError(/wrapper: missing, spacer: found/);
  });

  it('throws when the spacer is gone', () => {
    const viewport = viewportElement({ spacer: false });

    expect(() => hideScrollScaffolding(viewport)).toThrowError(/wrapper: found, spacer: missing/);
  });

  it('ignores scaffolding belonging to a nested viewport', () => {
    // `:scope >` and not a bare descendant selector. A table rendered inside a cell of
    // another virtual table would otherwise have the outer call reach in and mark the inner
    // viewport's wrapper, which both hides the wrong element and leaves the outer one
    // untouched while reporting success.
    const outer = document.createElement('cdk-virtual-scroll-viewport');
    const nested = viewportElement();
    outer.appendChild(nested);

    expect(() => hideScrollScaffolding(outer)).toThrowError(/wrapper: missing, spacer: missing/);
    expect(
      nested.querySelector('.cdk-virtual-scroll-content-wrapper')?.hasAttribute('role')
    ).toBeFalse();
  });
});
