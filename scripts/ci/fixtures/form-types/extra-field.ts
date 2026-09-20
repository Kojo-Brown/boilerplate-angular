// A form with a control its model has no room for.
//
// Excess-property checking would catch this in an object literal on its own; the
// `Record<Exclude<keyof TSpec, keyof TValue>, never>` half of the constraint is what
// catches it in a spec assembled any other way.
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

export const form = typedGroup<Credentials>()({
  email: control(''),
  password: control(''),
  // @expect-error TS2322: is not assignable to type 'never'
  rememberMe: control(false),
});
