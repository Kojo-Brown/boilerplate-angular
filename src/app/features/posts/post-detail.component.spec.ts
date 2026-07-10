import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { PostDetailComponent } from './post-detail.component';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe('PostDetailComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTanStackQuery(createTestQueryClient()),
      ],
    }).compileComponents();
  });

  it('renders back link', () => {
    const fixture = TestBed.createComponent(PostDetailComponent);
    fixture.detectChanges();
    const link = fixture.debugElement.query(By.css('a[routerLink]'));
    expect(link.attributes['routerLink']).toBe('/dashboard/posts');
  });

  it('shows skeleton while loading when id is set', () => {
    const fixture = TestBed.createComponent(PostDetailComponent);
    fixture.componentRef.setInput('id', 'post-123');
    fixture.detectChanges();
    const skeletons = fixture.debugElement.queryAll(By.css('.animate-pulse'));
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('id input defaults to empty string', () => {
    const fixture = TestBed.createComponent(PostDetailComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.id()).toBe('');
  });
});
