/**
 * Global client-side store (React Context + useReducer).
 *
 * Everything server-side goes through the real backend (src/services/api.ts + session.ts):
 * auth, the profile, the menu, saved addresses and orders. Only the cart lives on the phone.
 */
import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from 'react';
import { AppState as RNAppState } from 'react-native';

import {
  addressApi,
  adminApi,
  authApi,
  catalogApi,
  errorMessage,
  isApiError,
  meApi,
  orderApi,
  storeApi,
  type CodeDelivery,
  type MePatch,
  type PlaceOrderBody,
  type RegisterInput,
} from '@/services/api';
import {
  clearSession,
  restoreSession,
  setSessionExpiredHandler,
  startSession,
  withAuth,
} from '@/services/session';
import type {
  Address,
  AddressInput,
  BillBreakdown,
  CartItem,
  Category,
  ID,
  Order,
  OrderStatus,
  PlaceOrderInput,
  Product,
  SpiceLevel,
  StoreStatus,
  User,
} from '@/types';
import { computeBill } from '@/utils/pricing';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface AppState {
  /** False until the stored session (if any) has been checked at startup. */
  authReady: boolean;
  /** Shown on the login screen when the saved session couldn't be checked (e.g. offline). */
  restoreError: string | null;
  currentUser: User | null;
  categories: Category[];
  products: Product[];
  /** Menu load state: 'loading' until GET /categories + /products answer. */
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  addresses: Address[];
  /** GET /addresses load state (after login). */
  addressesStatus: LoadStatus;
  addressesError: string | null;
  cart: CartItem[];
  /** GET /orders, newest first. */
  orders: Order[];
  ordersStatus: LoadStatus;
  ordersError: string | null;
  /** Address chosen for checkout; falls back to the default address. */
  selectedAddressId: ID | null;
  /** Drives the "Order placed" banner on the Orders tab. */
  lastPlacedOrderId: ID | null;
  /** GET /store: is the hotel taking online orders? null until the first answer. */
  store: StoreStatus | null;
}

const initialState: AppState = {
  authReady: false,
  restoreError: null,
  currentUser: null,
  categories: [],
  products: [],
  catalogStatus: 'loading',
  catalogError: null,
  addresses: [],
  addressesStatus: 'idle',
  addressesError: null,
  cart: [],
  orders: [],
  ordersStatus: 'idle',
  ordersError: null,
  selectedAddressId: null,
  lastPlacedOrderId: null,
  store: null,
};

export type CatalogStatus = 'loading' | 'ready' | 'error';
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

type Action =
  | { type: 'CATALOG_LOADING' }
  | { type: 'CATALOG_LOADED'; categories: Category[]; products: Product[] }
  | { type: 'CATALOG_FAILED'; message: string }
  | { type: 'AUTH_READY'; user: User | null; restoreError?: string }
  | { type: 'LOGIN'; user: User }
  | { type: 'LOGOUT' }
  | { type: 'ADD_TO_CART'; item: CartItem }
  | { type: 'CHANGE_QTY'; id: ID; delta: number }
  | { type: 'UPDATE_CART_ITEM'; id: ID; patch: Pick<CartItem, 'note' | 'spice_level'> }
  | { type: 'REMOVE_CART_ITEM'; id: ID }
  | { type: 'CLEAR_CART' }
  | { type: 'ORDERS_LOADING' }
  | { type: 'ORDERS_LOADED'; orders: Order[] }
  | { type: 'ORDERS_FAILED'; message: string }
  | { type: 'ORDER_PLACED'; order: Order }
  | { type: 'ORDER_UPDATED'; order: Order }
  | { type: 'DISMISS_ORDER_BANNER' }
  | { type: 'SET_USER'; user: User }
  | { type: 'ADDRESSES_LOADING' }
  | { type: 'ADDRESSES_LOADED'; addresses: Address[]; select?: ID }
  | { type: 'ADDRESSES_FAILED'; message: string }
  | { type: 'SELECT_ADDRESS'; id: ID }
  | { type: 'STORE_LOADED'; store: StoreStatus };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const newId = (prefix: string): ID =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const sameLine = (a: CartItem, b: CartItem) =>
  a.product_id === b.product_id &&
  a.spice_level === b.spice_level &&
  (a.note ?? '').trim() === (b.note ?? '').trim();

export const isTerminalStatus = (s: OrderStatus) => s === 'DELIVERED' || s === 'CANCELLED';
/** Same rule as the server: before the kitchen starts, and not after a UPI payment was reported. */
export const isCancellable = (o: Order) =>
  (o.status === 'PENDING_PAYMENT' || o.status === 'CONFIRMED') && !o.utr;

/** A random Idempotency-Key for one checkout (8–64 of A-Z a-z 0-9 _ -). */
const newCheckoutKey = () =>
  `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;

/** The cart as POST /orders wants it. */
const toOrderLines = (cart: CartItem[]): PlaceOrderBody['items'] =>
  cart.map((c) => ({
    product_id: c.product_id,
    quantity: c.quantity,
    ...(c.product.has_spice_level && c.spice_level ? { spice_level: c.spice_level } : {}),
    ...(c.note?.trim() ? { note: c.note.trim() } : {}),
  }));

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'CATALOG_LOADING':
      return { ...state, catalogStatus: 'loading', catalogError: null };

    case 'CATALOG_LOADED': {
      // Refresh the product copies held in the cart, so price / sold-out changes show there too.
      const byId = new Map(action.products.map((p) => [p.id, p]));
      return {
        ...state,
        categories: action.categories,
        products: action.products,
        catalogStatus: 'ready',
        catalogError: null,
        cart: state.cart.map((c) => {
          const fresh = byId.get(c.product_id);
          return fresh ? { ...c, product: fresh } : c;
        }),
      };
    }

    case 'CATALOG_FAILED':
      // Keep any menu already on screen; only the status changes.
      return { ...state, catalogStatus: 'error', catalogError: action.message };

    case 'AUTH_READY':
      return {
        ...state,
        authReady: true,
        restoreError: action.restoreError ?? null,
        currentUser: action.user,
        selectedAddressId: null,
      };

    case 'LOGIN': // POST /auth/login
      return {
        ...state,
        restoreError: null,
        currentUser: action.user,
        addresses: [],
        addressesStatus: 'idle',
        orders: [],
        ordersStatus: 'idle',
        ordersError: null,
        selectedAddressId: null,
      };

    case 'LOGOUT': // POST /auth/logout
      return {
        ...state,
        currentUser: null,
        cart: [],
        addresses: [],
        addressesStatus: 'idle',
        addressesError: null,
        orders: [],
        ordersStatus: 'idle',
        ordersError: null,
        selectedAddressId: null,
        lastPlacedOrderId: null,
      };

    case 'ADD_TO_CART': {
      // Cart is client-only in v1; becomes POST /cart/items when server carts exist.
      const existing = state.cart.find((c) => sameLine(c, action.item));
      if (existing) {
        return {
          ...state,
          cart: state.cart.map((c) =>
            c.id === existing.id ? { ...c, quantity: c.quantity + action.item.quantity } : c,
          ),
        };
      }
      return { ...state, cart: [...state.cart, action.item] };
    }

    case 'CHANGE_QTY':
      return {
        ...state,
        cart: state.cart
          .map((c) => (c.id === action.id ? { ...c, quantity: c.quantity + action.delta } : c))
          .filter((c) => c.quantity > 0),
      };

    case 'UPDATE_CART_ITEM':
      return {
        ...state,
        cart: state.cart.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

    case 'REMOVE_CART_ITEM':
      return { ...state, cart: state.cart.filter((c) => c.id !== action.id) };

    case 'CLEAR_CART':
      return { ...state, cart: [] };

    case 'ORDERS_LOADING':
      return { ...state, ordersStatus: 'loading', ordersError: null };

    case 'ORDERS_LOADED': // GET /orders
      return { ...state, orders: action.orders, ordersStatus: 'ready', ordersError: null };

    case 'ORDERS_FAILED':
      // Keep any orders already on screen; only the status changes.
      return { ...state, ordersStatus: 'error', ordersError: action.message };

    case 'ORDER_PLACED': // POST /orders
      return {
        ...state,
        orders: [action.order, ...state.orders.filter((o) => o.id !== action.order.id)],
        cart: [],
        lastPlacedOrderId: action.order.id,
      };

    case 'ORDER_UPDATED': // POST /orders/:id/cancel
      return { ...state, orders: state.orders.map((o) => (o.id === action.order.id ? action.order : o)) };

    case 'DISMISS_ORDER_BANNER':
      return { ...state, lastPlacedOrderId: null };

    case 'SET_USER': // GET /me | PATCH /me
      return state.currentUser ? { ...state, currentUser: action.user } : state;

    case 'ADDRESSES_LOADING':
      return { ...state, addressesStatus: 'loading', addressesError: null };

    case 'ADDRESSES_LOADED': {
      // GET /addresses. The server owns the list (and which one is default); the app
      // re-reads it after every change instead of editing it locally.
      const ids = new Set(action.addresses.map((a) => a.id));
      const selectedAddressId =
        action.select && ids.has(action.select)
          ? action.select
          : state.selectedAddressId && ids.has(state.selectedAddressId)
            ? state.selectedAddressId
            : null; // falls back to the default address
      return {
        ...state,
        addresses: action.addresses,
        addressesStatus: 'ready',
        addressesError: null,
        selectedAddressId,
      };
    }

    case 'ADDRESSES_FAILED':
      return { ...state, addressesStatus: 'error', addressesError: action.message };

    case 'SELECT_ADDRESS':
      return { ...state, selectedAddressId: action.id };

    case 'STORE_LOADED': // GET /store | PATCH /admin/store
      return { ...state, store: action.store };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------
interface AppContextValue {
  // data
  authReady: boolean;
  restoreError: string | null;
  currentUser: User | null;
  /** True for accounts in the Cognito `admin` group (Kitchen tab, Manage menu). */
  isAdmin: boolean;
  categories: Category[];
  products: Product[];
  catalogStatus: CatalogStatus;
  catalogError: string | null;
  /** Re-fetch the menu (pull-to-refresh, Retry). Never throws. */
  reloadCatalog: () => Promise<void>;
  /** GET /store. null until the first answer (treated as open; the server has the final say). */
  store: StoreStatus | null;
  /** False only when the hotel has switched online orders off. */
  storeOpen: boolean;
  /** Re-check GET /store (screen focus, pull-to-refresh). Never throws. */
  reloadStore: () => Promise<void>;
  /** Admin: PATCH /admin/store. Stop (false) or restart (true) online orders. Throws ApiError. */
  setAcceptingOrders: (accepting: boolean, message?: string) => Promise<void>;
  addresses: Address[];
  addressesStatus: LoadStatus;
  addressesError: string | null;
  /** Re-fetch GET /addresses (Retry). Never throws. */
  reloadAddresses: () => Promise<void>;
  cart: CartItem[];
  orders: Order[];
  ordersStatus: LoadStatus;
  ordersError: string | null;
  /** Re-fetch GET /orders (pull-to-refresh, Retry). Never throws. */
  reloadOrders: () => Promise<void>;
  lastPlacedOrderId: ID | null;
  // derived
  cartCount: number;
  bill: BillBreakdown;
  selectedAddress: Address | null;
  defaultAddress: Address | null;
  // auth (all throw ApiError on failure; screens show `error.message`)
  login: (email: string, password: string) => Promise<void>;
  /** Creates the account; the user must then confirm the emailed code. */
  register: (input: RegisterInput) => Promise<CodeDelivery | null>;
  /** Confirms the email. Returns true if it also logged the user in. */
  confirmSignUp: (email: string, code: string) => Promise<boolean>;
  resendCode: (email: string) => Promise<CodeDelivery | null>;
  /** Remember credentials (memory only) so confirming the email can log straight in. */
  rememberPendingLogin: (email: string, password: string) => void;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (patch: MePatch) => Promise<void>;
  // cart
  addToCart: (product: Product, opts?: { quantity?: number; spice_level?: SpiceLevel; note?: string }) => void;
  changeQuantity: (cartItemId: ID, delta: number) => void;
  updateCartItem: (cartItemId: ID, patch: Pick<CartItem, 'note' | 'spice_level'>) => void;
  removeFromCart: (cartItemId: ID) => void;
  clearCart: () => void;
  // orders (throw ApiError; screens show `error.message`)
  /** POST /orders with the current cart. Clears the cart on success. */
  placeOrder: (input: PlaceOrderInput) => Promise<Order>;
  /** POST /orders/:id/cancel. */
  cancelOrder: (orderId: ID) => Promise<void>;
  /** POST /orders/:id/payment: "I've paid by UPI" with the UTR. */
  submitPayment: (orderId: ID, utr: string) => Promise<Order>;
  dismissOrderBanner: () => void;
  // addresses (the async ones throw ApiError; screens show `error.message`)
  /** POST /addresses (no id) or PATCH /addresses/:id. A new address is selected for checkout. */
  saveAddress: (input: AddressInput) => Promise<Address>;
  deleteAddress: (addressId: ID) => Promise<void>;
  setDefaultAddress: (addressId: ID) => Promise<void>;
  selectAddress: (addressId: ID) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** How often GET /orders is re-checked while an order is in progress (app in foreground). */
const ORDER_POLL_MS = 20000;
const ORDER_BANNER_MS = 8000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  /** Email + password from sign-up / an unconfirmed login. Never persisted. */
  const pendingLogin = useRef<{ email: string; password: string } | null>(null);
  /**
   * Idempotency-Key of a checkout that hasn't succeeded yet, with the exact body it was sent
   * with. Retrying the same body reuses the key (no double order if the first request did
   * reach the server); any change to the cart, slot or address gets a fresh key.
   */
  const checkout = useRef<{ key: string; body: string } | null>(null);

  // GET /categories + GET /products. Public, so it starts at launch alongside the session check.
  const loadCatalog = async () => {
    dispatch({ type: 'CATALOG_LOADING' });
    try {
      const [categories, products] = await Promise.all([catalogApi.categories(), catalogApi.products()]);
      dispatch({ type: 'CATALOG_LOADED', categories, products });
    } catch (e) {
      dispatch({ type: 'CATALOG_FAILED', message: errorMessage(e) });
    }
  };

  // GET /store. Quiet: if it fails, keep the last answer (the server still refuses orders
  // while closed, with 409 STORE_CLOSED).
  const loadStore = async () => {
    try {
      dispatch({ type: 'STORE_LOADED', store: await storeApi.get() });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadCatalog();
    loadStore();
    // Re-check the store switch whenever the app comes back to the foreground.
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') loadStore();
    });
    return () => sub.remove();
  }, []);

  // GET /addresses for the signed-in user. `select` picks an address for checkout afterwards.
  const loadAddresses = async (select?: ID) => {
    dispatch({ type: 'ADDRESSES_LOADING' });
    try {
      const addresses = await withAuth((t) => addressApi.list(t));
      dispatch({ type: 'ADDRESSES_LOADED', addresses, select });
    } catch (e) {
      dispatch({ type: 'ADDRESSES_FAILED', message: errorMessage(e) });
    }
  };

  // GET /orders. `quiet` (polling) leaves the status alone and ignores failures.
  const loadOrders = async (quiet = false) => {
    if (!quiet) dispatch({ type: 'ORDERS_LOADING' });
    try {
      const orders = await withAuth((t) => orderApi.list(t));
      dispatch({ type: 'ORDERS_LOADED', orders });
    } catch (e) {
      if (!quiet) dispatch({ type: 'ORDERS_FAILED', message: errorMessage(e) });
    }
  };

  // Startup: restore a saved session, and drop back to login if it ever expires.
  useEffect(() => {
    setSessionExpiredHandler(() => dispatch({ type: 'LOGOUT' }));
    let cancelled = false;
    (async () => {
      try {
        const restored = await restoreSession();
        const user = restored === 'restored' ? await withAuth((t) => meApi.get(t)) : null;
        if (!cancelled) {
          dispatch({ type: 'AUTH_READY', user });
          if (user) {
            loadAddresses();
            loadOrders();
          }
        }
      } catch (e) {
        if (!cancelled) {
          dispatch({
            type: 'AUTH_READY',
            user: null,
            restoreError: isApiError(e) ? e.message : 'Could not restore your session.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
      setSessionExpiredHandler(null);
    };
  }, []);

  const normEmail = (email: string) => email.trim().toLowerCase();

  const login = async (email: string, password: string) => {
    const res = await authApi.login(normEmail(email), password);
    await startSession(res);
    pendingLogin.current = null;
    dispatch({ type: 'LOGIN', user: res.user });
    // Not awaited: login finishes as soon as the tokens are stored.
    loadAddresses();
    loadOrders();
  };

  // While an order is in progress, re-check GET /orders every 20 s so status changes made in
  // the kitchen (part 6) show up. Paused while the app is in the background.
  const signedIn = state.currentUser !== null;
  const hasActiveOrders = state.orders.some((o) => !isTerminalStatus(o.status));
  useEffect(() => {
    if (!signedIn || !hasActiveOrders) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => loadOrders(true), ORDER_POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (RNAppState.currentState === 'active') start();
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') {
        loadOrders(true); // catch up straight away when coming back
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [signedIn, hasActiveOrders]);

  // Auto-hide the "order placed" banner after a few seconds.
  useEffect(() => {
    if (!state.lastPlacedOrderId) return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_ORDER_BANNER' }), ORDER_BANNER_MS);
    return () => clearTimeout(timer);
  }, [state.lastPlacedOrderId]);

  const userOrders = state.currentUser ? state.orders : [];
  const userAddresses = state.currentUser
    ? state.addresses.filter((a) => a.user_id === state.currentUser?.id)
    : [];
  const defaultAddress = userAddresses.find((a) => a.is_default) ?? userAddresses[0] ?? null;
  const selectedAddress =
    userAddresses.find((a) => a.id === state.selectedAddressId) ?? defaultAddress;

  const value: AppContextValue = {
    currentUser: state.currentUser,
    isAdmin: state.currentUser?.role === 'admin',
    categories: [...state.categories]
      .filter((c) => c.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
    products: state.products,
    catalogStatus: state.catalogStatus,
    catalogError: state.catalogError,
    reloadCatalog: loadCatalog,
    store: state.store,
    storeOpen: state.store?.accepting_orders ?? true,
    reloadStore: loadStore,
    setAcceptingOrders: async (accepting, message) => {
      const updated = await withAuth((t) => adminApi.setStore(t, accepting, message?.trim() || undefined));
      dispatch({ type: 'STORE_LOADED', store: updated });
    },
    addresses: userAddresses,
    addressesStatus: state.addressesStatus,
    addressesError: state.addressesError,
    reloadAddresses: () => loadAddresses(),
    cart: state.cart,
    orders: userOrders,
    ordersStatus: state.ordersStatus,
    ordersError: state.ordersError,
    reloadOrders: () => loadOrders(),
    lastPlacedOrderId: state.lastPlacedOrderId,

    cartCount: state.cart.reduce((n, c) => n + c.quantity, 0),
    bill: computeBill(state.cart),
    selectedAddress,
    defaultAddress,

    authReady: state.authReady,
    restoreError: state.restoreError,

    login,
    register: async (input) => {
      const email = normEmail(input.email);
      const res = await authApi.register({ ...input, email, name: input.name.trim() });
      pendingLogin.current = { email, password: input.password };
      return res.code_delivery;
    },
    confirmSignUp: async (email, code) => {
      const e = normEmail(email);
      try {
        await authApi.confirm(e, code.trim());
      } catch (err) {
        // Already confirmed (e.g. confirmed earlier, then reopened the app): carry on to login.
        if (!(isApiError(err) && err.code === 'ALREADY_CONFIRMED')) throw err;
      }
      const pending = pendingLogin.current;
      if (pending && pending.email === e) {
        try {
          await login(pending.email, pending.password);
          return true;
        } catch {
          return false; // confirmed, but auto-login failed: send them to the login screen
        }
      }
      return false;
    },
    resendCode: async (email) => (await authApi.resendCode(normEmail(email))).code_delivery,
    rememberPendingLogin: (email, password) => {
      pendingLogin.current = { email: normEmail(email), password };
    },
    forgotPassword: async (email) => {
      await authApi.forgotPassword(normEmail(email));
    },
    resetPassword: async (email, code, newPassword) => {
      await authApi.resetPassword(normEmail(email), code.trim(), newPassword);
    },
    logout: async () => {
      const token = await clearSession();
      pendingLogin.current = null;
      dispatch({ type: 'LOGOUT' });
      // Revoke on the server too; if offline, the token still expires in 30 days.
      if (token) authApi.logout(token).catch(() => undefined);
    },
    updateUser: async (patch) => {
      const user = await withAuth((t) => meApi.patch(t, patch));
      dispatch({ type: 'SET_USER', user });
    },

    addToCart: (product, opts = {}) => {
      const note = opts.note?.trim() || undefined;
      dispatch({
        type: 'ADD_TO_CART',
        item: {
          id: newId('cart'),
          product_id: product.id,
          product,
          quantity: opts.quantity ?? 1,
          spice_level: product.has_spice_level ? (opts.spice_level ?? 'medium') : undefined,
          note,
        },
      });
    },
    changeQuantity: (id, delta) => dispatch({ type: 'CHANGE_QTY', id, delta }),
    updateCartItem: (id, patch) =>
      dispatch({ type: 'UPDATE_CART_ITEM', id, patch: { ...patch, note: patch.note?.trim() || undefined } }),
    removeFromCart: (id) => dispatch({ type: 'REMOVE_CART_ITEM', id }),
    clearCart: () => dispatch({ type: 'CLEAR_CART' }),

    placeOrder: async (input) => {
      if (state.cart.length === 0) throw new Error('Your cart is empty.');
      const body: PlaceOrderBody = { ...input, items: toOrderLines(state.cart) };
      const bodyJson = JSON.stringify(body);
      if (!checkout.current || checkout.current.body !== bodyJson) {
        checkout.current = { key: newCheckoutKey(), body: bodyJson };
      }
      const key = checkout.current.key;
      try {
        const order = await withAuth((t) => orderApi.create(t, body, key)); // POST /orders
        checkout.current = null;
        dispatch({ type: 'ORDER_PLACED', order });
        return order;
      } catch (e) {
        // A dish went off the menu or sold out: refresh the menu so the cart shows it.
        if (isApiError(e) && e.code === 'PRODUCT_UNAVAILABLE') loadCatalog();
        // The hotel stopped online orders meanwhile: show the closed banner.
        if (isApiError(e) && e.code === 'STORE_CLOSED') loadStore();
        throw e;
      }
    },
    submitPayment: async (id, utr) => {
      const order = await withAuth((t) => orderApi.submitPayment(t, id, utr)); // POST /orders/:id/payment
      dispatch({ type: 'ORDER_UPDATED', order });
      return order;
    },
    cancelOrder: async (id) => {
      try {
        const order = await withAuth((t) => orderApi.cancel(t, id)); // POST /orders/:id/cancel
        dispatch({ type: 'ORDER_UPDATED', order });
      } catch (e) {
        // e.g. the kitchen started it meanwhile: show the real status.
        if (isApiError(e) && e.code === 'ORDER_NOT_CANCELLABLE') loadOrders(true);
        throw e;
      }
    },
    dismissOrderBanner: () => dispatch({ type: 'DISMISS_ORDER_BANNER' }),

    saveAddress: async (input) => {
      const { id, ...body } = input;
      const payload = { ...body, line2: body.line2?.trim() ?? '', landmark: body.landmark?.trim() ?? '' };
      const saved = id
        ? await withAuth((t) => addressApi.update(t, id, payload)) // PATCH /addresses/:id
        : await withAuth((t) => addressApi.create(t, payload)); // POST /addresses
      await loadAddresses(id ? undefined : saved.id); // a new address becomes the checkout address
      return saved;
    },
    deleteAddress: async (id) => {
      await withAuth((t) => addressApi.remove(t, id)); // DELETE /addresses/:id
      await loadAddresses();
    },
    setDefaultAddress: async (id) => {
      await withAuth((t) => addressApi.update(t, id, { is_default: true })); // PATCH /addresses/:id
      await loadAddresses();
    },
    selectAddress: (id) => dispatch({ type: 'SELECT_ADDRESS', id }),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
