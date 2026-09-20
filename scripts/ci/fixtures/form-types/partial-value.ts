// `form.value` read as if it were the whole model.
//
// It is `Partial<Credentials>` because a disabled control is dropped from it at runtime.
// `getRawValue()` is the complete read; this is the type error that says so.
import { control, typedGroup } from '@/app/core/forms';
import type { Credentials } from './model';

const form = typedGroup<Credentials>()({ email: control(''), password: control('') });

// @expect-error TS2322: Type 'Partial<{ email: string; password: string; }>' is not assignable to type 'Credentials'
export const credentials: Credentials = form.value;
