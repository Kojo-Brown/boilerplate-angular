import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { environment } from '@/environments/environment';
import type { ApiRequestOptions } from './models/api.models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  get<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.get<T>(this.url(path), { params: this.buildParams(options?.params) });
  }

  post<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.post<T>(this.url(path), body, { params: this.buildParams(options?.params) });
  }

  put<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.put<T>(this.url(path), body, { params: this.buildParams(options?.params) });
  }

  patch<T>(path: string, body: unknown, options?: ApiRequestOptions): Observable<T> {
    return this.http.patch<T>(this.url(path), body, {
      params: this.buildParams(options?.params),
    });
  }

  delete<T>(path: string, options?: ApiRequestOptions): Observable<T> {
    return this.http.delete<T>(this.url(path), { params: this.buildParams(options?.params) });
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private buildParams(
    params?: Record<string, string | number | boolean>
  ): HttpParams | undefined {
    if (!params) return undefined;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.set(k, String(v)),
      new HttpParams()
    );
  }
}
