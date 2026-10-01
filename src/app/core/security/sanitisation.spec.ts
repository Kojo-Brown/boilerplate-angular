import { SecurityContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { BYPASS_METHODS, HtmlSanitiser } from './sanitisation';

/**
 * The sanitisation policy's guarantees, asserted against the real sanitiser.
 *
 * These are not tests of `HtmlSanitiser`'s three lines. They are the written-down
 * answer to "what does the policy in `sanitisation.ts` actually promise?", checked
 * against Angular rather than against a description of Angular — because the allow-list
 * belongs to the framework and can move under us, and a policy that cites guarantees it
 * no longer has is worse than one that cites none.
 */
describe('HtmlSanitiser', () => {
  let sanitiser: HtmlSanitiser;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    sanitiser = TestBed.inject(HtmlSanitiser);
  });

  describe('what it removes', () => {
    /**
     * One case per vector, each naming only what *that* vector must lose, so a failure
     * says which guarantee went rather than "sanitisation changed".
     *
     * Asserting a shared blanket of forbidden substrings across all of them is the
     * version of this spec that was written first, and it was wrong in a way worth
     * recording: it claimed every vector loses the string `javascript:`, which sent the
     * suite red against a sanitiser that was behaving correctly. See the `javascript:`
     * case below `what it neutralises instead of removing`.
     */
    const VECTORS: readonly {
      readonly name: string;
      readonly html: string;
      readonly absent: readonly string[];
    }[] = [
      { name: 'a script element', html: '<script>alert(1)</script>', absent: ['<script', 'alert'] },
      {
        name: 'an inline event handler',
        html: '<div onclick="alert(1)">x</div>',
        absent: ['onclick', 'alert'],
      },
      {
        name: 'an error handler on a broken image',
        html: '<img src="x" onerror="alert(1)">',
        absent: ['onerror', 'alert'],
      },
      {
        name: 'an iframe',
        html: '<iframe src="https://evil.example"></iframe>',
        absent: ['<iframe'],
      },
      { name: 'an object', html: '<object data="x.swf"></object>', absent: ['<object'] },
      { name: 'an embed', html: '<embed src="x.swf">', absent: ['<embed'] },
      {
        name: 'a form',
        html: '<form action="https://evil.example"><input></form>',
        absent: ['<form', 'evil.example'],
      },
      {
        name: 'a script inside SVG',
        html: '<svg><script>alert(1)</script></svg>',
        absent: ['<script', 'alert'],
      },
      {
        name: 'a style element',
        html: '<style>body{display:none}</style>',
        absent: ['<style'],
      },
    ];

    for (const { name, html, absent } of VECTORS) {
      it(`removes ${name}`, () => {
        const result = sanitiser.sanitise(html).toLowerCase();

        for (const fragment of absent) {
          expect(result).withContext(`${name}: ${fragment}`).not.toContain(fragment);
        }
      });
    }
  });

  /**
   * The guarantee that is not the one you would guess, and the reason this suite asserts
   * against the sanitiser rather than describing it.
   *
   * A `javascript:` URL is **not removed**. Angular rewrites it to `unsafe:javascript:`,
   * and the safety comes from there being no registered handler for an `unsafe:` scheme
   * in any browser — so the link renders, is visible, and does nothing when clicked.
   *
   * It matters because the obvious assertion ("the output does not contain
   * `javascript:`") is false against correct behaviour, and a reader who writes the
   * policy down from memory will write the false version. The `unsafe:` prefix is also
   * the thing to look for when auditing: finding `javascript:` in sanitised output is not
   * by itself a finding, and finding it *without* the prefix is.
   */
  it('neutralises a javascript: URL by prefixing it rather than removing it', () => {
    const result = sanitiser.sanitise('<a href="javascript:alert(1)">x</a>');

    expect(result).toContain('unsafe:javascript:');
    expect(result).not.toMatch(/href="javascript:/);
  });

  describe('what it keeps', () => {
    // The other half of the policy: a sanitiser that stripped everything would be safe
    // and useless, and "render it as text instead" would be the honest advice. These are
    // the cases that make `[innerHTML]` worth having at all.
    it('keeps formatting, links and lists', () => {
      const result = sanitiser.sanitise(
        '<p>A <strong>bold</strong> <em>claim</em>, a <a href="https://example.com">link</a>' +
          '<ul><li>one</li></ul></p>'
      );

      expect(result).toContain('<strong>bold</strong>');
      expect(result).toContain('<em>claim</em>');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('<li>one</li>');
    });

    it('keeps the text of an element it removes', () => {
      // Dropping the tag and keeping the words is what makes this safe to use on prose.
      expect(sanitiser.sanitise('<div onclick="x()">Hello</div>')).toContain('Hello');
    });
  });

  describe('its signature', () => {
    it('returns an empty string for null and undefined', () => {
      expect(sanitiser.sanitise(null)).toBe('');
      expect(sanitiser.sanitise(undefined)).toBe('');
    });

    it('passes ordinary text through unchanged', () => {
      expect(sanitiser.sanitise('just words')).toBe('just words');
    });
  });

  /**
   * The finding that makes the ban in `sanitisation.ts` worth two mechanisms:
   * `DomSanitizer.sanitize()` is a **no-op** on a value that has already been bypassed.
   * It checks for a `SafeValue` and returns the string inside it, unsanitised.
   *
   * So `sanitize(SecurityContext.HTML, x)` is a guarantee about `x`'s *type*, not about
   * the call. `HtmlSanitiser.sanitise` takes `string`, which is what closes the hole —
   * a bypassed value is an object and does not type-check. This spec exists so that an
   * Angular release which changed the behaviour fails here, where the reasoning is, rather
   * than silently turning the helper into a pass-through.
   */
  it('is why sanitize() alone is not a guarantee: it unwraps a bypassed value', () => {
    const domSanitizer = TestBed.inject(DomSanitizer);
    // The one sanctioned call to a bypass in this repository, and it is here to prove why
    // the rule exists. `HtmlSanitiser.sanitise` cannot be handed this value: its parameter
    // is `string` and this is a SafeHtml object.
    // eslint-disable-next-line no-restricted-syntax
    const bypassed = domSanitizer.bypassSecurityTrustHtml('<script>alert(1)</script>');

    expect(domSanitizer.sanitize(SecurityContext.HTML, bypassed)).toBe('<script>alert(1)</script>');
    expect(domSanitizer.sanitize(SecurityContext.HTML, '<script>alert(1)</script>')).not.toContain(
      '<script'
    );
  });
});

describe('BYPASS_METHODS', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  /**
   * Keeps the ESLint rule's list and Angular's actual surface in step.
   *
   * The rule in `eslint.config.mjs` names five methods. If a future Angular adds a sixth
   * bypass, the rule would not mention it, nothing would fail, and the gap would be a
   * method whose entire purpose is to switch the sanitiser off. This fails instead.
   */
  it('names every bypass method DomSanitizer has', () => {
    const domSanitizer = TestBed.inject(DomSanitizer);
    const actual = Object.getOwnPropertyNames(Object.getPrototypeOf(domSanitizer))
      .filter((name) => name.startsWith('bypassSecurityTrust'))
      .sort();

    expect(actual).toEqual([...BYPASS_METHODS].sort());
  });
});
