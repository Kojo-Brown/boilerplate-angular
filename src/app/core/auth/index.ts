export { AuthFacade } from './auth.facade';
export type { AuthFacadeApi } from './auth.facade';

/**
 * The domain types the facade speaks, re-exported so a component never has to reach into
 * `@/app/store/**` for a type — an import `eslint.config.mjs` refuses in `features/` and
 * `shared/`. They describe the domain, not the store: moving off `@ngrx/signals` would
 * leave `User` and `LoginCredentials` exactly as they are.
 */
export type { LoginCredentials, RegisterCredentials, User } from '@/app/store/auth/auth.models';
