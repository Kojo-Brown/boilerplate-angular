import { FormControl, FormGroup, Validators } from '@angular/forms';
import type { AbstractControl, FormArray, ValidationErrors } from '@angular/forms';
import { arrayOf, control, nestedGroup, typedGroup } from './typed-form';
import { expectTypeEquals } from '@/testing/types';

interface Credentials {
  email: string;
  password: string;
}

interface Profile {
  name: string;
  address: { city: string; postcode: string };
  tags: string[];
}

/** A group validator that fails when two named fields hold the same value. */
function distinct(left: string, right: string) {
  return (group: AbstractControl): ValidationErrors | null => {
    const value = group.value as Record<string, unknown>;
    return value[left] === value[right] ? { distinct: true } : null;
  };
}

describe('control', () => {
  it('builds a control seeded with its initial value', () => {
    const email = control('me@example.test').build();

    expect(email.value).toBe('me@example.test');
  });

  it('resets to the initial value rather than to null', () => {
    const email = control('me@example.test').build();

    email.setValue('someone@example.test');
    email.reset();

    expect(email.value).toBe('me@example.test');
  });

  it('is the difference from a control built the default way', () => {
    // The behaviour `nonNullable` changes, asserted against Angular rather than
    // described in a comment: this is the control `new FormControl('')` produces, and
    // `reset()` on it is where a `string` field acquires a null.
    const nullable = new FormControl('me@example.test');

    nullable.reset();

    expect(nullable.value).toBeNull();
  });

  it('applies the validators it is given', () => {
    const email = control('', { validators: [Validators.required] }).build();

    expect(email.valid).toBeFalse();
    expect(email.errors).toEqual({ required: true });
  });

  it('passes updateOn through to the control', () => {
    const email = control('', { validators: [Validators.required], updateOn: 'blur' }).build();

    // `updateOn` governs when the *view* pushes a value back and revalidates, not whether
    // the control validates at all: a control validates once as it is constructed
    // whatever this is set to, so `errors` is already populated here.
    expect(email.updateOn).toBe('blur');
    expect(email.errors).toEqual({ required: true });
  });
});

describe('typedGroup', () => {
  it('builds one control per field of the model', () => {
    const form = typedGroup<Credentials>()({
      email: control('me@example.test'),
      password: control('hunter2'),
    });

    expect(Object.keys(form.controls)).toEqual(['email', 'password']);
    expect(form.getRawValue()).toEqual({ email: 'me@example.test', password: 'hunter2' });
  });

  it('types the raw value as the model itself', () => {
    const form = typedGroup<Credentials>()({
      email: control(''),
      password: control(''),
    });

    expectTypeEquals<Credentials, ReturnType<typeof form.getRawValue>>(true);
    expect(form.getRawValue()).toEqual({ email: '', password: '' });
  });

  it('keeps each control precisely typed rather than widening to AbstractControl', () => {
    const form = typedGroup<Credentials>()({
      email: control(''),
      password: control(''),
    });

    expectTypeEquals<FormControl<string>, typeof form.controls.email>(true);
    expect(form.controls.email).toBeInstanceOf(FormControl);
  });

  it('leaves `value` partial, because a disabled control is missing from it', () => {
    const form = typedGroup<Credentials>()({
      email: control('me@example.test'),
      password: control('hunter2'),
    });

    form.controls.password.disable();

    expect(form.value).toEqual({ email: 'me@example.test' });
    expect(form.getRawValue()).toEqual({ email: 'me@example.test', password: 'hunter2' });
    expectTypeEquals<Partial<Credentials>, typeof form.value>(true);
  });

  it('applies group-level options', () => {
    const form = typedGroup<Credentials>()(
      { email: control('same'), password: control('same') },
      { validators: distinct('email', 'password') }
    );

    expect(form.errors).toEqual({ distinct: true });
  });

  it('resets every field to its initial value', () => {
    const form = typedGroup<Credentials>()({
      email: control('me@example.test'),
      password: control('hunter2'),
    });

    form.setValue({ email: 'other@example.test', password: 'changed' });
    form.reset();

    expect(form.getRawValue()).toEqual({ email: 'me@example.test', password: 'hunter2' });
  });
});

describe('nestedGroup and arrayOf', () => {
  const build = () =>
    typedGroup<Profile>()({
      name: control('Ada'),
      address: nestedGroup<Profile['address']>()({
        city: control('London'),
        postcode: control('SW1A 1AA'),
      }),
      tags: arrayOf<string>()([control('owner'), control('admin')]),
    });

  it('builds the whole tree in one call', () => {
    expect(build().getRawValue()).toEqual({
      name: 'Ada',
      address: { city: 'London', postcode: 'SW1A 1AA' },
      tags: ['owner', 'admin'],
    });
  });

  it('types the nested raw value as the nested model', () => {
    const form = build();

    expectTypeEquals<Profile, ReturnType<typeof form.getRawValue>>(true);
    expectTypeEquals<FormControl<string>, typeof form.controls.address.controls.city>(true);
    expectTypeEquals<FormArray<FormControl<string>>, typeof form.controls.tags>(true);
    expect(form.controls.address.controls.city.value).toBe('London');
  });

  it('keeps a nested group reachable as a group rather than as an AbstractControl', () => {
    const form = build();

    form.controls.address.controls.city.setValue('Cambridge');

    expect(form.getRawValue().address).toEqual({ city: 'Cambridge', postcode: 'SW1A 1AA' });
  });

  it('accepts group options on a nested group', () => {
    const form = typedGroup<Profile>()({
      name: control('Ada'),
      address: nestedGroup<Profile['address']>()(
        { city: control('same'), postcode: control('same') },
        { validators: distinct('city', 'postcode') }
      ),
      tags: arrayOf<string>()([]),
    });

    expect(form.controls.address.errors).toEqual({ distinct: true });
    expect(form.invalid).toBeTrue();
  });

  it('builds array items that are themselves non-nullable', () => {
    const form = build();

    form.controls.tags.at(0).setValue('changed');
    form.controls.tags.at(0).reset();

    expect(form.getRawValue().tags).toEqual(['owner', 'admin']);
  });

  it('grows and shrinks like any FormArray', () => {
    const form = build();

    form.controls.tags.push(control('billing').build());
    expect(form.getRawValue().tags).toEqual(['owner', 'admin', 'billing']);

    form.controls.tags.removeAt(0);
    expect(form.getRawValue().tags).toEqual(['admin', 'billing']);
  });

  it('applies array-level options', () => {
    const tags = arrayOf<string>()([control('a')], { validators: Validators.maxLength(0) }).build();

    expect(tags.valid).toBeFalse();
  });
});

describe('what the helper produces', () => {
  it('is an ordinary FormGroup, usable anywhere one is', () => {
    const form = typedGroup<Credentials>()({ email: control(''), password: control('') });

    // Nothing here wraps or subclasses Angular's classes: `[formGroup]`, `AbstractControl.events`,
    // `controlErrorSignal` and every other consumer see exactly what they always have.
    expect(form).toBeInstanceOf(FormGroup);
    expect(form.controls.email).toBeInstanceOf(FormControl);
  });
});
