import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  API_ERROR_MAPPERS,
  BUILT_IN_API_ERROR_MAPPERS,
  NETWORK_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE,
  fallbackApiError,
  messageEnvelopeMapper,
  offlineMapper,
  problemJsonMapper,
  provideApiErrorMappers,
  resolveApiError,
  stringBodyMapper,
  type ApiErrorMapper,
} from './api-error-mappers';

interface FailureOptions {
  status?: number;
  statusText?: string;
  error?: unknown;
  contentType?: string;
}

function failure({
  status = 400,
  statusText = 'Bad Request',
  error = null,
  contentType,
}: FailureOptions = {}): HttpErrorResponse {
  return new HttpErrorResponse({
    url: '/api/items',
    status,
    statusText,
    error,
    headers: contentType ? new HttpHeaders({ 'content-type': contentType }) : new HttpHeaders(),
  });
}

/** A mapper that always answers, so "which one won" is observable from the result. */
function alwaysMapper(name: string): ApiErrorMapper {
  return { name, map: (error) => ({ status: error.status, message: name }) };
}

describe('offlineMapper', () => {
  it('claims a status-0 failure, where there is no body to read', () => {
    expect(offlineMapper.map(failure({ status: 0, error: new ProgressEvent('error') }))).toEqual({
      status: 0,
      message: NETWORK_ERROR_MESSAGE,
    });
  });

  it('defers on any response that reached the server', () => {
    expect(offlineMapper.map(failure({ status: 503, error: 'Unavailable' }))).toBeNull();
  });
});

describe('problemJsonMapper', () => {
  it('reads detail, status and field errors from an RFC 9457 body', () => {
    const mapped = problemJsonMapper.map(
      failure({
        status: 422,
        contentType: 'application/problem+json; charset=utf-8',
        error: {
          type: 'https://example.test/probs/validation',
          title: 'Unprocessable Entity',
          status: 422,
          detail: 'Title must be present.',
          errors: { title: ['is required'] },
        },
      })
    );

    expect(mapped).toEqual({
      status: 422,
      message: 'Title must be present.',
      errors: { title: ['is required'] },
    });
  });

  it('falls back to title when the body carries no detail', () => {
    const mapped = problemJsonMapper.map(
      failure({
        status: 409,
        contentType: 'application/problem+json',
        error: { title: 'Conflict', status: 409 },
      })
    );

    expect(mapped?.message).toBe('Conflict');
  });

  // The word `title` in a hand-rolled envelope does not mean the sender intended RFC
  // 9457; the media type is the part the RFC specifies, so that is what is checked.
  it('defers on a body with the right shape but the wrong content type', () => {
    expect(
      problemJsonMapper.map(
        failure({ contentType: 'application/json', error: { title: 'Conflict' } })
      )
    ).toBeNull();
  });

  it('defers when a problem+json response carries neither detail nor title', () => {
    expect(
      problemJsonMapper.map(
        failure({ contentType: 'application/problem+json', error: { status: 409 } })
      )
    ).toBeNull();
  });
});

describe('messageEnvelopeMapper', () => {
  it('reads message and errors from the envelope', () => {
    expect(
      messageEnvelopeMapper.map(
        failure({
          status: 422,
          error: { message: 'Validation failed', errors: { title: ['nope'] } },
        })
      )
    ).toEqual({ status: 422, message: 'Validation failed', errors: { title: ['nope'] } });
  });

  it('normalises a single-string field error into an array', () => {
    expect(
      messageEnvelopeMapper.map(failure({ error: { errors: { title: 'is required' } } }))?.errors
    ).toEqual({ title: ['is required'] });
  });

  it('defers on a body carrying neither key, so the fallback names the status', () => {
    expect(messageEnvelopeMapper.map(failure({ error: {} }))).toBeNull();
    expect(messageEnvelopeMapper.map(failure({ error: { data: null } }))).toBeNull();
  });

  it('defers on a blank message rather than reporting an empty one', () => {
    expect(messageEnvelopeMapper.map(failure({ error: { message: '   ' } }))).toBeNull();
  });
});

describe('stringBodyMapper', () => {
  it('takes a bare string body as the message', () => {
    expect(stringBodyMapper.map(failure({ status: 502, error: 'upstream timed out' }))).toEqual({
      status: 502,
      message: 'upstream timed out',
    });
  });

  it('defers on a whitespace-only body', () => {
    expect(stringBodyMapper.map(failure({ error: '\n  ' }))).toBeNull();
  });
});

describe('fallbackApiError', () => {
  it("keeps the status and Angular's own description of the failure", () => {
    const mapped = fallbackApiError(failure({ status: 500, statusText: 'Internal Server Error' }));

    expect(mapped.status).toBe(500);
    expect(mapped.message).toContain('500');
  });

  // `message` is a plain field Angular assigns in the constructor, so `spyOnProperty`
  // has no accessor to replace — redefining the value is the only way to reach the
  // branch that exists for a response Angular did not describe.
  it('has something to say even when the response describes itself as nothing', () => {
    const blank = new HttpErrorResponse({ status: 500, statusText: '' });
    Object.defineProperty(blank, 'message', { value: '' });

    expect(fallbackApiError(blank).message).toBe(UNEXPECTED_ERROR_MESSAGE);
  });
});

describe('resolveApiError', () => {
  it('takes the first mapper that answers, in the order given', () => {
    const mappers = [alwaysMapper('first'), alwaysMapper('second')];

    expect(resolveApiError(failure(), mappers).message).toBe('first');
  });

  it('moves on when a mapper defers', () => {
    const abstains: ApiErrorMapper = { name: 'abstains', map: () => null };

    expect(resolveApiError(failure(), [abstains, alwaysMapper('next')]).message).toBe('next');
  });

  it('asks no further mappers once one has answered', () => {
    const later = jasmine.createSpy('map').and.returnValue(null);

    resolveApiError(failure(), [alwaysMapper('first'), { name: 'later', map: later }]);

    expect(later).not.toHaveBeenCalled();
  });

  it('falls back rather than throwing when every mapper defers', () => {
    expect(resolveApiError(failure({ status: 418 }), []).status).toBe(418);
  });
});

describe('BUILT_IN_API_ERROR_MAPPERS', () => {
  it('resolves a problem+json body ahead of the envelope reading its title', () => {
    const mapped = resolveApiError(
      failure({
        status: 422,
        contentType: 'application/problem+json',
        error: { title: 'Unprocessable Entity', detail: 'Title must be present.' },
      }),
      BUILT_IN_API_ERROR_MAPPERS
    );

    expect(mapped.message).toBe('Title must be present.');
  });

  // Both mappers can read `{ message: … }`; the envelope has to win, or a JSON body
  // would be reported as `[object Object]` by whichever stringifier ran first.
  it('prefers the envelope over the string body mapper for an object body', () => {
    const mapped = resolveApiError(
      failure({ status: 404, error: { message: 'Not found' } }),
      BUILT_IN_API_ERROR_MAPPERS
    );

    expect(mapped.message).toBe('Not found');
  });

  // The order is the whole contract of the array — `resolveApiError` reads it
  // positionally — so it is asserted rather than left to whoever edits the list next.
  it('is ordered specific-to-general, and names every mapper uniquely', () => {
    const names = BUILT_IN_API_ERROR_MAPPERS.map((mapper) => mapper.name);

    expect(names).toEqual(['offline', 'problem-json', 'message-envelope', 'string-body']);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('provideApiErrorMappers', () => {
  it('registers nothing when given nothing, leaving the token unprovided', () => {
    TestBed.configureTestingModule({ providers: [provideApiErrorMappers()] });

    expect(TestBed.inject(API_ERROR_MAPPERS, undefined, { optional: true })).toBeNull();
  });

  /**
   * The trap, pinned so nobody has to rediscover it.
   *
   * A lazy-loaded route's `providers` build a child environment injector. Calling
   * `provideApiErrorMappers` there does **not** append to what the root contributed — a
   * `multi: true` token resolves in the nearest injector that provides it and Angular
   * does not merge the ancestors' contributions in, so the route sees its own mapper and
   * nothing else. A route that wants the built-ins too has to spread them itself.
   */
  it('shadows rather than extends the parent when a child injector provides it', () => {
    const specialist = alwaysMapper('specialist');
    TestBed.configureTestingModule({
      providers: [provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS)],
    });
    const root = TestBed.inject(EnvironmentInjector);

    const shadowing = createEnvironmentInjector([provideApiErrorMappers(specialist)], root);
    expect(shadowing.get(API_ERROR_MAPPERS).map((mapper) => mapper.name)).toEqual(['specialist']);

    const composed = createEnvironmentInjector(
      [provideApiErrorMappers(specialist, ...BUILT_IN_API_ERROR_MAPPERS)],
      root
    );
    expect(composed.get(API_ERROR_MAPPERS).length).toBe(BUILT_IN_API_ERROR_MAPPERS.length + 1);
  });

  it('leaves an injector that never provides it resolving through to the parent', () => {
    TestBed.configureTestingModule({
      providers: [provideApiErrorMappers(...BUILT_IN_API_ERROR_MAPPERS)],
    });

    const child = createEnvironmentInjector([], TestBed.inject(EnvironmentInjector));

    expect(child.get(API_ERROR_MAPPERS).length).toBe(BUILT_IN_API_ERROR_MAPPERS.length);
  });
});
