import type { Type } from '@angular/core';
import { Injectable, inject } from '@angular/core';
import type { DialogConfig, DialogRef } from '@angular/cdk/dialog';
import { Dialog } from '@angular/cdk/dialog';

export interface AppDialogConfig<D = unknown> {
  data?: D;
  width?: string;
  disableClose?: boolean;
  panelClass?: string | string[];
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(Dialog);

  open<C, D = unknown, R = unknown>(
    component: Type<C>,
    config: AppDialogConfig<D> = {}
  ): DialogRef<R, C> {
    const cdkConfig: DialogConfig<D, DialogRef<R, C>> = {
      data: config.data,
      disableClose: config.disableClose ?? false,
      panelClass: config.panelClass,
      width: config.width,
      backdropClass: 'cdk-overlay-dark-backdrop',
      hasBackdrop: true,
    };

    return this.dialog.open<R, D, C>(component, cdkConfig);
  }
}
