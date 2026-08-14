import { HttpClient, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EmptyError, EMPTY, of, Subject, throwError } from 'rxjs';
import { abortableRequest } from './abortable-request';

const URL = '/api/thing';

describe('abortableRequest', () => {
  describe('promise semantics', () => {
    it('resolves with the last value the source emitted before completing', async () => {
      const controller = new AbortController();
      await expectAsync(abortableRequest(of(1, 2, 3), controller.signal)).toBeResolvedTo(3);
    });

    it('rejects with the error the source produced', async () => {
      const controller = new AbortController();
      const failure = new Error('upstream exploded');
      await expectAsync(
        abortableRequest(
          throwError(() => failure),
          controller.signal
        )
      ).toBeRejectedWith(failure);
    });

    it('rejects with EmptyError when the source completes without emitting', async () => {
      const controller = new AbortController();
      await expectAsync(abortableRequest(EMPTY, controller.signal)).toBeRejectedWithError(
        EmptyError
      );
    });
  });

  describe('abort handling', () => {
    it('never subscribes when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      let subscribed = false;
      const source = new Subject<number>();
      const observed = new Proxy(source, {
        get(target, prop, receiver) {
          if (prop === 'subscribe') subscribed = true;
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });

      await expectAsync(abortableRequest(observed, controller.signal)).toBeRejected();
      expect(subscribed).toBeFalse();
    });

    it('unsubscribes from an in-flight source when the signal aborts', async () => {
      const controller = new AbortController();
      const source = new Subject<number>();
      const promise = abortableRequest(source, controller.signal);

      expect(source.observed).toBeTrue();
      controller.abort();

      expect(source.observed).toBeFalse();
      await expectAsync(promise).toBeRejected();
    });

    it('rejects with an AbortError when the abort carried no reason', async () => {
      const controller = new AbortController();
      const promise = abortableRequest(new Subject<number>(), controller.signal);
      controller.abort();

      await expectAsync(promise).toBeRejected();
      await promise.catch((error: unknown) => {
        expect(error instanceof DOMException).toBeTrue();
        expect((error as DOMException).name).toBe('AbortError');
      });
    });

    it('rejects with the reason the caller aborted with', async () => {
      const controller = new AbortController();
      const reason = new Error('superseded by a newer request');
      const promise = abortableRequest(new Subject<number>(), controller.signal);
      controller.abort(reason);

      await expectAsync(promise).toBeRejectedWith(reason);
    });

    it('ignores an abort that arrives after the source already completed', async () => {
      const controller = new AbortController();
      const source = new Subject<number>();
      const promise = abortableRequest(source, controller.signal);

      source.next(7);
      source.complete();

      // A late abort must not turn a settled promise into a rejection, and must not
      // find a listener still attached to a signal that may outlive this request.
      controller.abort();

      await expectAsync(promise).toBeResolvedTo(7);
    });

    it('removes its abort listener once the request has settled', async () => {
      const controller = new AbortController();
      const removeSpy = spyOn(controller.signal, 'removeEventListener').and.callThrough();
      const source = new Subject<number>();
      const promise = abortableRequest(source, controller.signal);

      source.next(1);
      source.complete();

      await expectAsync(promise).toBeResolvedTo(1);
      expect(removeSpy).toHaveBeenCalledWith('abort', jasmine.any(Function));
    });
  });

  describe('with HttpClient', () => {
    let http: HttpClient;
    let backend: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [provideHttpClient(), provideHttpClientTesting()],
      });
      http = TestBed.inject(HttpClient);
      backend = TestBed.inject(HttpTestingController);
    });

    afterEach(() => backend.verify());

    it('cancels the underlying HTTP request when the signal aborts', async () => {
      const controller = new AbortController();
      const promise = abortableRequest(http.get<{ id: string }>(URL), controller.signal);
      const request = backend.expectOne(URL);

      expect(request.cancelled).toBeFalse();
      controller.abort();

      // Unsubscription is the only cancellation `HttpClient` understands; this is the
      // assertion that the whole function exists for.
      expect(request.cancelled).toBeTrue();
      await expectAsync(promise).toBeRejected();
    });

    it('resolves with the response body when the request is not aborted', async () => {
      const controller = new AbortController();
      const promise = abortableRequest(http.get<{ id: string }>(URL), controller.signal);

      backend.expectOne(URL).flush({ id: 'post-1' });

      await expectAsync(promise).toBeResolvedTo({ id: 'post-1' });
    });

    it('sends no request at all when the signal aborted before the call', async () => {
      const controller = new AbortController();
      controller.abort();

      await expectAsync(abortableRequest(http.get(URL), controller.signal)).toBeRejected();

      backend.expectNone(URL);
    });
  });
});
