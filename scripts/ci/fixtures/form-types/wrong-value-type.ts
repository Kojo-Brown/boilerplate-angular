// A control whose value type is not the field's.
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

export const form = typedGroup<Credentials>()({
  // @expect-error TS2322: Type 'string' is not assignable to type 'number'
  email: control(3),
  password: control(''),
});
