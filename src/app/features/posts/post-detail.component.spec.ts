import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '@/environments/environment';
import { createMockPost } from '@/testing';
import { PostDetailComponent } from './post-detail.component';
import { HttpPostsService } from './http-posts.service';
import { providePostsBackend } from './posts.providers';

const BASE = `${environment.apiUrl}/posts`;

describe('PostDetailComponent', () => {
  let backend: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        ...providePostsBackend(HttpPostsService),
      ],
    }).compileComponents();
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  function createFixture(id?: string) {
    const fixture = TestBed.createComponent(PostDetailComponent);
    if (id !== undefined) fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return fixture;
  }

  it('renders back link', () => {
    const fixture = createFixture();
    const link = fixture.debugElement.query(By.css('a[routerLink]'));
    expect(link.attributes['routerLink']).toBe('/dashboard/posts');
  });

  it('shows skeleton while loading when id is set', () => {
    const fixture = createFixture('post-123');
    const skeletons = fixture.debugElement.queryAll(By.css('.animate-pulse'));

    expect(skeletons.length).toBeGreaterThan(0);
    backend.expectOne(`${BASE}/post-123`).flush(createMockPost({ id: 'post-123' }));
  });

  it('id input defaults to empty string', () => {
    const fixture = createFixture();
    expect(fixture.componentInstance.id()).toBe('');
  });

  it('requests nothing while the id is unset', () => {
    createFixture();
    expect(backend.match(() => true).length).toBe(0);
  });

  it('renders the post once it has loaded', async () => {
    const fixture = createFixture('post-1');
    backend
      .expectOne(`${BASE}/post-1`)
      .flush(createMockPost({ id: 'post-1', title: 'Signals in Angular', body: 'Body text.' }));
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Signals in Angular');
    expect(text).toContain('Body text.');
  });

  it('renders the error branch without reading the resource value', async () => {
    const fixture = createFixture('missing');
    backend
      .expectOne(`${BASE}/missing`)
      .flush({ message: 'gone' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    // `value()` throws in the error state, so this asserts the template's branch order
    // as much as its wording: a template that read the value first would throw here.
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Post not found or failed to load.');
  });

  it('cancels the in-flight request when the component is destroyed', () => {
    const fixture = createFixture('post-1');
    const request = backend.expectOne(`${BASE}/post-1`);

    fixture.destroy();

    expect(request.cancelled).toBeTrue();
  });
});
