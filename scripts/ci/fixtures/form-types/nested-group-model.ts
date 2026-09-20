// A nested group built for the wrong model.
import { arrayOf, control, nestedGroup, typedGroup } from '@/app/core/forms';
import type { Profile } from './model';

export const form = typedGroup<Profile>()({
  name: control(''),
  // @expect-error TS2322: Property 'postcode' is missing in type
  address: nestedGroup<{ city: string }>()({ city: control('') }),
  tags: arrayOf<string>()([]),
});
