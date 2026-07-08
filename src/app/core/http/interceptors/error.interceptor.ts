import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import type { ApiError } from '../models/api.models';

export const errorInterceptor: HttpInterceptorFn = (req, next) =>
  next(req).pipe(
    catchError((err: unknown) => throwError(() => toApiError(err)))
  );

function toApiError(err: unknown): ApiError {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string; errors?: Record<string, string[]> } | null;
    return {
      status: err.status,
      message: body?.message ?? err.message ?? 'An unexpected error occurred',
      errors: body?.errors,
    };
  }
  return { status: 0, message: 'Network error — please check your connection' };
}
