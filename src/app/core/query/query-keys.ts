export const queryKeys = {
  posts: {
    all: () => ['posts'] as const,
    lists: () => ['posts', 'list'] as const,
    list: (filters: Record<string, unknown>) => ['posts', 'list', filters] as const,
    details: () => ['posts', 'detail'] as const,
    detail: (id: string) => ['posts', 'detail', id] as const,
  },
  users: {
    all: () => ['users'] as const,
    me: () => ['users', 'me'] as const,
    detail: (id: string) => ['users', 'detail', id] as const,
  },
} as const;
