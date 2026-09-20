// A schema-driven form seeded with an incomplete initial value.
//
// `schemaGroup` builds a control for every key of the schema, so every key needs a seed —
// `nonNullable` means the initial value is also the reset value, and there is no such
// thing as a control without one.
import { z } from 'zod';
import { schemaGroup } from '@/app/core/forms';

const signInSchema = z.object({ email: z.string().email(), password: z.string().min(8) });

// @expect-error TS2345: Property 'password' is missing in type
export const form = schemaGroup(signInSchema, { email: '' });
