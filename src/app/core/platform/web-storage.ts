/**
 * Reaching `localStorage` safely, in one place.
 *
 * Two callers need the same three-line dance — {@link browserThemePreferenceStore} and
 * {@link browserAuthTokenStorage} — and both got it subtly wrong before server-side
 * rendering made the failure reachable, in the same way: `view?.localStorage.getItem(k)`
 * guards against a missing *window* and not against a missing *property*, so a window
 * object without the storage APIs is a `TypeError` rather than a skipped call.
 *
 * That window is not hypothetical. Under server-side rendering `DOCUMENT` is a
 * server-side DOM, and whether its `defaultView` is `null` or an object with a partial
 * Window surface is an implementation detail of the DOM the renderer happens to use —
 * not something a service should be written against. Asking for the property itself is
 * the question with a stable answer.
 */

/**
 * A window's `localStorage`, or `null` where there is not one.
 *
 * The property access is inside the `try` on purpose: in a browser, *reading* it throws
 * — not the `getItem` that follows — when site data is blocked. Safari's private mode
 * has done this, and so does a third-party-cookie block for a page inside an iframe.
 */
export function storageOf(view: Window | null): Storage | null {
  try {
    return view?.localStorage ?? null;
  } catch {
    return null;
  }
}
