import { InjectionToken } from '@angular/core';
import type { ValidationErrors } from '@angular/forms';

/**
 * What a message function is told about the failure it is describing.
 *
 * `detail` is whatever the validator stored under its key, typed `unknown` because that
 * is what it is: `Validators.required` stores `true`, `Validators.minLength` stores
 * `{ requiredLength, actualLength }`, {@link file://../validators/zod-validator.ts | zodValidator}
 * stores a string, and a validator someone writes tomorrow stores whatever it likes. Each
 * message narrows its own key's shape, which is the only place the two are known to
 * agree.
 */
export interface FieldErrorContext {
  /** The field's visible label, for messages that name it. Empty when it has none. */
  readonly label: string;
}

/** Turns one entry of a {@link ValidationErrors} object into a sentence. */
export type FieldErrorMessage = (detail: unknown, context: FieldErrorContext) => string;

/** A message per validation-error key. */
export type FieldErrorMessages = Readonly<Record<string, FieldErrorMessage>>;

/** The subject of a message, for the keys that need to name the field. */
function subject(context: FieldErrorContext): string {
  return context.label === '' ? 'This field' : context.label;
}

/** `detail` as a record, for the built-in validators that store one. */
function detailOf(detail: unknown): Record<string, unknown> {
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {};
}

/** A number out of a validator's detail object, or `null` when it is not one. */
function numberAt(detail: unknown, key: string): number | null {
  const value = detailOf(detail)[key];
  return typeof value === 'number' ? value : null;
}

/**
 * Messages for the validators Angular ships, plus the `zod` key this repo's
 * {@link file://../validators/zod-validator.ts | zodValidator} writes.
 *
 * The built-ins need translating because their errors are *data* and not prose —
 * `{ minlength: { requiredLength: 8, actualLength: 3 } }` is a fact about the control,
 * and which of "Password must be at least 8 characters" or "Use at least 8 characters"
 * it becomes is a product decision Angular rightly declines to make. `zod` is the
 * opposite case and passes straight through: the message was written next to the rule,
 * in the schema, which is why this repo's forms prefer it.
 */
export const DEFAULT_FIELD_ERROR_MESSAGES: FieldErrorMessages = {
  required: (_detail, context) => `${subject(context)} is required.`,
  requiredTrue: (_detail, context) => `${subject(context)} must be checked.`,
  email: () => 'Enter a valid email address.',
  minlength: (detail) => `Use at least ${numberAt(detail, 'requiredLength') ?? 1} characters.`,
  maxlength: (detail) => `Use at most ${numberAt(detail, 'requiredLength') ?? 1} characters.`,
  min: (detail) => `Enter ${numberAt(detail, 'min') ?? 0} or more.`,
  max: (detail) => `Enter ${numberAt(detail, 'max') ?? 0} or less.`,
  pattern: () => 'This is not in the expected format.',
  // `zodValidator` stores the schema's own message. Anything else under the key is a
  // different validator colliding with it, and rendering `[object Object]` at a user is
  // worse than saying nothing useful.
  zod: (detail) => (typeof detail === 'string' ? detail : 'This value is not valid.'),
};

/**
 * The application's message per validation-error key.
 *
 * Overridable at any injector, which is what makes it a token rather than a constant:
 * localisation replaces the whole map at the root, and a single form that needs
 * "Enter your work email" for `email` provides a narrowed copy on its own route.
 *
 * A component that contributes error keys of its own does not provide this token — it
 * passes its messages to {@link file://./host-control.ts | hostControl}, which layers
 * them over whatever this resolves to. That way the component keeps its messages next to
 * the validator that produces them, and an application overriding this token does not
 * have to know they exist.
 */
export const FIELD_ERROR_MESSAGES = new InjectionToken<FieldErrorMessages>('FIELD_ERROR_MESSAGES', {
  providedIn: 'root',
  factory: () => DEFAULT_FIELD_ERROR_MESSAGES,
});

/**
 * The order error keys are reported in, most specific first.
 *
 * A control fails every validator it fails, so `Validators.compose` hands back
 * `{ required: true, minlength: … }` together and a field shows *one* message. Without an
 * order that message is `Object.keys(errors)[0]`, which is the order the validators were
 * *declared* in — so reordering an array, or moving a rule from the control to the group,
 * silently changes which message the user sees. That is not a decision that should live
 * in an argument list.
 *
 * `required` wins because "Email is required" is what an empty field means; telling
 * someone their empty email is badly formatted is noise. Keys absent from this list sort
 * after the ones in it, in insertion order, so a validator nobody has ranked still
 * produces a message.
 */
const ERROR_PRIORITY: readonly string[] = [
  'required',
  'requiredTrue',
  'zod',
  'email',
  'pattern',
  'minlength',
  'maxlength',
  'min',
  'max',
];

/**
 * The ranking to sort a control's error keys by.
 *
 * `first` holds keys the *component* contributes — a tag editor's `tagsPending`, say —
 * and they rank ahead of the generic ones, because a rule that only this component can
 * check is a more specific answer than "pick at least one topic". Keys in
 * {@link ERROR_PRIORITY} keep their place even when the component also supplies a message
 * for them: overriding the wording of `required` is a translation, not a claim that it
 * has become the most urgent thing wrong with the field.
 */
function rankingWith(first: readonly string[]): (key: string) => number {
  const order = [...first.filter((key) => !ERROR_PRIORITY.includes(key)), ...ERROR_PRIORITY];
  return (key: string) => {
    const index = order.indexOf(key);
    return index === -1 ? order.length : index;
  };
}

/**
 * The one message to show for a control's errors, or `null` when there are none.
 *
 * ```ts
 * resolveFieldError({ required: true }, DEFAULT_FIELD_ERROR_MESSAGES, { label: 'Email' });
 * // → 'Email is required.'
 * ```
 *
 * An error key with no message in the map yields `null` rather than the key itself: a
 * field reading "tagsPending" at a user is worse than a field reading nothing, and the
 * component's spec is where that gap is supposed to be caught.
 *
 * @param errors The control's `errors`, as `AbstractControl.errors` reports them.
 * @param messages Message per key — {@link FIELD_ERROR_MESSAGES}, layered with any the
 *   component contributes itself.
 * @param context Label for the messages that name the field.
 * @param first Keys to rank ahead of the generic order; see {@link rankingWith}.
 */
export function resolveFieldError(
  errors: ValidationErrors | null,
  messages: FieldErrorMessages,
  context: FieldErrorContext,
  first: readonly string[] = []
): string | null {
  if (errors === null) return null;

  const keys = Object.keys(errors);
  if (keys.length === 0) return null;

  // Sorted by rank, ties broken by the order `Object.keys` gave them, which `Array.sort`
  // preserves — so two unranked keys stay in insertion order rather than swapping about.
  const rank = rankingWith(first);
  const [reported] = [...keys].sort((left, right) => rank(left) - rank(right));
  const message = messages[reported];
  return message === undefined ? null : message(errors[reported], context);
}
