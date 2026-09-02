import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query-experimental';
import { PostsListComponent } from './posts-list.component';
import { HttpPostsService } from './http-posts.service';
import { providePostsBackend } from './posts.providers';

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

describe('PostsListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PostsListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTanStackQuery(createTestQueryClient()),
        ...providePostsBackend(HttpPostsService),
      ],
    }).compileComponents();
  });

  it('renders the Posts heading', () => {
    const fixture = TestBed.createComponent(PostsListComponent);
    fixture.detectChanges();
    const h1 = fixture.debugElement.query(By.css('h1'));
    expect(h1.nativeElement.textContent.trim()).toBe('Posts');
  });

  it('shows skeleton rows while loading', () => {
    const fixture = TestBed.createComponent(PostsListComponent);
    fixture.detectChanges();
    const skeletons = fixture.debugElement.queryAll(By.css('.animate-pulse'));
    expect(skeletons.length).toBe(5);
  });
});
