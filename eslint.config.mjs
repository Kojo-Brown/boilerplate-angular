// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', '.angular/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.spec.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { confirmPassword: _, ...credentials } = value` is the standard
          // way to drop a field before submitting; the omitted sibling is not dead code.
          ignoreRestSiblings: true,
        },
      ],
      // Angular's decorated classes are legitimately empty — a routed
      // `@Component` whose behaviour lives entirely in its template has no members.
      // The rule targets classes used as namespaces, which a decorator rules out.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // Off because the rule cannot see `void` in a *call expression's* type arguments
      // (`http.post<void>(url)`, `rxMethod<void>(...)`) — it only inspects type
      // annotations, so `allowInGenericTypeArguments` (on by default) never applies and
      // every such call is a false positive. `HttpClient.post<void>()` is the documented
      // Angular idiom for a no-content response and `rxMethod<void>()` for a no-argument
      // NgRx signal method, so the rule flags only correct code in this codebase.
      // Genuine misuse (`let x: void`, `void` in a union) is already a type error under
      // `strict`. Revisit if typescript-eslint#8113 lands.
      '@typescript-eslint/no-invalid-void-type': 'off',
    },
  },
  {
    // The platform boundary, as a rule rather than a convention.
    //
    // Since SSR was turned on, everything under `src/app/` runs twice: once in a browser
    // and once in a Node process where `window`, `document` and `localStorage` do not
    // exist. A bare reference to one of them compiles, passes every unit spec — the specs
    // run in a browser — and then throws while the injector is constructing a root
    // service during a render, which takes the whole page with it. `AuthStore` did
    // exactly this until `AUTH_TOKEN_STORAGE` replaced the globals with a seam.
    //
    // The replacements are not workarounds: `inject(DOCUMENT)` is how Angular has always
    // said to reach the DOM, and it is the same call in a test, where it returns the
    // fixture's document rather than the page's.
    //
    // Specs are exempt — they *are* the browser — and so is `src/server.ts`, which has
    // the opposite rule below.
    files: ['src/app/**/*.ts'],
    ignores: ['src/app/**/*.spec.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message:
            'Not defined during server-side rendering. Use `inject(DOCUMENT).defaultView`, which is `null` there — see docs/ssr.md.',
        },
        {
          name: 'document',
          message: 'Not defined during server-side rendering. Use `inject(DOCUMENT)`.',
        },
        {
          name: 'localStorage',
          message:
            'Not defined during server-side rendering. Go through AUTH_TOKEN_STORAGE, THEME_PREFERENCE_STORE, or `storageOf(inject(DOCUMENT).defaultView)` for a new one.',
        },
        {
          name: 'sessionStorage',
          message:
            'Not defined during server-side rendering. Put it behind an injection token, as `storageOf` does for localStorage.',
        },
        {
          name: 'navigator',
          message: 'Not defined during server-side rendering. Reach it via `inject(DOCUMENT).defaultView`.',
        },
      ],
    },
  },
  {
    // The same boundary from the other side. `src/server.ts` is the one file that runs on
    // Node and never in a browser, and `types: ["node"]` in `tsconfig.app.json` — which
    // it needs — puts `process` and friends in scope for the whole program. This keeps
    // the DOM out of the Node file; the rule above keeps Node out of the DOM files.
    files: ['src/server.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'window',
          message: 'src/server.ts runs on Node. The rendered DOM is main.server.ts’s, not this file’s.',
        },
        {
          name: 'document',
          message: 'src/server.ts runs on Node. The rendered DOM is main.server.ts’s, not this file’s.',
        },
      ],
    },
  },
  {
    // The facade boundary, as a rule rather than a convention.
    //
    // `features/` and `shared/` are view code, and view code talks to the auth domain
    // through `AuthFacade` in `@/app/core/auth`. Without a rule here the pattern lasts
    // exactly until the next person types `inject(AuthStore)` — it compiles, it works,
    // and the seam is gone. `docs/facade.md` explains what the seam is worth.
    //
    // `core/` is exempt on purpose: `authGuard`, `roleGuard`, `jwtInterceptor` and
    // `app.config.ts` coordinate the session lifecycle (restore, rotate, redirect) and
    // legitimately need the store's full surface. So is `src/testing/`, which builds the
    // doubles for both layers.
    //
    // The base rule rather than `@typescript-eslint/no-restricted-imports`: its extra
    // option is `allowTypeImports`, and a type pulled from `@/app/store/**` is exactly
    // what this is meant to stop — `@/app/core/auth` re-exports the domain types.
    files: ['src/app/features/**/*.ts', 'src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ngrx/*', '@ngrx/**'],
              message:
                'View code must not depend on the state library. Use AuthFacade from @/app/core/auth, or add the read you need to it.',
            },
            {
              group: ['@/app/store/*', '@/app/store/**', '**/app/store/*', '**/app/store/**'],
              message:
                'Components go through AuthFacade (@/app/core/auth), which also re-exports User, LoginCredentials and RegisterCredentials. See docs/facade.md.',
            },
          ],
        },
      ],
    },
  }
);
