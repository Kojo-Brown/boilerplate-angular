import { TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';
import { environment } from '@/environments/environment';
import { provideHttpTestDeps } from '@/testing';
import { InviteService } from './invite.service';
import type { InviteCheckResult } from './invite.service';

describe('InviteService', () => {
  let service: InviteService;
  let httpMock: HttpTestingController;

  const url = `${environment.apiUrl}/auth/invites/check`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideHttpTestDeps() });
    service = TestBed.inject(InviteService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts the pair rather than putting the code in a query string', () => {
    service.check('jane@example.com', 'WS-0000-0001').subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'jane@example.com', code: 'WS-0000-0001' });
    expect(req.request.urlWithParams).toBe(url);
    req.flush({ problem: null });
  });

  it('passes the server verdict through unchanged', () => {
    let result: InviteCheckResult | undefined;
    service.check('jane@example.com', 'WS-0000-0001').subscribe((value) => (result = value));

    httpMock.expectOne(url).flush({ problem: 'That code has expired' });

    expect(result).toEqual({ problem: 'That code has expired' });
  });

  it('aborts the request when its subscriber unsubscribes', () => {
    const subscription = service.check('jane@example.com', 'WS-0000-0001').subscribe();
    const req = httpMock.expectOne(url);
    expect(req.cancelled).toBeFalse();

    // The cancellation `asyncCrossFieldValidator` relies on: it supersedes a check by
    // unsubscribing, which only aborts anything because this is an Observable.
    subscription.unsubscribe();

    expect(req.cancelled).toBeTrue();
  });
});
