/**
 * HTTP client for the WMH backend (backend/README.md has the full endpoint list).
 *
 * - Base URL comes from EXPO_PUBLIC_API_BASE_URL (.env, or eas.json for cloud builds).
 * - Every error becomes an `ApiError` with the backend's `{ error: { code, message } }`.
 * - Network failures and timeouts become `ApiError(0, 'NETWORK_ERROR', …)`.
 *
 * Authenticated calls take an ID token; `src/services/session.ts` supplies a fresh one.
 */
import type { User } from '@/types';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

/** A user-facing message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  return 'Something went wrong. Please try again.';
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, opts: { body?: unknown; token?: string } = {}): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      0,
      'NOT_CONFIGURED',
      'API URL is not set. Add EXPO_PUBLIC_API_BASE_URL to .env and restart Expo.',
    );
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your internet connection and try again.");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const body = data as { error?: { code?: string; message?: string }; message?: string } | null;
    // Our Lambdas send { error: {code, message} }. API Gateway's own rejections
    // (JWT authorizer, throttling) send { message: "Unauthorized" } instead.
    const code = body?.error?.code ?? (res.status === 401 ? 'UNAUTHORIZED' : res.status === 429 ? 'TOO_MANY_REQUESTS' : `HTTP_${res.status}`);
    const message =
      body?.error?.message ??
      (res.status === 401
        ? 'Your session has expired. Please log in again.'
        : res.status === 429
          ? 'Too many requests. Please wait a moment and try again.'
          : `Request failed (${res.status}).`);
    throw new ApiError(res.status, code, message);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// Response shapes (backend/src/auth.py, backend/src/me.py)
// ---------------------------------------------------------------------------
export interface CodeDelivery {
  medium: string | null;
  /** Masked address, e.g. "n***@g***". */
  destination: string | null;
}

export interface LoginResponse {
  /** Cognito ID token; send as `Authorization: Bearer <token>`. */
  token: string;
  refresh_token: string;
  /** Seconds until `token` expires (3600). */
  expires_in: number;
  user: User;
}

export interface RefreshResponse {
  token: string;
  expires_in: number;
  /** Only present if refresh-token rotation is ever enabled server-side. */
  refresh_token?: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export type MePatch = Partial<Pick<User, 'name' | 'phone'>>;

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
export const authApi = {
  register: (input: RegisterInput) =>
    request<{ user_confirmed: boolean; code_delivery: CodeDelivery | null }>('POST', '/auth/register', {
      body: input,
    }),
  confirm: (email: string, code: string) =>
    request<{ confirmed: true }>('POST', '/auth/confirm', { body: { email, code } }),
  resendCode: (email: string) =>
    request<{ code_delivery: CodeDelivery | null }>('POST', '/auth/resend-code', { body: { email } }),
  login: (email: string, password: string) =>
    request<LoginResponse>('POST', '/auth/login', { body: { email, password } }),
  refresh: (refreshToken: string) =>
    request<RefreshResponse>('POST', '/auth/refresh', { body: { refresh_token: refreshToken } }),
  logout: (refreshToken: string) =>
    request<void>('POST', '/auth/logout', { body: { refresh_token: refreshToken } }),
  forgotPassword: (email: string) =>
    request<{ message: string }>('POST', '/auth/password/forgot', { body: { email } }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    request<{ password_reset: true }>('POST', '/auth/password/reset', {
      body: { email, code, new_password: newPassword },
    }),
};

export const meApi = {
  get: (token: string) => request<User>('GET', '/me', { token }),
  patch: (token: string, patch: MePatch) => request<User>('PATCH', '/me', { token, body: patch }),
};
