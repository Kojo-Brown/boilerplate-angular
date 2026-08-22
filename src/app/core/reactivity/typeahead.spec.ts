import { Component, Injector, signal } from '@angular/core';
import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Subject, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { typeahead } from './typeahead';
import type { Typeahead } from './typeahead';

const DEBOUNCE = 300;

/**
 * A `search` whose every call can be settled by hand, so a spec can land responses in an
 * order the real network would only produce intermittently.
 */
class SearchProbe {
  readonly calls: string[] = [];
  private readonly pending = new Map<string, Subject<readonly string[]>>();

  readonly search = (term: string): Observable<readonly string[]> => {
    this.calls.push(term);
    const subject = new Subject<readonly string[]>();
    this.pending.set(term, subject);
    return subject;
  };

  /** True while the request for `term` still has a subscriber. */
  isOpen(term: string): boolean {
    return this.pending.get(term)?.observed ?? false;
  }

  resolve(term: string, results: readonly string[]): void {
    const subject = this.subjectFor(term);
    subject.next(results);
    subject.complete();
  }

  fail(term: string, error: unknown): void {
    this.subjectFor(term).error(error);
  }

  private subjectFor(term: string): Subject<readonly string[]> {
    const subject = this.pending.get(term);
    if (subject === undefined) {
      throw new Error(
        `No search was issued for "${term}". Issued: ${this.calls.join(', ') || '—'}`
      );
    }
    return subject;
  }
}

@Component({ standalone: true, template: '' })
class HostComponent {
  readonly probe = new SearchProbe();
  readonly query = signal('');
  readonly search: Typeahead<string> = typeahead(this.query, this.probe.search, {
    debounceMs: DEBOUNCE,
    minLength: 2,
  });
}

describe('typeahead', () => {
  function createHost() {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Move `query` on and let `toObservable`'s effect flush, without paying the debounce. */
  function type(fixture: ReturnType<typeof createHost>, value: string): void {
    fixture.componentInstance.query.set(value);
    fixture.detectChanges();
  }

  it('starts idle, with no request issued', () => {
    const fixture = createHost();
    expect(fixture.componentInstance.search.status()).toBe('idle');
    expect(fixture.componentInstance.search.results()).toEqual([]);
    expect(fixture.componentInstance.probe.calls).toEqual([]);
  });

  it('collapses a burst of keystrokes into one request for the final term', fakeAsync(() => {
    const fixture = createHost();
    const { probe } = fixture.componentInstance;

    for (const term of ['a', 'an', 'ang', 'angu']) {
      type(fixture, term);
      tick(DEBOUNCE - 100);
    }
    tick(DEBOUNCE);

    expect(probe.calls).toEqual(['angu']);
  }));

  it('reports `searching` while the request is open and `ready` once it settles', fakeAsync(() => {
    const fixture = createHost();
    const { search, probe } = fixture.componentInstance;

    type(fixture, 'angular');
    tick(DEBOUNCE);
    expect(search.status()).toBe('searching');
    expect(search.term()).toBe('angular');

    probe.resolve('angular', ['Angular 22 release notes']);
    expect(search.status()).toBe('ready');
    expect(search.results()).toEqual(['Angular 22 release notes']);
  }));

  it('trims the term before searching', fakeAsync(() => {
    const fixture = createHost();
    type(fixture, '  angular  ');
    tick(DEBOUNCE);
    expect(fixture.componentInstance.probe.calls).toEqual(['angular']);
  }));

  it('does not re-search a term that only differs by surrounding whitespace', fakeAsync(() => {
    const fixture = createHost();
    type(fixture, 'angular');
    tick(DEBOUNCE);
    fixture.componentInstance.probe.resolve('angular', ['hit']);

    type(fixture, 'angular ');
    tick(DEBOUNCE);

    expect(fixture.componentInstance.probe.calls).toEqual(['angular']);
  }));

  it('stays idle below the minimum length, and issues no request', fakeAsync(() => {
    const fixture = createHost();
    type(fixture, 'a');
    tick(DEBOUNCE);

    expect(fixture.componentInstance.probe.calls).toEqual([]);
    expect(fixture.componentInstance.search.status()).toBe('idle');
  }));

  it('clears results and cancels the open request when the term falls below the minimum', fakeAsync(() => {
    const fixture = createHost();
    const { search, probe } = fixture.componentInstance;

    type(fixture, 'angular');
    tick(DEBOUNCE);
    probe.resolve('angular', ['hit']);
    expect(search.results()).toEqual(['hit']);

    type(fixture, 'a');
    tick(DEBOUNCE);

    expect(search.status()).toBe('idle');
    expect(search.results()).toEqual([]);
  }));

  // The reason this primitive is `switchMap` and not `mergeMap`. Both issue both
  // requests; only `switchMap` guarantees which answer is on screen at the end.
  it('ignores a superseded response that arrives after a newer one', fakeAsync(() => {
    const fixture = createHost();
    const { search, probe } = fixture.componentInstance;

    type(fixture, 'ang');
    tick(DEBOUNCE);
    type(fixture, 'angular');
    tick(DEBOUNCE);

    expect(probe.calls).toEqual(['ang', 'angular']);

    probe.resolve('angular', ['newest']);
    probe.resolve('ang', ['stale']);

    expect(search.results()).toEqual(['newest']);
    expect(search.term()).toBe('angular');
  }));

  it('unsubscribes from the superseded request, so HttpClient aborts it', fakeAsync(() => {
    const fixture = createHost();
    const { probe } = fixture.componentInstance;

    type(fixture, 'ang');
    tick(DEBOUNCE);
    expect(probe.isOpen('ang')).toBeTrue();

    type(fixture, 'angular');
    tick(DEBOUNCE);

    expect(probe.isOpen('ang')).toBeFalse();
    expect(probe.isOpen('angular')).toBeTrue();
  }));

  it('surfaces a failed search as `error` without ending the pipeline', fakeAsync(() => {
    const fixture = createHost();
    const { search, probe } = fixture.componentInstance;
    const failure = new Error('network down');

    type(fixture, 'angular');
    tick(DEBOUNCE);
    probe.fail('angular', failure);

    expect(search.status()).toBe('error');
    expect(search.error()).toBe(failure);
    expect(search.results()).toEqual([]);

    // The property that a `catchError` on the outer Observable would break: the box is
    // still alive, and the next term searches normally.
    type(fixture, 'signals');
    tick(DEBOUNCE);
    probe.resolve('signals', ['Signals in depth']);

    expect(search.status()).toBe('ready');
    expect(search.error()).toBeNull();
    expect(search.results()).toEqual(['Signals in depth']);
  }));

  it('survives a search that fails synchronously on subscribe', fakeAsync(() => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);
    const query = signal('');
    const failure = new Error('bad request');
    const search = typeahead<string>(query, () => throwError(() => failure), {
      debounceMs: DEBOUNCE,
      injector,
    });

    query.set('angular');
    TestBed.tick();
    tick(DEBOUNCE);

    expect(search.status()).toBe('error');
    expect(search.error()).toBe(failure);
  }));

  it('aborts the in-flight request when the owning component is destroyed', fakeAsync(() => {
    const fixture = createHost();
    const { probe } = fixture.componentInstance;

    type(fixture, 'angular');
    tick(DEBOUNCE);
    expect(probe.isOpen('angular')).toBeTrue();

    fixture.destroy();

    expect(probe.isOpen('angular')).toBeFalse();
  }));

  it('issues no further request after destruction', fakeAsync(() => {
    const fixture = createHost();
    const { probe, query } = fixture.componentInstance;

    fixture.destroy();
    query.set('angular');
    tick(DEBOUNCE);

    expect(probe.calls).toEqual([]);
  }));

  it('accepts an explicit injector outside an injection context', fakeAsync(() => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);
    const probe = new SearchProbe();
    const query = signal('');

    let search!: Typeahead<string>;
    setTimeout(() => {
      search = typeahead(query, probe.search, { debounceMs: DEBOUNCE, injector });
    });
    tick();

    query.set('angular');
    TestBed.tick();
    tick(DEBOUNCE);
    probe.resolve('angular', ['hit']);

    expect(search.results()).toEqual(['hit']);
  }));

  it('rejects a debounce that cannot describe a quiet period', () => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);
    const probe = new SearchProbe();

    for (const debounceMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => typeahead(signal(''), probe.search, { debounceMs, injector })).toThrowError(
        RangeError
      );
    }
  });

  it('rejects a minimum length that is not a positive integer', () => {
    TestBed.configureTestingModule({});
    const injector = TestBed.inject(Injector);
    const probe = new SearchProbe();

    for (const minLength of [0, -2, 1.5]) {
      expect(() => typeahead(signal(''), probe.search, { minLength, injector })).toThrowError(
        RangeError
      );
    }
  });
});
