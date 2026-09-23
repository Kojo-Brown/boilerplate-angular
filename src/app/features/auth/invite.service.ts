import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { ApiService } from '@/app/core/http/api.service';

/**
 * What the server says about one `(email, code)` pair.
 *
 * A message rather than a boolean, because the three ways a code can fail to apply read
 * differently to the person typing it — expired, already used, issued to a different
 * address — and only the server knows which. `null` is the accepting answer.
 */
export interface InviteCheckResult {
  readonly problem: string | null;
}

/**
 * The invite check as its caller sees it, so a test double is checked by the compiler
 * rather than by whichever spec renders `RegisterComponent` first — `ValueProvider.useValue`
 * is typed `any`, so `{ provide: InviteService, useValue: {} }` otherwise compiles.
 */
export interface InviteCheckerApi {
  check(email: string, code: string): Observable<InviteCheckResult>;
}

/**
 * Asks the server whether a workspace invite code applies to an email address.
 *
 * `POST` and not `GET` for a read: an invite code is a bearer credential for one seat in
 * one workspace, and a query string is the one part of a request that ends up in access
 * logs, browser history and `Referer` headers by default. The body keeps it out of all
 * three. Nothing is created — the endpoint is idempotent — which is the one thing the
 * verb gives up, and a validation probe has no cache to benefit from it anyway.
 *
 * An `Observable` and not a `Promise`, because
 * {@link file://../../core/forms/async-cross-field.ts | asyncCrossFieldValidator} cancels
 * a superseded check by unsubscribing, which for `HttpClient` aborts the request. A
 * `Promise` has no teardown to invoke.
 */
@Injectable({ providedIn: 'root' })
export class InviteService implements InviteCheckerApi {
  private readonly api = inject(ApiService);

  check(email: string, code: string): Observable<InviteCheckResult> {
    return this.api.post<InviteCheckResult>('/auth/invites/check', { email, code });
  }
}
