import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from '@/app/store/auth/auth.store';
import type { User } from '@/app/store/auth/auth.models';

export function roleGuard(allowedRoles: User['role'] | User['role'][]): CanActivateFn {
  return (_route, _state) => {
    const authStore = inject(AuthStore);
    const router = inject(Router);

    if (!authStore.isAuthenticated()) {
      return router.createUrlTree(['/login']);
    }

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const userRole = authStore.userRole();

    if (userRole !== null && roles.includes(userRole)) {
      return true;
    }

    return router.createUrlTree(['/unauthorized']);
  };
}
