import type { ComponentFixture } from '@angular/core/testing';

/**
 * `ComponentFixture.nativeElement` is typed `any`, so `fixture.nativeElement.querySelector<T>()`
 * is a type-argument call on an untyped value — a TS2347 compile error under this repo's
 * `strict` config. Go through this helper instead of casting at every call site.
 */
export function host(fixture: ComponentFixture<unknown>): HTMLElement {
  return fixture.nativeElement as HTMLElement;
}

/**
 * Query an element the spec depends on existing. Throws with the selector in the message
 * rather than returning `null`, so a template change surfaces as "the button is gone"
 * instead of a `Cannot read properties of null` several lines later.
 */
export function requireEl<T extends Element>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (el === null) {
    throw new Error(`Expected to find "${selector}" in the rendered template, but it was absent.`);
  }
  return el;
}

/** Set an input's value and fire the `input` event so Angular's form control picks it up. */
export function fillInput(root: HTMLElement, selector: string, value: string): void {
  const input = requireEl<HTMLInputElement>(root, selector);
  input.value = value;
  input.dispatchEvent(new Event('input'));
}
