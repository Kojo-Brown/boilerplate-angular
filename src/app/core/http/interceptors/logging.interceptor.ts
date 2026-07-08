import { HttpEventType, type HttpInterceptorFn } from '@angular/common/http';
import { isDevMode } from '@angular/core';
import { tap } from 'rxjs';

export const loggingInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isDevMode()) return next(req);

  const start = Date.now();
  return next(req).pipe(
    tap({
      next: (event) => {
        if (event.type === HttpEventType.Response) {
          console.debug(
            `[HTTP] ${req.method} ${req.urlWithParams} → ${event.status} (${Date.now() - start}ms)`
          );
        }
      },
      error: (err: unknown) => {
        console.error(`[HTTP] ${req.method} ${req.urlWithParams} → ERROR`, err);
      },
    })
  );
};
