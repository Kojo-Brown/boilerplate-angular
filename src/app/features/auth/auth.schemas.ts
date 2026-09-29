import { z } from 'zod';

/*
 * The schema's messages are the ones that reach the user: `zodValidator` stores them
 * under the `zod` key, and `DEFAULT_FIELD_ERROR_MESSAGES` passes that key straight
 * through precisely because the message was written next to the rule. That is the
 * argument for `zod` over the built-in validators, and it is also why the messages have
 * to be `$localize` tagged *here* — there is nowhere downstream left to translate them.
 */

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, $localize`:Sign-in validation@@auth.schema.email.required:Email is required`)
    .email(
      $localize`:Sign-in validation@@auth.schema.email.invalid:Please enter a valid email address`
    ),
  password: z
    .string()
    .min(
      8,
      $localize`:Sign-in validation@@auth.schema.password.tooShort:Password must be at least 8 characters`
    ),
});

export const registerBaseSchema = z.object({
  name: z
    .string()
    .min(
      2,
      $localize`:Registration validation@@auth.schema.name.tooShort:Name must be at least 2 characters`
    )
    .max(
      50,
      $localize`:Registration validation@@auth.schema.name.tooLong:Name must be under 50 characters`
    ),
  email: z
    .string()
    .min(1, $localize`:Sign-in validation@@auth.schema.email.required:Email is required`)
    .email(
      $localize`:Sign-in validation@@auth.schema.email.invalid:Please enter a valid email address`
    ),
  password: z
    .string()
    .min(
      8,
      $localize`:Sign-in validation@@auth.schema.password.tooShort:Password must be at least 8 characters`
    )
    .regex(
      /[A-Z]/,
      $localize`:Registration validation@@auth.schema.password.needsUppercase:Password must contain at least one uppercase letter`
    )
    .regex(
      /[0-9]/,
      $localize`:Registration validation@@auth.schema.password.needsDigit:Password must contain at least one number`
    ),
  confirmPassword: z
    .string()
    .min(
      1,
      $localize`:Registration validation@@auth.schema.confirmPassword.required:Please confirm your password`
    ),
  /**
   * Optional, so the only synchronous rule is a length bound — a blank code is a
   * complete form, not an incomplete one.
   *
   * Whether a code that *is* filled in applies to the address above it is not knowable
   * here: it depends on the invite table, so it is an asynchronous check on the pair.
   * `RegisterComponent` hangs `asyncCrossFieldValidator` on this field for it, and
   * Angular runs a field's async validators only once its synchronous ones pass — which
   * is why the bound below stays cheap and local.
   */
  inviteCode: z
    .string()
    .max(
      32,
      $localize`:Registration validation@@auth.schema.inviteCode.tooLong:Invite codes are at most 32 characters`
    ),
});

export const registerSchema = registerBaseSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: $localize`:Registration validation@@auth.schema.passwordMismatch:Passwords don't match`,
    path: ['confirmPassword'],
  }
);

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
