/**
 * HTTP client for the WMH backend (backend/README.md has the full endpoint list).
 *
 * - Base URL comes from EXPO_PUBLIC_API_BASE_URL (.env, or eas.json for cloud builds).
 * - Every error becomes an `ApiError` with the backend's `{ error: { code, message } }`.
 * - Network failures and timeouts become `ApiError(0, 'NETWORK_ERROR', …)`.
 *
 * Authenticated calls take an ID token; `src/services/session.ts` supplies a fresh one.
 */
import type {
  Address,
  AddressInput,
  AdminOrder,
  AdminProduct,
  AdminStore,
  DeliveryBoy,
  DeliveryOrder,
  Category,
  Order,
  OrderStatus,
  PlaceOrderInput,
  Product,
  SpiceLevel,
  StoreStatus,
  User,
} from '@/types';

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

async function request<T>(
  method: Method,
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      0,
      'NOT_CONFIGURED',
      'API URL is not set. Add EXPO_PUBLIC_API_BASE_URL to .env and restart Expo.',
    );
  }

  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
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

/** Public: no token needed. */
export const catalogApi = {
  categories: () => request<Category[]>('GET', '/categories'),
  products: () => request<Product[]>('GET', '/products'),
};

/** Public: is the hotel taking online orders right now? (part 7b) */
export const storeApi = {
  get: () => request<StoreStatus>('GET', '/store'),
};

/** Body for POST / PATCH /addresses: the form fields, without the client-only `id`. */
export type AddressPayload = Omit<AddressInput, 'id'>;

export const addressApi = {
  list: (token: string) => request<Address[]>('GET', '/addresses', { token }),
  create: (token: string, body: AddressPayload) => request<Address>('POST', '/addresses', { token, body }),
  update: (token: string, id: string, body: Partial<AddressPayload>) =>
    request<Address>('PATCH', `/addresses/${encodeURIComponent(id)}`, { token, body }),
  remove: (token: string, id: string) =>
    request<void>('DELETE', `/addresses/${encodeURIComponent(id)}`, { token }),
};

export const meApi = {
  get: (token: string) => request<User>('GET', '/me', { token }),
  patch: (token: string, patch: MePatch) => request<User>('PATCH', '/me', { token, body: patch }),
};

/** One cart line as POST /orders wants it. The server looks up names and prices itself. */
export interface OrderLineInput {
  product_id: string;
  quantity: number;
  spice_level?: SpiceLevel;
  note?: string;
}

export type PlaceOrderBody = PlaceOrderInput & { items: OrderLineInput[] };

export const orderApi = {
  /** Newest first (latest 50). */
  list: (token: string) => request<Order[]>('GET', '/orders', { token }),
  get: (token: string, id: string) => request<Order>('GET', `/orders/${encodeURIComponent(id)}`, { token }),
  /**
   * `idempotencyKey`: send the same key when retrying the same checkout, so a request that
   * reached the server before the network dropped doesn't create a second order.
   */
  create: (token: string, body: PlaceOrderBody, idempotencyKey: string) =>
    request<Order>('POST', '/orders', { token, body, headers: { 'Idempotency-Key': idempotencyKey } }),
  cancel: (token: string, id: string) =>
    request<Order>('POST', `/orders/${encodeURIComponent(id)}/cancel`, { token }),
  /** "I've paid by UPI": the 12-digit UTR / UPI reference number. */
  submitPayment: (token: string, id: string, utr: string) =>
    request<Order>('POST', `/orders/${encodeURIComponent(id)}/payment`, { token, body: { utr } }),
};

// ---------------------------------------------------------------------------
// Admin (part 6). Needs an account in the Cognito `admin` group; others get 403 FORBIDDEN.
// ---------------------------------------------------------------------------
export type CategoryInput = Partial<Pick<Category, 'name' | 'name_mr' | 'image_url' | 'sort_order' | 'is_active'>>;
export type ProductInput = Partial<
  Pick<
    AdminProduct,
    | 'category_id'
    | 'name'
    | 'name_mr'
    | 'description'
    | 'price'
    | 'image_url'
    | 'is_veg'
    | 'has_spice_level'
    | 'is_available'
    | 'is_active'
  >
>;

export const adminApi = {
  /** Orders for one delivery day (YYYY-MM-DD, IST), by slot then time. */
  orders: (token: string, date: string) =>
    request<AdminOrder[]>('GET', `/admin/orders?date=${encodeURIComponent(date)}`, { token }),
  /**
   * CONFIRMED (= "Confirm order"; also auto-assigns a delivery boy, see `auto_assign` on the answer),
   * OUT_FOR_DELIVERY / DELIVERED (fallback for the delivery boy), or CANCELLED with a reason.
   */
  setStatus: (token: string, id: string, status: OrderStatus, reason?: string) =>
    request<AdminOrder>('POST', `/admin/orders/${encodeURIComponent(id)}/status`, {
      token,
      body: reason === undefined ? { status } : { status, reason },
    }),
  /** Assign (or reassign) a confirmed order to a delivery boy by hand (part 7c). */
  assign: (token: string, id: string, deliveryBoyId: string) =>
    request<AdminOrder>('POST', `/admin/orders/${encodeURIComponent(id)}/assign`, {
      token,
      body: { delivery_boy_id: deliveryBoyId },
    }),
  /** Everyone in the delivery group who has opened the Deliveries tab, on duty first. */
  deliveryBoys: (token: string) => request<DeliveryBoy[]>('GET', '/admin/delivery-boys', { token }),
  takeOffDuty: (token: string, id: string) =>
    request<DeliveryBoy>('PATCH', `/admin/delivery-boys/${encodeURIComponent(id)}`, {
      token,
      body: { on_duty: false },
    }),
  categories: (token: string) => request<Category[]>('GET', '/admin/categories', { token }),
  createCategory: (token: string, body: CategoryInput) =>
    request<Category>('POST', '/admin/categories', { token, body }),
  updateCategory: (token: string, id: string, body: CategoryInput) =>
    request<Category>('PATCH', `/admin/categories/${encodeURIComponent(id)}`, { token, body }),
  products: (token: string) => request<AdminProduct[]>('GET', '/admin/products', { token }),
  createProduct: (token: string, body: ProductInput) =>
    request<AdminProduct>('POST', '/admin/products', { token, body }),
  updateProduct: (token: string, id: string, body: ProductInput) =>
    request<AdminProduct>('PATCH', `/admin/products/${encodeURIComponent(id)}`, { token, body }),
  /** Stop (false) or restart (true) online orders; `message` is shown to customers while closed. */
  setStore: (token: string, accepting_orders: boolean, message?: string) =>
    request<AdminStore>('PATCH', '/admin/store', {
      token,
      body: message ? { accepting_orders, message } : { accepting_orders },
    }),
};

/** The delivery boy's Deliveries tab (part 7c). Needs the Cognito group `delivery`. */
export const deliveryApi = {
  me: (token: string) => request<DeliveryBoy>('GET', '/delivery/me', { token }),
  setOnDuty: (token: string, on_duty: boolean) =>
    request<DeliveryBoy>('PATCH', '/delivery/me', { token, body: { on_duty } }),
  /** My active deliveries (full details) and today's finished ones (summary only). */
  orders: (token: string) => request<DeliveryOrder[]>('GET', '/delivery/orders', { token }),
  /** "Picked up" (OUT_FOR_DELIVERY) or DELIVERED. */
  setStatus: (token: string, id: string, status: 'OUT_FOR_DELIVERY' | 'DELIVERED') =>
    request<DeliveryOrder>('POST', `/delivery/orders/${encodeURIComponent(id)}/status`, {
      token,
      body: { status },
    }),
};
