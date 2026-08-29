import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import {
  API_ERROR_MAPPERS,
  NETWORK_ERROR_MESSAGE,
  resolveApiError,
} from '../errors/api-error-mappers';
import type { ApiError } from '../models/api.models';

/**
 * Normalises every transport failure into an {@link ApiError}, so nothing downstream has
 * to know what shape the server chose.
 *
 * *How* a response is read is not this interceptor's decision: the strategies come from
 * `API_ERROR_MAPPERS`, registered by `provideApiErrorMappers` at the composition root.
 * See `docs/strategy-tokens.md`.
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  // Read inside the interceptor, where the injection context is: `catchError`'s callback
  // runs on a later tick, long after `inject()` stops being legal. `optional` because an
  // application that registers no mappers should still get a well-formed error out of
  // `resolveApiError`'s fallback rather than an NG0201 in place of the real failure.
  const mappers = inject(API_ERROR_MAPPERS, { optional: true }) ?? [];

  return next(req).pipe(
    catchError((err: unknown) =>
      throwError(() =>
        err instanceof HttpErrorResponse
          ? resolveApiError(err, mappers)
          : // Not a response at all — an interceptor further down threw, or the request
            // was rejected before one existed. There is no status and no body to read,
            // so no mapper could say anything about it.
            ({ status: 0, message: NETWORK_ERROR_MESSAGE } satisfies ApiError)
      )
    )
  );
};
