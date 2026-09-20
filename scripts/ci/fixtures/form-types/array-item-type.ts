// A FormArray of the wrong item type.
import { arrayOf, control, nestedGroup, typedGroup } from '@/app/core/forms';
import type { Profile } from './model';

export const form = typedGroup<Profile>()({
  name: control(''),
  address: nestedGroup<Profile['address']>()({ city: control(''), postcode: control('') }),
  // @expect-error TS2322: is not assignable to type 'AnyFieldSpec<string[]>'
  tags: arrayOf<number>()([control(1)]),
});
