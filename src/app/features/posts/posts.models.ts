export interface Post {
  id: string;
  title: string;
  body: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePostDto {
  title: string;
  body: string;
}

export interface UpdatePostDto {
  title?: string;
  body?: string;
}

export interface PostsListParams {
  page?: number;
  pageSize?: number;
  search?: string;
}
