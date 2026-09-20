// A nullable control in a field the model types as non-nullable.
//
// The one the invariant `rawValue` phantom exists for: through `setValue`'s bivariance a
// `FormControl<string | null>` is assignable to `AbstractControl<unknown, string>`, so
// without the phantom this compiles and `getRawValue()` claims a `string` that `reset()`
// can turn into `null`.
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

export const form = typedGroup<Credentials>()({
  // @expect-error TS2322: Type 'string | null' is not assignable to type 'string'
  email: control<string | null>(null),
  password: control(''),
});
