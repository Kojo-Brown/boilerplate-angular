/** The two elements `CdkVirtualScrollViewport` renders around the projected rows. */
const CONTENT_WRAPPER_SELECTOR = ':scope > .cdk-virtual-scroll-content-wrapper';
const SPACER_SELECTOR = ':scope > .cdk-virtual-scroll-spacer';

/**
 * Take `CdkVirtualScrollViewport`'s two scaffolding divs out of the accessibility tree.
 *
 * The viewport's template is, and has to be:
 *
 * ```html
 * <div class="cdk-virtual-scroll-content-wrapper"><ng-content /></div>
 * <div class="cdk-virtual-scroll-spacer" [style.height]="totalContentHeight"></div>
 * ```
 *
 * The wrapper is what gets `transform: translateY(…)` as you scroll, and the spacer is what
 * gives the scrollbar the size of the entire data set. Both are load-bearing, and both are
 * in the way: when the viewport is a table's body `rowgroup`, ARIA expects that rowgroup's
 * children to be its `row`s, and here a generic `div` sits between them.
 *
 * `role="presentation"` on the wrapper removes it from the accessibility tree and promotes
 * its children onto the rowgroup, which restores the relationship exactly. (Presentation is
 * honoured here because the wrapper is neither focusable nor carrying any global ARIA
 * attribute, the two conditions that make a user agent ignore it.) The spacer gets
 * `aria-hidden` instead of a role: it has no content to promote and exists only to occupy
 * space.
 *
 * ## Why this throws
 *
 * The class names are part of the CDK's published styling surface — they are what its own
 * stylesheet selects on, and what an application overrides to restyle a viewport — but they
 * are not a typed API, so nothing in the compiler notices if a future version renames or
 * restructures them. Failing quietly would leave a table whose 10,000 rows are announced as
 * belonging to nothing, which is invisible to everyone who does not use a screen reader and
 * therefore would not be found. Failing loudly turns that into a red spec on the upgrade
 * commit.
 *
 * @param viewportElement The `<cdk-virtual-scroll-viewport>` host element.
 * @throws If either scaffolding element is not a direct child of `viewportElement`.
 */
export function hideScrollScaffolding(viewportElement: HTMLElement): void {
  const wrapper = viewportElement.querySelector(CONTENT_WRAPPER_SELECTOR);
  const spacer = viewportElement.querySelector(SPACER_SELECTOR);

  if (wrapper === null || spacer === null) {
    throw new Error(
      'hideScrollScaffolding: CdkVirtualScrollViewport no longer renders both ' +
        `"${CONTENT_WRAPPER_SELECTOR}" and "${SPACER_SELECTOR}" as direct children ` +
        `(wrapper: ${wrapper === null ? 'missing' : 'found'}, ` +
        `spacer: ${spacer === null ? 'missing' : 'found'}). A virtual table's ARIA ` +
        'rowgroup/row relationship depends on hiding them both.'
    );
  }

  wrapper.setAttribute('role', 'presentation');
  spacer.setAttribute('aria-hidden', 'true');
}
