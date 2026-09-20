import type { FormControl } from '@angular/forms';
import { z } from 'zod';
import { schemaGroup } from './schema-form';
import { zodGroupValidator } from '@/app/core/validators/zod-validator';
import { expectTypeEquals } from '@/testing/types';

const signInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const pairSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const pairBaseSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
});

describe('schemaGroup', () => {
  it('builds one control per key of the schema, seeded from the initial value', () => {
    const form = schemaGroup(signInSchema, { email: 'me@example.test', password: '' });

    expect(Object.keys(form.controls)).toEqual(['email', 'password']);
    expect(form.getRawValue()).toEqual({ email: 'me@example.test', password: '' });
  });

  it('types the raw value as the schema input', () => {
    const form = schemaGroup(signInSchema, { email: '', password: '' });

    expectTypeEquals<z.input<typeof signInSchema>, ReturnType<typeof form.getRawValue>>(true);
    expectTypeEquals<FormControl<string>, typeof form.controls.email>(true);
    expect(form.getRawValue()).toEqual({ email: '', password: '' });
  });

  it('gives each field its own rule from the schema, and not a sibling’s', () => {
    const form = schemaGroup(signInSchema, { email: 'not-an-email', password: 'short' });

    expect(form.controls.email.errors).toEqual({ zod: 'Please enter a valid email address' });
    expect(form.controls.password.errors).toEqual({
      zod: 'Password must be at least 8 characters',
    });
  });

  it('reports the schema’s own message, first issue first', () => {
    const form = schemaGroup(signInSchema, { email: '', password: 'long-enough' });

    expect(form.controls.email.errors).toEqual({ zod: 'Email is required' });
  });

  it('revalidates as the value changes', () => {
    const form = schemaGroup(signInSchema, { email: '', password: 'long-enough' });

    expect(form.invalid).toBeTrue();
    form.controls.email.setValue('me@example.test');
    expect(form.valid).toBeTrue();
  });

  it('builds non-nullable controls, so a reset restores the seed', () => {
    const form = schemaGroup(signInSchema, { email: 'me@example.test', password: 'hunter2!!' });

    form.reset();

    expect(form.getRawValue()).toEqual({ email: 'me@example.test', password: 'hunter2!!' });
    expect(form.valid).toBeTrue();
  });

  it('carries a cross-field rule on the group, from the refined schema', () => {
    const form = schemaGroup(
      pairBaseSchema,
      { password: 'hunter2!!', confirmPassword: 'hunter3!!' },
      { validators: zodGroupValidator(pairSchema) }
    );

    expect(form.errors).toEqual({ confirmPassword: "Passwords don't match" });

    form.controls.confirmPassword.setValue('hunter2!!');

    expect(form.errors).toBeNull();
    expect(form.valid).toBeTrue();
  });

  it('holds the schema’s input type, which a transform makes distinct from its output', () => {
    // `z.infer` here would be `{ age: number }`, and a `FormControl<number>` bound to a
    // text input is a lie the day someone types a letter into it. The form holds what was
    // typed; `safeParse` is what turns it into the output type.
    const ageSchema = z.object({
      age: z.string().regex(/^\d+$/, 'Digits only').transform(Number),
    });

    const form = schemaGroup(ageSchema, { age: '41' });

    expectTypeEquals<{ age: string }, ReturnType<typeof form.getRawValue>>(true);
    expect(form.getRawValue().age).toBe('41');
    expect(ageSchema.parse(form.getRawValue()).age).toBe(41);
  });

  it('rejects a bad value before the transform ever runs', () => {
    const ageSchema = z.object({
      age: z.string().regex(/^\d+$/, 'Digits only').transform(Number),
    });

    const form = schemaGroup(ageSchema, { age: 'forty-one' });

    expect(form.controls.age.errors).toEqual({ zod: 'Digits only' });
  });
});
