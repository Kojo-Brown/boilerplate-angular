import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import type { ZodTypeAny } from 'zod';

export function zodValidator(schema: ZodTypeAny): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = schema.safeParse(control.value);
    if (result.success) return null;
    return { zod: result.error.issues[0]?.message ?? 'Invalid value' };
  };
}

export function zodGroupValidator(schema: ZodTypeAny): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const result = schema.safeParse(control.value);
    if (result.success) return null;
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[issue.path.length - 1]) : 'form';
      if (!errors[key]) {
        errors[key] = issue.message;
      }
    }
    return errors;
  };
}
