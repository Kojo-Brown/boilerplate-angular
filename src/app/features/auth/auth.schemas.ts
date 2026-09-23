import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const registerBaseSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(50, 'Name must be under 50 characters'),
  email: z.string().min(1, 'Email is required').email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
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
  inviteCode: z.string().max(32, 'Invite codes are at most 32 characters'),
});

export const registerSchema = registerBaseSchema.refine(
  (data) => data.password === data.confirmPassword,
  { message: "Passwords don't match", path: ['confirmPassword'] }
);

export type LoginFormData = z.infer<typeof loginSchema>;
export type RegisterFormData = z.infer<typeof registerSchema>;
