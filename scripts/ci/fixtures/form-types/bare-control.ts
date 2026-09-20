// A raw Angular control passed where a spec belongs.
//
// The spec indirection is not decoration: a bare `new FormControl('')` is nullable, and
// nullability is precisely what the structural check cannot see (see `FieldSpec`). So the
// spec is required, which is also what keeps `nonNullable` from being forgotten.
import { FormControl } from '@angular/forms';
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

export const form = typedGroup<Credentials>()({
  // @expect-error TS2739: is missing the following properties from type 'FieldSpec
  email: new FormControl('', { nonNullable: true }),
  password: control(''),
});
