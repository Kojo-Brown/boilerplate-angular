import { inject, LOCALE_ID } from '@angular/core';

/**
 * A message for every plural category CLDR defines, so a caller cannot leave one out.
 *
 * ## Why all six, and why this type is deliberately tiresome
 *
 * An ICU `plural` in a template is the right way to say "1 post" or "3 posts": the
 * translator receives the whole construct, declares the categories *their* language uses,
 * and Angular's compiler wires the selection. `{ …, plural, … }` is a template grammar,
 * though — `$localize` does not parse it — so a count that has to be pluralised in
 * TypeScript has nothing to hand the translator, and the selection has to happen here.
 *
 * That relocation has a consequence that is easy to miss. A `$localize` message is chosen
 * at **build** time, per locale, by message id; a plural category is chosen at **run**
 * time, from the value. So the translation file can only supply an Arabic `few` if the
 * source already declared a message with that id — a translator cannot add one. English
 * uses two categories, which is why the natural shape of this helper (an `Partial` record
 * falling back to `other`) is wrong: it compiles, it reads as tolerant, and it silently
 * hands Arabic the `other` wording for the five categories English never named.
 *
 * Requiring all six makes that cost visible at the call site instead: English repeats
 * itself five times, and the repetition is the argument for keeping plurals in templates
 * wherever a template exists to keep them in. `docs/i18n.md` works the trade through.
 */
export type PluralMessages = Readonly<Record<Intl.LDMLPluralRule, string>>;

/**
 * The message for `count` in `locale`.
 *
 * `Intl.PluralRules` and not a hand-written rule: the category boundaries are data, they
 * differ per language in ways that are not guessable (Arabic separates 0, 1, 2, 3–10 and
 * 11–99; Polish selects on the last two digits), and the browser already ships the table.
 *
 * `type: 'cardinal'` is the default and is stated anyway, because the other kind —
 * `'ordinal'`, "1st/2nd/3rd" — uses a different set of categories for the same language
 * and picking it up by accident is a bug with no symptom in English.
 */
export function selectPlural(locale: string, count: number, messages: PluralMessages): string {
  const category = new Intl.PluralRules(locale, { type: 'cardinal' }).select(count);
  return messages[category];
}

/**
 * {@link selectPlural} bound to the application's locale, for use in an injection context.
 *
 * `LOCALE_ID` rather than the runtime's default locale: `new Intl.PluralRules()` with no
 * argument asks the *browser* what language it is in, which is a question about the
 * visitor's operating system and not about the bundle they were served. A visitor reading
 * the Arabic build on an English machine would get English's two categories applied to
 * Arabic wording.
 */
export function injectPluralSelector(): (count: number, messages: PluralMessages) => string {
  const locale = inject(LOCALE_ID);
  return (count, messages) => selectPlural(locale, count, messages);
}
