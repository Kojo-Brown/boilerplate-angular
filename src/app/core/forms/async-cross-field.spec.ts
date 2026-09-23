import { Component } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { HttpTestingController } from '@angular/common/http/testing';
import { Subject, of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import type { AbstractControl, ValidationErrors } from '@angular/forms';
import { provideHttpTestDeps } from '@/testing';
import { asyncCrossFieldValidator, revalidateWhen } from './async-cross-field';

const DEBOUNCE = 400;

/** `{ email, code }` flattened, so the default `Object.is` comparison is meaningful. */
function pairKey(control: AbstractControl): string | null {
  const code = String(control.value ?? '').trim();
  const email = String(control.parent?.get('email')?.value ?? '').trim();
  return code.length > 0 && email.length > 0 ? `${email}\u0000${code}` : null;
}

interface Pair {
  readonly group: FormGroup<{ email: FormControl<string>; code: FormControl<string> }>;
  readonly email: FormControl<string>;
  readonly code: FormControl<string>;
}

function createPair(): Pair {
  const email = new FormControl('', { nonNullable: true });
  const code = new FormControl('', { nonNullable: true });
  return { group: new FormGroup({ email, code }), email, code };
}

describe('asyncCrossFieldValidator', () => {
  it('rejects a debounce that is not a finite, non-negative number', () => {
    const check = (): Observable<ValidationErrors | null> => of(null);

    expect(() => asyncCrossFieldValidator(pairKey, check, { debounceMs: -1 })).toThrowError(
      RangeError
    );
    expect(() => asyncCrossFieldValidator(pairKey, check, { debounceMs: Infinity })).toThrowError(
      RangeError
    );
  });

  it('rejects a cache size that is not a non-negative integer', () => {
    const check = (): Observable<ValidationErrors | null> => of(null);

    expect(() => asyncCrossFieldValidator(pairKey, check, { cacheSize: -1 })).toThrowError(
      RangeError
    );
    expect(() => asyncCrossFieldValidator(pairKey, check, { cacheSize: 1.5 })).toThrowError(
      RangeError
    );
  });

  describe('against a scripted check', () => {
    let pair: Pair;
    let check: jasmine.Spy<(key: string) => Observable<ValidationErrors | null>>;

    /** Answers every call with `errors`, synchronously. */
    function answering(errors: ValidationErrors | null): void {
      check.and.returnValue(of(errors));
    }

    beforeEach(() => {
      pair = createPair();
      check = jasmine.createSpy('check');
      answering(null);
      pair.code.addAsyncValidators(asyncCrossFieldValidator(pairKey, check));
    });

    it('skips the check entirely when the key is null', fakeAsync(() => {
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      // No email yet, so there is no pair to ask about.
      expect(check).not.toHaveBeenCalled();
      expect(pair.code.errors).toBeNull();
      expect(pair.code.pending).toBeFalse();
    }));

    it('waits out the debounce before checking', fakeAsync(() => {
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');

      tick(DEBOUNCE - 1);
      expect(check).not.toHaveBeenCalled();
      expect(pair.code.pending).toBeTrue();

      tick(1);
      expect(check).toHaveBeenCalledOnceWith('jane@example.com\u0000WS-1');
      expect(pair.code.pending).toBeFalse();
    }));

    it('collapses rapid edits into a single check', fakeAsync(() => {
      pair.email.setValue('jane@example.com');

      for (const code of ['W', 'WS', 'WS-', 'WS-1']) {
        pair.code.setValue(code);
        tick(DEBOUNCE / 4);
      }
      tick(DEBOUNCE);

      expect(check).toHaveBeenCalledOnceWith('jane@example.com\u0000WS-1');
    }));

    it('reports the errors the check returns', fakeAsync(() => {
      answering({ invite: 'That code belongs to another workspace' });
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      expect(pair.code.errors).toEqual({ invite: 'That code belongs to another workspace' });
      expect(pair.group.valid).toBeFalse();
    }));

    it('answers a repeated key from the cache, without a second check', fakeAsync(() => {
      answering({ invite: 'Expired' });
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);
      expect(check).toHaveBeenCalledTimes(1);

      pair.code.setValue('WS-2');
      tick(DEBOUNCE);
      pair.code.setValue('WS-1');

      // Synchronously, without waiting out a second debounce: the control never enters
      // PENDING for a pair that has already been settled.
      expect(pair.code.pending).toBeFalse();
      expect(pair.code.errors).toEqual({ invite: 'Expired' });
      expect(check).toHaveBeenCalledTimes(2);
    }));

    it('stops caching past cacheSize', fakeAsync(() => {
      const bounded = createPair();
      const boundedCheck = jasmine
        .createSpy<(key: string) => Observable<ValidationErrors | null>>('check')
        .and.returnValue(of(null));
      bounded.code.addAsyncValidators(
        asyncCrossFieldValidator(pairKey, boundedCheck, { cacheSize: 1 })
      );
      bounded.email.setValue('jane@example.com');

      for (const code of ['A', 'B', 'A']) {
        bounded.code.setValue(code);
        tick(DEBOUNCE);
      }

      // 'A' was evicted by 'B', so the third edit is a third request.
      expect(boundedCheck).toHaveBeenCalledTimes(3);
    }));

    it('checks every time when the cache is disabled', fakeAsync(() => {
      const uncached = createPair();
      const uncachedCheck = jasmine
        .createSpy<(key: string) => Observable<ValidationErrors | null>>('check')
        .and.returnValue(of(null));
      uncached.code.addAsyncValidators(
        asyncCrossFieldValidator(pairKey, uncachedCheck, { cacheSize: 0 })
      );
      uncached.email.setValue('jane@example.com');

      for (const code of ['A', 'B', 'A']) {
        uncached.code.setValue(code);
        tick(DEBOUNCE);
      }

      expect(uncachedCheck).toHaveBeenCalledTimes(3);
    }));

    it('fails open when the check errors', fakeAsync(() => {
      check.and.returnValue(throwError(() => new Error('offline')));
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      expect(pair.code.errors).toBeNull();
      expect(pair.code.pending).toBeFalse();
    }));

    it('reports onFailure instead when the caller asks it to', fakeAsync(() => {
      const strict = createPair();
      strict.code.addAsyncValidators(
        asyncCrossFieldValidator(pairKey, () => throwError(() => new Error('offline')), {
          onFailure: { unreachable: true },
        })
      );
      strict.email.setValue('jane@example.com');
      strict.code.setValue('WS-1');
      tick(DEBOUNCE);

      expect(strict.code.errors).toEqual({ unreachable: true });
    }));

    it('does not memoise a failure', fakeAsync(() => {
      check.and.returnValue(throwError(() => new Error('offline')));
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      answering({ invite: 'Expired' });
      pair.code.setValue('WS-2');
      tick(DEBOUNCE);
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      expect(check).toHaveBeenCalledTimes(3);
      expect(pair.code.errors).toEqual({ invite: 'Expired' });
    }));

    it('leaves PENDING even when the check never completes', fakeAsync(() => {
      const answers = new Subject<ValidationErrors | null>();
      check.and.returnValue(answers);
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);
      expect(pair.code.pending).toBeTrue();

      // A Subject emits without completing. Angular holds a control PENDING until the
      // validator's Observable *completes*, so without the `take(1)` inside the validator
      // this control would stay PENDING — and the form permanently unsubmittable — even
      // though the answer has arrived.
      answers.next({ invite: 'Expired' });

      expect(pair.code.pending).toBeFalse();
      expect(pair.code.errors).toEqual({ invite: 'Expired' });
    }));
  });

  describe('cancellation, against a real HttpClient', () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;
    let pair: Pair;

    beforeEach(() => {
      TestBed.configureTestingModule({ providers: provideHttpTestDeps() });
      http = TestBed.inject(HttpClient);
      httpMock = TestBed.inject(HttpTestingController);

      pair = createPair();
      pair.code.addAsyncValidators(
        asyncCrossFieldValidator(pairKey, (key) =>
          http.post<ValidationErrors | null>('/invites/check', { key })
        )
      );
    });

    afterEach(() => {
      httpMock.verify();
    });

    it('aborts a request that is still in flight when the value changes again', fakeAsync(() => {
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE);

      const first = httpMock.expectOne('/invites/check');
      expect(first.cancelled).toBeFalse();

      pair.code.setValue('WS-2');
      // The moment Angular starts the next validation run it unsubscribes from this one,
      // which for HttpClient aborts the request rather than leaving it to land into a
      // form that has moved on.
      expect(first.cancelled).toBeTrue();

      tick(DEBOUNCE);
      httpMock.expectOne('/invites/check').flush(null);
      expect(pair.code.pending).toBeFalse();
    }));

    it('never opens a request for edits made inside the debounce window', fakeAsync(() => {
      pair.email.setValue('jane@example.com');
      pair.code.setValue('WS-1');
      tick(DEBOUNCE - 1);
      httpMock.expectNone('/invites/check');

      pair.code.setValue('WS-2');
      tick(DEBOUNCE);

      httpMock.expectOne('/invites/check').flush(null);
    }));
  });
});

/** Owns the `revalidateWhen` subscription, so destroying it is the real teardown path. */
@Component({ standalone: true, template: '' })
class RevalidateHost {
  constructor() {
    revalidateWhen(hostPair.code, [hostPair.email]);
  }
}

let hostPair: Pair;

describe('revalidateWhen', () => {
  beforeEach(() => {
    hostPair = createPair();
    TestBed.configureTestingModule({ imports: [RevalidateHost] });
  });

  function checking(errors: ValidationErrors | null, pair: Pair) {
    const check = jasmine
      .createSpy<(key: string) => Observable<ValidationErrors | null>>('check')
      .and.returnValue(of(errors));
    pair.code.addAsyncValidators(asyncCrossFieldValidator(pairKey, check));
    return check;
  }

  it('re-runs the target validators when a source changes', fakeAsync(() => {
    const pair = createPair();
    const check = checking({ invite: 'Wrong address' }, pair);

    pair.email.setValue('jane@example.com');
    pair.code.setValue('WS-1');
    tick(DEBOUNCE);
    expect(check).toHaveBeenCalledOnceWith('jane@example.com\u0000WS-1');

    TestBed.runInInjectionContext(() => revalidateWhen(pair.code, [pair.email]));

    pair.email.setValue('jane@other.example');
    tick(DEBOUNCE);

    expect(check).toHaveBeenCalledTimes(2);
    expect(check).toHaveBeenCalledWith('jane@other.example\u0000WS-1');
  }));

  it('does not re-check a pair the validator has already settled', fakeAsync(() => {
    const pair = createPair();
    const check = checking(null, pair);
    TestBed.runInInjectionContext(() => revalidateWhen(pair.code, [pair.email]));

    pair.email.setValue('jane@example.com');
    pair.code.setValue('WS-1');
    tick(DEBOUNCE);
    expect(check).toHaveBeenCalledTimes(1);

    // A round trip back to a pair the validator has already answered. Every one of these
    // revalidates the code field; only the middle one is a new question.
    pair.email.setValue('jane@other.example');
    tick(DEBOUNCE);
    pair.email.setValue('jane@example.com');
    tick(DEBOUNCE);

    expect(check).toHaveBeenCalledTimes(2);
  }));

  it('refuses a source that is the target itself', () => {
    const pair = createPair();
    expect(() =>
      TestBed.runInInjectionContext(() => revalidateWhen(pair.code, [pair.code]))
    ).toThrowError(/may not be the target or one of its ancestors/);
  });

  it('refuses a source that is an ancestor of the target', () => {
    const pair = createPair();
    expect(() =>
      TestBed.runInInjectionContext(() => revalidateWhen(pair.code, [pair.group]))
    ).toThrowError(/may not be the target or one of its ancestors/);
  });

  it('stops revalidating once its owner is destroyed', fakeAsync(() => {
    const check = jasmine
      .createSpy<(key: string) => Observable<ValidationErrors | null>>('check')
      .and.returnValue(of(null));
    // No cache, so a revalidation that did happen would show up as another call rather
    // than being absorbed by a hit.
    hostPair.code.addAsyncValidators(asyncCrossFieldValidator(pairKey, check, { cacheSize: 0 }));

    const fixture = TestBed.createComponent(RevalidateHost);
    fixture.detectChanges();

    hostPair.email.setValue('jane@example.com');
    hostPair.code.setValue('WS-1');
    tick(DEBOUNCE);
    expect(check).toHaveBeenCalledTimes(1);

    fixture.destroy();

    hostPair.email.setValue('jane@other.example');
    tick(DEBOUNCE);
    expect(check).toHaveBeenCalledTimes(1);
  }));
});
