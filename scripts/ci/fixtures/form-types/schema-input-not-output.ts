// A schema-driven form read as if it held the schema's output type.
//
// `z.infer` is the output; the form holds the input. With a transform in the schema the
// two differ, and `getRawValue()` is the untransformed side — `safeParse` is what crosses
// the gap.
import { z } from 'zod';
import { schemaGroup } from '@/app/core/forms';

const ageSchema = z.object({ age: z.string().transform(Number) });

const form = schemaGroup(ageSchema, { age: '41' });

// @expect-error TS2322: Type 'string' is not assignable to type 'number'
export const age: number = form.getRawValue().age;
