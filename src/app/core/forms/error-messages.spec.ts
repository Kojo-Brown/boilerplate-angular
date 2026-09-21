import { FormControl, Validators } from '@angular/forms';
import { DEFAULT_FIELD_ERROR_MESSAGES, resolveFieldError } from './error-messages';
import type { FieldErrorMessages } from './error-messages';

const CONTEXT = { label: 'Email' } as const;

function resolve(errors: Record<string, unknown> | null, messages = DEFAULT_FIELD_ERROR_MESSAGES) {
  return resolveFieldError(errors, messages, CONTEXT);
}

describe('resolveFieldError', () => {
  it('returns null when the control has no errors', () => {
    expect(resolve(null)).toBeNull();
  });

  it('names the field in the messages that say "this field"', () => {
    expect(resolve({ required: true })).toBe('Email is required.');
    expect(resolveFieldError({ required: true }, DEFAULT_FIELD_ERROR_MESSAGES, { label: '' })).toBe(
      'This field is required.'
    );
  });

  it('passes a zod message straight through, because the schema already wrote it', () => {
    expect(resolve({ zod: 'Please enter a valid email address' })).toBe(
      'Please enter a valid email address'
    );
  });

  it('does not render an object at the user when a validator collides with the zod key', () => {
    expect(resolve({ zod: { unexpected: true } })).toBe('This value is not valid.');
  });

  it('reads the detail the built-in validators store', () => {
    const control = new FormControl('ab', [Validators.minLength(8)]);
    expect(resolve(control.errors)).toBe('Use at least 8 characters.');
  });

  /**
   * The reason this function exists rather than `Object.keys(errors)[0]`. Both objects
   * below describe the same empty field; they differ only in the order the validators
   * ran, which is the order they were written in the array.
   */
  it('picks the same message however the validators were ordered', () => {
    expect(resolve({ required: true, minlength: { requiredLength: 8 } })).toBe(
      'Email is required.'
    );
    expect(resolve({ minlength: { requiredLength: 8 }, required: true })).toBe(
      'Email is required.'
    );
  });

  it('falls back to insertion order for keys nobody has ranked', () => {
    const messages: FieldErrorMessages = {
      serverRejected: () => 'The server rejected this.',
      tooSpicy: () => 'Too spicy.',
    };
    expect(resolve({ serverRejected: true, tooSpicy: true }, messages)).toBe(
      'The server rejected this.'
    );
    expect(resolve({ tooSpicy: true, serverRejected: true }, messages)).toBe('Too spicy.');
  });

  it('still ranks a known key above an unknown one', () => {
    const messages: FieldErrorMessages = {
      ...DEFAULT_FIELD_ERROR_MESSAGES,
      serverRejected: () => 'The server rejected this.',
    };
    expect(resolve({ serverRejected: true, required: true }, messages)).toBe('Email is required.');
  });

  it('renders nothing, rather than a key, for an error with no message', () => {
    expect(resolve({ somethingNobodyWroteAMessageFor: true })).toBeNull();
  });

  it('has a message for every validator Angular ships', () => {
    expect(resolve({ requiredTrue: true })).toBe('Email must be checked.');
    expect(resolve({ email: true })).toBe('Enter a valid email address.');
    expect(resolve({ maxlength: { requiredLength: 50, actualLength: 60 } })).toBe(
      'Use at most 50 characters.'
    );
    expect(resolve({ min: { min: 1, actual: 0 } })).toBe('Enter 1 or more.');
    expect(resolve({ max: { max: 9, actual: 10 } })).toBe('Enter 9 or less.');
    expect(resolve({ pattern: { requiredPattern: '^a', actualValue: 'b' } })).toBe(
      'This is not in the expected format.'
    );
  });

  /**
   * A validation error is whatever the validator put there, so a message that reads its
   * detail has to survive a detail that is not the shape it expected — a hand-written
   * `setErrors({ minlength: true })` from a server response, most often.
   */
  it('survives a detail that is not the shape the validator usually stores', () => {
    expect(resolve({ minlength: true })).toBe('Use at least 1 characters.');
    expect(resolve({ maxlength: 'nonsense' })).toBe('Use at most 1 characters.');
    expect(resolve({ min: null })).toBe('Enter 0 or more.');
    expect(resolve({ max: { limit: 9 } })).toBe('Enter 0 or less.');
  });

  /**
   * What a component's own keys are worth. `tagsPending` is a rule only the accessor
   * could have checked; `required` is one any validator could have given, so the specific
   * one is the more useful answer when both are failing.
   */
  it('ranks the keys a component contributes ahead of the generic ones', () => {
    const messages: FieldErrorMessages = {
      ...DEFAULT_FIELD_ERROR_MESSAGES,
      tagsPending: () => 'Finish the tag you are typing.',
    };
    const errors = { required: true, tagsPending: { text: 'ang' } };

    expect(resolveFieldError(errors, messages, CONTEXT)).toBe('Email is required.');
    expect(resolveFieldError(errors, messages, CONTEXT, ['tagsPending'])).toBe(
      'Finish the tag you are typing.'
    );
  });

  /**
   * Overriding the wording of `required` is a translation, not a claim that it has become
   * the most urgent thing wrong with the field.
   */
  it('does not let an overridden built-in key jump the queue', () => {
    const messages: FieldErrorMessages = {
      ...DEFAULT_FIELD_ERROR_MESSAGES,
      minlength: () => 'Longer, please.',
    };

    expect(
      resolveFieldError({ required: true, minlength: { requiredLength: 8 } }, messages, CONTEXT, [
        'minlength',
      ])
    ).toBe('Email is required.');
  });
});
