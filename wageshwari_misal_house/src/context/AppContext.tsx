/**
 * Global client-side store (React Context + useReducer).
 *
 * Everything server-owned comes from the backend (src/services/api.ts + session.ts):
 *   auth + profile   /auth/*, /me
 *   menu             GET /categories, GET /products
 *   addresses        GET/POST /addresses, PATCH/DELETE /addresses/:id
 *   orders           GET/POST /orders, POST /orders/:id/cancel (polled while any is in progress)
 *
 * The cart is the only local state: it lives on the device and is sent with POST /orders.
 */
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { AppState as RNAppState } from 'react-native';

import {
  addressApi,
  authApi,
  catalogApi,
  errorMessage,
  isApiError,
  meApi,
  orderApi,
  type AddressBody,
  type CodeDelivery,
  type CreateOrderInput,
  type MePatch,
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
  User,
} from '@/types';
import { computeBill } from '@/utils/pricing';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Fetch state of one server-owned collection. */
export interface Resource {
  status: LoadStatus;
  /** User-facing message when `status === 'error'`. */
  error: string | null;
}

type ResourceKey = 'catalog' | 'addresses' | 'orders';

const IDLE: Resource = { status: 'idle', error: null };

interface AppState {
  /** False until the stored session (if any) has been checked at startup. */
  authReady: boolean;
  /** Shown on the login screen when the saved session couldn't be checked (e.g. offline). */
  restoreError: string | null;
  currentUser: User | null;
  categories: Category[];
  products: Product[];
  addresses: Address[];
  cart: CartItem[];
  orders: Order[];
  load: Record<ResourceKey, Resource>;
  /** Address chosen for checkout; falls back to the default address. */
  selectedAddressId: ID | null;
  /** Drives the "Order placed" banner on the Orders tab. */
  lastPlacedOrderId: ID | null;
}

const initialState: AppState = {
  authReady: false,
  restoreError: null,
  currentUser: null,
  categories: [],
  products: [],
  addresses: [],
  cart: [],
  orders: [],
  load: { catalog: IDLE, addresses: IDLE, orders: IDLE },
  selectedAddressId: null,
  lastPlacedOrderId: null,
};

/** Everything that belongs to the signed-in user; wiped on login/logout. The menu is kept. */
const signedOutData = {
  addresses: [] as Address[],
  orders: [] as Order[],
  cart: [] as CartItem[],
  selectedAddressId: null,
  lastPlacedOrderId: null,
};

type Action =
  | { type: 'AUTH_READY'; user: User | null; restoreError?: string }
  | { type: 'LOGIN'; user: User }
  | { type: 'LOGOUT' }
  | { type: 'LOAD_START'; resource: ResourceKey }
  | { type: 'LOAD_ERROR'; resource: ResourceKey; error: string }
  | { type: 'CATALOG_LOADED'; categories: Category[]; products: Product[] }
  | { type: 'ADDRESSES_LOADED'; addresses: Address[] }
  | { type: 'ORDERS_LOADED'; orders: Order[] }
  | { type: 'ADD_TO_CART'; item: CartItem }
  | { type: 'CHANGE_QTY'; id: ID; delta: number }
  | { type: 'UPDATE_CART_ITEM'; id: ID; patch: Pick<CartItem, 'note' | 'spice_level'> }
  | { type: 'REMOVE_CART_ITEM'; id: ID }
  | { type: 'CLEAR_CART' }
  | { type: 'ORDER_PLACED'; order: Order }
  | { type: 'ORDER_UPDATED'; order: Order }
  | { type: 'DISMISS_ORDER_BANNER' }
  | { type: 'SET_USER'; user: User }
  | { type: 'ADDRESS_SAVED'; address: Address; isNew: boolean }
  | { type: 'ADDRESS_REMOVED'; id: ID }
  | { type: 'SELECT_ADDRESS'; id: ID };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const newId = (prefix: string): ID =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const sameLine = (a: CartItem, b: CartItem) =>
  a.product_id === b.product_id &&
  a.spice_level === b.spice_level &&
  (a.note ?? '').trim() === (b.note ?? '').trim();

/** FNV-1a, 32-bit. Only used to derive a stable idempotency key from a request body. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const byNewest = (a: Order, b: Order) => b.created_at.localeCompare(a.created_at);

export const isTerminalStatus = (s: OrderStatus) => s === 'DELIVERED' || s === 'CANCELLED';
/** Mirrors the server rule; the server has the final say (POST /orders/:id/cancel). */
export const isCancellable = (o: Order) => o.status === 'PENDING_PAYMENT' || o.status === 'CONFIRMED';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'AUTH_READY':
      return {
        ...state,
        ...signedOutData,
        authReady: true,
        restoreError: action.restoreError ?? null,
        currentUser: action.user,
      };

    case 'LOGIN':
      return { ...state, ...signedOutData, restoreError: null, currentUser: action.user };

    case 'LOGOUT':
      return {
        ...state,
        ...signedOutData,
        currentUser: null,
        load: { ...state.load, addresses: IDLE, orders: IDLE },
      };

    case 'LOAD_START':
      return {
        ...state,
        load: { ...state.load, [action.resource]: { status: 'loading', error: null } },
      };

    case 'LOAD_ERROR':
      return {
        ...state,
        load: { ...state.load, [action.resource]: { status: 'error', error: action.error } },
      };

    case 'CATALOG_LOADED': {
      // Refresh the product snapshot held by each cart line, so price and availability
      // shown in the cart match the latest menu.
      const fresh = new Map(action.products.map((p) => [p.id, p]));
      return {
        ...state,
        categories: action.categories,
        products: action.products,
        cart: state.cart.map((c) => {
          const product = fresh.get(c.product_id);
          return product ? { ...c, product } : c;
        }),
        load: { ...state.load, catalog: { status: 'ready', error: null } },
      };
    }

    case 'ADDRESSES_LOADED':
      return {
        ...state,
        addresses: action.addresses,
        selectedAddressId: action.addresses.some((a) => a.id === state.selectedAddressId)
          ? state.selectedAddressId
          : null,
        load: { ...state.load, addresses: { status: 'ready', error: null } },
      };

    case 'ORDERS_LOADED':
      return {
        ...state,
        orders: [...action.orders].sort(byNewest),
        load: { ...state.load, orders: { status: 'ready', error: null } },
      };

    case 'ADD_TO_CART': {
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

    case 'ORDER_PLACED':
      return {
        ...state,
        orders: [action.order, ...state.orders.filter((o) => o.id !== action.order.id)],
        cart: [],
        lastPlacedOrderId: action.order.id,
      };

    case 'ORDER_UPDATED':
      return {
        ...state,
        orders: state.orders.map((o) => (o.id === action.order.id ? action.order : o)),
      };

    case 'DISMISS_ORDER_BANNER':
      return { ...state, lastPlacedOrderId: null };

    case 'SET_USER':
      return state.currentUser ? { ...state, currentUser: action.user } : state;

    case 'ADDRESS_SAVED': {
      const saved = action.address;
      const list = action.isNew
        ? [...state.addresses.filter((a) => a.id !== saved.id), saved]
        : state.addresses.map((a) => (a.id === saved.id ? saved : a));
      // The server keeps exactly one default; mirror that locally without a refetch.
      const addresses = saved.is_default
        ? list.map((a) => (a.id === saved.id ? a : { ...a, is_default: false }))
        : list;
      return {
        ...state,
        addresses,
        selectedAddressId: action.isNew ? saved.id : state.selectedAddressId,
      };
    }

    case 'ADDRESS_REMOVED':
      return {
        ...state,
        addresses: state.addresses.filter((a) => a.id !== action.id),
        selectedAddressId: state.selectedAddressId === action.id ? null : state.selectedAddressId,
      };

    case 'SELECT_ADDRESS':
      return { ...state, selectedAddressId: action.id };

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
  categories: Category[];
  products: Product[];
  addresses: Address[];
  cart: CartItem[];
  orders: Order[];
  lastPlacedOrderId: ID | null;
  /** Fetch state per collection, for loading spinners and error/retry UI. */
  catalogLoad: Resource;
  addressesLoad: Resource;
  ordersLoad: Resource;
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
  // reloads (never throw; failures land in the matching `*Load.error`)
  refreshCatalog: () => Promise<void>;
  refreshAddresses: () => Promise<void>;
  refreshOrders: () => Promise<void>;
  // cart (local only)
  addToCart: (product: Product, opts?: { quantity?: number; spice_level?: SpiceLevel; note?: string }) => void;
  changeQuantity: (cartItemId: ID, delta: number) => void;
  updateCartItem: (cartItemId: ID, patch: Pick<CartItem, 'note' | 'spice_level'>) => void;
  removeFromCart: (cartItemId: ID) => void;
  clearCart: () => void;
  // orders (throw on failure)
  placeOrder: (input: PlaceOrderInput) => Promise<Order>;
  cancelOrder: (orderId: ID) => Promise<void>;
  dismissOrderBanner: () => void;
  // addresses (throw on failure)
  saveAddress: (input: AddressInput) => Promise<Address>;
  deleteAddress: (addressId: ID) => Promise<void>;
  setDefaultAddress: (addressId: ID) => Promise<void>;
  selectAddress: (addressId: ID) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** How often in-progress orders are re-fetched while the app is in the foreground. */
const ORDER_POLL_MS = 20000;
const ORDER_BANNER_MS = 8000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  /** Email + password from sign-up / an unconfirmed login. Never persisted. */
  const pendingLogin = useRef<{ email: string; password: string } | null>(null);
  /**
   * Bumped on every login/logout. A response that arrives after the session changed
   * belongs to the previous user and is dropped.
   */
  const sessionGen = useRef(0);
  /** Random per checkout; combined with the body hash into the Idempotency-Key. */
  const checkoutNonce = useRef(newId('chk'));

  const userId = state.currentUser?.id ?? null;

  // ---- loaders -----------------------------------------------------------
  /**
   * Fetch one collection with a fresh token. `silent` keeps the current status/data on
   * screen (used for background polling and refetch-after-mutation).
   */
  async function load<T>(
    resource: ResourceKey,
    fetcher: (token: string) => Promise<T>,
    onData: (data: T) => Action,
    silent = false,
  ): Promise<void> {
    const gen = sessionGen.current;
    if (!silent) dispatch({ type: 'LOAD_START', resource });
    try {
      const data = await withAuth(fetcher);
      if (gen === sessionGen.current) dispatch(onData(data));
    } catch (e) {
      if (gen === sessionGen.current && !silent) {
        dispatch({ type: 'LOAD_ERROR', resource, error: errorMessage(e) });
      }
    }
  }

  const refreshCatalog = (silent = false) =>
    load(
      'catalog',
      (t) => Promise.all([catalogApi.categories(t), catalogApi.products(t)]),
      ([categories, products]) => ({ type: 'CATALOG_LOADED', categories, products }),
      silent,
    );
  const refreshAddresses = (silent = false) =>
    load('addresses', addressApi.list, (addresses) => ({ type: 'ADDRESSES_LOADED', addresses }), silent);
  const refreshOrders = (silent = false) =>
    load('orders', orderApi.list, (orders) => ({ type: 'ORDERS_LOADED', orders }), silent);

  // Load everything for a newly signed-in user.
  const onSignedIn = useEffectEvent(() => {
    void refreshCatalog();
    void refreshAddresses();
    void refreshOrders();
  });
  useEffect(() => {
    if (userId) onSignedIn();
  }, [userId]);

  // Startup: restore a saved session, and drop back to login if it ever expires.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      sessionGen.current += 1;
      dispatch({ type: 'LOGOUT' });
    });
    let cancelled = false;
    (async () => {
      try {
        const restored = await restoreSession();
        const user = restored === 'restored' ? await withAuth((t) => meApi.get(t)) : null;
        if (!cancelled) dispatch({ type: 'AUTH_READY', user });
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

  // Live order status: poll while any order is in progress and the app is in the foreground,
  // and catch up immediately when the app comes back to the foreground.
  const hasActiveOrders = state.orders.some((o) => !isTerminalStatus(o.status));
  const pollOrders = useEffectEvent(() => {
    if (RNAppState.currentState === 'active') void refreshOrders(true);
  });
  useEffect(() => {
    if (!userId || !hasActiveOrders) return;
    const timer = setInterval(pollOrders, ORDER_POLL_MS);
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') pollOrders();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [userId, hasActiveOrders]);

  // Auto-hide the "order placed" banner after a few seconds.
  useEffect(() => {
    if (!state.lastPlacedOrderId) return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_ORDER_BANNER' }), ORDER_BANNER_MS);
    return () => clearTimeout(timer);
  }, [state.lastPlacedOrderId]);

  // ---- auth ----------------------------------------------------------------
  const normEmail = (email: string) => email.trim().toLowerCase();

  const login = async (email: string, password: string) => {
    const res = await authApi.login(normEmail(email), password);
    await startSession(res);
    pendingLogin.current = null;
    sessionGen.current += 1;
    dispatch({ type: 'LOGIN', user: res.user });
  };

  // ---- derived -------------------------------------------------------------
  const defaultAddress = state.addresses.find((a) => a.is_default) ?? state.addresses[0] ?? null;
  const selectedAddress =
    state.addresses.find((a) => a.id === state.selectedAddressId) ?? defaultAddress;

  const toBody = (input: AddressInput): AddressBody => ({
    label: input.label,
    receiver_name: input.receiver_name.trim(),
    receiver_phone: input.receiver_phone,
    line1: input.line1.trim(),
    line2: input.line2?.trim() || null,
    landmark: input.landmark?.trim() || null,
    pincode: input.pincode,
    is_default: input.is_default,
  });

  const value: AppContextValue = {
    currentUser: state.currentUser,
    categories: state.categories
      .filter((c) => c.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
    products: state.products,
    addresses: state.addresses,
    cart: state.cart,
    orders: state.orders,
    lastPlacedOrderId: state.lastPlacedOrderId,
    catalogLoad: state.load.catalog,
    addressesLoad: state.load.addresses,
    ordersLoad: state.load.orders,

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
      sessionGen.current += 1;
      dispatch({ type: 'LOGOUT' });
      // Revoke on the server too; if offline, the token still expires in 30 days.
      if (token) authApi.logout(token).catch(() => undefined);
    },
    updateUser: async (patch) => {
      const user = await withAuth((t) => meApi.patch(t, patch));
      dispatch({ type: 'SET_USER', user });
    },

    refreshCatalog: () => refreshCatalog(),
    refreshAddresses: () => refreshAddresses(),
    refreshOrders: () => refreshOrders(),

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
      if (!state.currentUser) throw new Error('You must be logged in to place an order.');
      if (!state.addresses.some((a) => a.id === input.address_id)) {
        throw new Error('Please select a delivery address.');
      }
      if (state.cart.length === 0) throw new Error('Your cart is empty.');

      const body: CreateOrderInput = {
        ...input,
        items: state.cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          spice_level: c.spice_level,
          note: c.note,
        })),
      };
      // Same cart + same choices => same key, so retrying after a timeout is safe.
      const key = `${checkoutNonce.current}-${hash(JSON.stringify(body))}`;
      try {
        const order = await withAuth((t) => orderApi.create(t, body, key));
        checkoutNonce.current = newId('chk');
        dispatch({ type: 'ORDER_PLACED', order });
        return order;
      } catch (e) {
        // Rejected because the menu changed (price, sold out, removed)? Reload it so the
        // cart shows the current state before the user tries again.
        if (isApiError(e) && (e.status === 400 || e.status === 409 || e.status === 422)) {
          void refreshCatalog(true);
        }
        throw e;
      }
    },
    cancelOrder: async (id) => {
      try {
        const order = await withAuth((t) => orderApi.cancel(t, id));
        dispatch({ type: 'ORDER_UPDATED', order });
      } catch (e) {
        // Most likely the kitchen moved it past CONFIRMED meanwhile; show the real status.
        void refreshOrders(true);
        throw e;
      }
    },
    dismissOrderBanner: () => dispatch({ type: 'DISMISS_ORDER_BANNER' }),

    saveAddress: async (input) => {
      const body = toBody({ ...input, is_default: input.is_default || state.addresses.length === 0 });
      const isNew = !input.id;
      const address = await withAuth((t) =>
        input.id ? addressApi.update(t, input.id, body) : addressApi.create(t, body),
      );
      dispatch({ type: 'ADDRESS_SAVED', address, isNew });
      return address;
    },
    deleteAddress: async (id) => {
      await withAuth((t) => addressApi.remove(t, id));
      dispatch({ type: 'ADDRESS_REMOVED', id });
      // If it was the default, the server may have promoted another one.
      void refreshAddresses(true);
    },
    setDefaultAddress: async (id) => {
      const address = await withAuth((t) => addressApi.update(t, id, { is_default: true }));
      dispatch({ type: 'ADDRESS_SAVED', address, isNew: false });
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
