import { runInInjectionContext, Injector, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { injectPluralSelector, selectPlural } from './plural';
import type { PluralMessages } from './plural';

/** A message per category, each naming itself, so a spec can read back which was chosen. */
const CATEGORIES: PluralMessages = {
  zero: 'zero',
  one: 'one',
  two: 'two',
  few: 'few',
  many: 'many',
  other: 'other',
};

describe('selectPlural', () => {
  it('uses two categories in English, as English does', () => {
    expect(selectPlural('en-US', 1, CATEGORIES)).toBe('one');
    expect(selectPlural('en-US', 0, CATEGORIES)).toBe('other');
    expect(selectPlural('en-US', 2, CATEGORIES)).toBe('other');
    expect(selectPlural('en-US', 11, CATEGORIES)).toBe('other');
  });

  /**
   * The reason the type demands all six. Arabic separates 0, 1, 2, 3–10 and 11–99, which
   * is five distinctions English does not have and no `count === 1` ternary can express —
   * the shape this helper exists to replace.
   */
  it('uses six categories in Arabic, selected by value', () => {
    expect(selectPlural('ar', 0, CATEGORIES)).toBe('zero');
    expect(selectPlural('ar', 1, CATEGORIES)).toBe('one');
    expect(selectPlural('ar', 2, CATEGORIES)).toBe('two');
    expect(selectPlural('ar', 3, CATEGORIES)).toBe('few');
    expect(selectPlural('ar', 10, CATEGORIES)).toBe('few');
    expect(selectPlural('ar', 11, CATEGORIES)).toBe('many');
    expect(selectPlural('ar', 99, CATEGORIES)).toBe('many');
    expect(selectPlural('ar', 100, CATEGORIES)).toBe('other');
  });

  /**
   * Cardinal, not ordinal — the two use different category sets for the same language, so
   * reading "1st, 2nd, 3rd" rules by accident would be wrong with no English symptom.
   * English ordinals put 1 in `one`, 2 in `two` and 3 in `few`; cardinals put 2 and 3 in
   * `other`, which is what this asserts.
   */
  it('asks for cardinal rules', () => {
    expect(selectPlural('en-US', 2, CATEGORIES)).toBe('other');
    expect(selectPlural('en-US', 3, CATEGORIES)).toBe('other');
  });
});

describe('injectPluralSelector', () => {
  function selectorFor(locale: string): (count: number, messages: PluralMessages) => string {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: LOCALE_ID, useValue: locale }] });
    const injector = TestBed.inject(Injector);
    return runInInjectionContext(injector, () => injectPluralSelector());
  }

  it('follows LOCALE_ID rather than the runtime default locale', () => {
    expect(selectorFor('ar')(2, CATEGORIES)).toBe('two');
    expect(selectorFor('en-US')(2, CATEGORIES)).toBe('other');
  });

  /**
   * The bug this guards against: `new Intl.PluralRules()` with no argument asks the
   * *browser* what language it is in, which is a fact about the visitor's operating
   * system rather than about the bundle they were served. A visitor reading the Arabic
   * build on an English machine would get English's two categories applied to Arabic
   * wording, and the test runner — running in English — would agree with it.
   */
  it('does not fall back to the environment when the locale is not the default', () => {
    const environmentCategory = selectPlural(
      new Intl.PluralRules().resolvedOptions().locale,
      3,
      CATEGORIES
    );
    expect(selectorFor('ar')(3, CATEGORIES)).toBe('few');
    expect(selectorFor('ar')(3, CATEGORIES)).not.toBe(environmentCategory);
  });
});
