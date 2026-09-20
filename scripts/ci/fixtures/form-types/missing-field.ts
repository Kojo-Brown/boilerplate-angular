// A form that is missing one of its model's fields.
//
// This is the failure `FormBuilder` cannot have, because there the model is inferred from
// the spec. Here the model is given, so a field that is not built is a type error and not
// a form that silently submits `{ email }` to an endpoint expecting both.
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

export const form = typedGroup<Credentials>()({
  // @expect-error TS2345: Property 'password' is missing in type
  email: control(''),
});
