import type { HttpErrorResponse } from '@angular/common/http';
import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from '@angular/core';
import type { ApiError } from '../models/api.models';

/**
 * One way of reading a failed HTTP response into an {@link ApiError}.
 *
 * A mapper is asked about every failure and answers `null` for the ones it does not
 * recognise, so "does this look like my format?" and "what does it say?" are the same
 * pass — the alternative is a `canMap`/`map` pair whose two halves can disagree.
 */
export interface ApiErrorMapper {
  /** Identifies the mapper in diagnostics and in specs. Not used for resolution. */
  readonly name: string;

  /** The error this mapper reads out of `error`, or `null` to defer to the next one. */
  map(error: HttpErrorResponse): ApiError | null;
}

/**
 * The strategies consulted by `errorInterceptor`, contributed with `multi: true`.
 *
 * Deliberately declared without a `providedIn`/`factory` default. A tree-shakable
 * default and a `multi: true` provider describe the same token two incompatible ways,
 * and the built-in set is a *list* an application should be able to reorder, extend or
 * drop from — which means naming it at the composition root. Register it with
 * {@link provideApiErrorMappers}; consumers inject it `{ optional: true }` so an
 * application that provides nothing still gets a well-formed error.
 */
export const API_ERROR_MAPPERS = new InjectionToken<readonly ApiErrorMapper[]>('API_ERROR_MAPPERS');

/** Shown when the request never reached the server, so there is no body to read. */
export const NETWORK_ERROR_MESSAGE = 'Network error — please check your connection';

/** Shown when a response failed but no mapper could name a reason. */
export const UNEXPECTED_ERROR_MESSAGE = 'An unexpected error occurred';

/**
 * A failure with no HTTP status: DNS, TLS, CORS, an offline device, an aborted request.
 *
 * Listed first, because `error` here is a `ProgressEvent` rather than a parsed body —
 * every body-reading mapper below would decline it, and none of them can produce a
 * message more useful than "the request never arrived".
 */
export const offlineMapper: ApiErrorMapper = {
  name: 'offline',
  map: (error) => (error.status === 0 ? { status: 0, message: NETWORK_ERROR_MESSAGE } : null),
};

/**
 * RFC 9457 `application/problem+json`, the format Spring, ASP.NET Core and FastAPI
 * emit by default.
 *
 * Gated on the response's content type rather than on the shape of the body: `title` and
 * `detail` are ordinary enough words that a hand-rolled envelope may carry them without
 * meaning the RFC by it, and the header is the part the RFC actually specifies.
 * `detail` before `title` because `title` is documented as a constant per status code —
 * "Unprocessable Entity" — while `detail` describes this occurrence.
 */
export const problemJsonMapper: ApiErrorMapper = {
  name: 'problem-json',
  map: (error) => {
    const contentType = error.headers.get('content-type') ?? '';
    if (!contentType.split(';')[0].trim().endsWith('+json')) return null;

    const body = asRecord(error.error);
    if (body === null) return null;

    const detail = asNonEmptyString(body['detail']) ?? asNonEmptyString(body['title']);
    if (detail === null) return null;

    return {
      status: error.status,
      message: detail,
      errors: asFieldErrors(body['errors']),
    };
  },
};

/**
 * The `{ message, errors }` envelope this boilerplate's own API contract uses.
 *
 * Declines a body that carries neither key, so `{}` and `{ data: null }` fall through to
 * the fallback instead of being reported as an empty message.
 */
export const messageEnvelopeMapper: ApiErrorMapper = {
  name: 'message-envelope',
  map: (error) => {
    const body = asRecord(error.error);
    if (body === null) return null;

    const message = asNonEmptyString(body['message']);
    const errors = asFieldErrors(body['errors']);
    if (message === null && errors === undefined) return null;

    return {
      status: error.status,
      message: message ?? error.message,
      errors,
    };
  },
};

/**
 * A bare string body: `text/plain` handlers, and JSON responses whose body is a quoted
 * string. Whitespace-only bodies decline, so the fallback's status-derived message wins
 * over an empty one.
 */
export const stringBodyMapper: ApiErrorMapper = {
  name: 'string-body',
  map: (error) => {
    const message = asNonEmptyString(error.error);
    return message === null ? null : { status: error.status, message };
  },
};

/**
 * The built-in set, in the order they are consulted. Spread it when registering so an
 * application composes rather than restates it:
 *
 * ```ts
 * provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS, myLegacyGatewayMapper)
 * ```
 */
export const BUILT_IN_API_ERROR_MAPPERS: readonly ApiErrorMapper[] = [
  offlineMapper,
  problemJsonMapper,
  messageEnvelopeMapper,
  stringBodyMapper,
];

/**
 * Registers `mappers` as `multi: true` contributions to {@link API_ERROR_MAPPERS}.
 *
 * Takes exactly what it is given rather than always prepending the built-ins, so
 * dropping one is a matter of not listing it and reordering is a matter of listing them
 * in another order — the argument order *is* the resolution order.
 *
 * Calling it again in a lazy route's `providers` **replaces** the set for requests issued
 * from that route rather than adding to it: a `multi: true` token resolves in the nearest
 * injector that provides it, and Angular does not merge the ancestor's contributions in.
 * A route that wants the built-ins plus one of its own has to say so —
 * `provideApiErrorMappers(mine, ...BUILT_IN_API_ERROR_MAPPERS)`. See
 * `docs/strategy-tokens.md`.
 */
export function provideApiErrorMappers(
  ...mappers: readonly ApiErrorMapper[]
): EnvironmentProviders {
  return makeEnvironmentProviders(
    mappers.map((mapper) => ({ provide: API_ERROR_MAPPERS, useValue: mapper, multi: true }))
  );
}

/**
 * Asks each mapper in turn and returns the first answer, falling back to a
 * status-derived error so the result is total.
 *
 * First match wins, in the order given. There is no priority field to sort by, because
 * the array a consumer injects always comes from a single `provideApiErrorMappers` call
 * in a single injector — so the caller already controls the order by argument position,
 * and a priority number would be a second way to say the same thing that could disagree
 * with the first.
 */
export function resolveApiError(
  error: HttpErrorResponse,
  mappers: readonly ApiErrorMapper[]
): ApiError {
  for (const mapper of mappers) {
    const mapped = mapper.map(error);
    if (mapped !== null) return mapped;
  }
  return fallbackApiError(error);
}

/**
 * What is left when no mapper recognised the response. `error.message` is Angular's own
 * "Http failure response for /api/items: 500 Internal Server Error", which names the
 * status and the URL — worse than a server's own wording, better than nothing.
 */
export function fallbackApiError(error: HttpErrorResponse): ApiError {
  return {
    status: error.status,
    message: asNonEmptyString(error.message) ?? UNEXPECTED_ERROR_MESSAGE,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `Record<string, string[]>` or nothing. A validation map arriving as
 * `{ title: 'is required' }` — a single string where the contract says array — is
 * normalised rather than dropped, because a form that binds to `errors['title']` breaks
 * on the shape, not on the wording.
 */
function asFieldErrors(value: unknown): Record<string, string[]> | undefined {
  const record = asRecord(value);
  if (record === null) return undefined;

  const entries: [string, string[]][] = [];
  for (const [field, messages] of Object.entries(record)) {
    if (typeof messages === 'string') {
      entries.push([field, [messages]]);
    } else if (Array.isArray(messages)) {
      entries.push([field, messages.filter((item): item is string => typeof item === 'string')]);
    }
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
