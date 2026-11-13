/**
 * Global client-side store (React Context + useReducer).
 *
 * Every action here maps to a future API call; the comment on each action
 * names the endpoint it will be replaced by. State shapes are the DB types
 * from `@/types`, so swapping mock reducers for fetch results is mechanical.
 */
import { createContext, useContext, useEffect, useReducer, type ReactNode } from 'react';

import {
  buildSeedOrders,
  CATEGORIES,
  MOCK_ADDRESSES,
  MOCK_USER,
  PRODUCTS,
} from '@/data/mock-data';
import type {
  Address,
  AddressInput,
  BillBreakdown,
  CartItem,
  Category,
  ID,
  LoginInput,
  Order,
  OrderItem,
  OrderStatus,
  PlaceOrderInput,
  Product,
  SpiceLevel,
  User,
} from '@/types';
import { toCompactDate } from '@/utils/format';
import { computeBill } from '@/utils/pricing';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
interface AppState {
  currentUser: User | null;
  categories: Category[];
  products: Product[];
  addresses: Address[];
  cart: CartItem[];
  orders: Order[];
  /** Address chosen for checkout; falls back to the default address. */
  selectedAddressId: ID | null;
  /** Drives the "Order placed" banner on the Orders tab. */
  lastPlacedOrderId: ID | null;
  /** Orders placed this session whose status the mock "kitchen" advances. */
  liveOrderIds: ID[];
}

const initialState: AppState = {
  currentUser: null,
  categories: CATEGORIES,
  products: PRODUCTS,
  addresses: MOCK_ADDRESSES,
  cart: [],
  orders: buildSeedOrders(),
  selectedAddressId: null,
  lastPlacedOrderId: null,
  liveOrderIds: [],
};

type Action =
  | { type: 'LOGIN'; user: User }
  | { type: 'LOGOUT' }
  | { type: 'ADD_TO_CART'; item: CartItem }
  | { type: 'CHANGE_QTY'; id: ID; delta: number }
  | { type: 'UPDATE_CART_ITEM'; id: ID; patch: Pick<CartItem, 'note' | 'spice_level'> }
  | { type: 'REMOVE_CART_ITEM'; id: ID }
  | { type: 'CLEAR_CART' }
  | { type: 'PLACE_ORDER'; order: Order }
  | { type: 'ADVANCE_LIVE_ORDERS' }
  | { type: 'CANCEL_ORDER'; id: ID }
  | { type: 'DISMISS_ORDER_BANNER' }
  | { type: 'UPDATE_USER'; patch: Partial<Pick<User, 'name' | 'phone' | 'email'>> }
  | { type: 'UPSERT_ADDRESS'; address: Address }
  | { type: 'DELETE_ADDRESS'; id: ID }
  | { type: 'SET_DEFAULT_ADDRESS'; id: ID }
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

/** Guarantees exactly one default address (if any exist). */
function normalizeDefault(addresses: Address[], preferredId?: ID): Address[] {
  if (addresses.length === 0) return addresses;
  const defaultId =
    preferredId ?? addresses.find((a) => a.is_default)?.id ?? addresses[0].id;
  return addresses.map((a) => ({ ...a, is_default: a.id === defaultId }));
}

/** WMH-YYYYMMDD-NNNN with a per-day running sequence. */
function nextOrderNumber(orders: Order[], date: Date): string {
  const prefix = `WMH-${toCompactDate(date)}-`;
  const maxSeq = orders
    .filter((o) => o.order_number.startsWith(prefix))
    .reduce((max, o) => Math.max(max, Number(o.order_number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}

/** Linear lifecycle used by the mock kitchen simulator. */
export const ORDER_FLOW: OrderStatus[] = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'PREPARING',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

export const isTerminalStatus = (s: OrderStatus) => s === 'DELIVERED' || s === 'CANCELLED';
export const isCancellable = (o: Order) => o.status === 'PENDING_PAYMENT' || o.status === 'CONFIRMED';

function advanceOrder(order: Order): Order {
  if (isTerminalStatus(order.status)) return order;
  const next = ORDER_FLOW[ORDER_FLOW.indexOf(order.status) + 1];
  // Online: gateway success moves PENDING_PAYMENT -> CONFIRMED + paid.
  // COD: cash collected on delivery.
  const paid =
    order.payment_status === 'paid' ||
    (order.payment_method === 'online' && next === 'CONFIRMED') ||
    next === 'DELIVERED';
  return { ...order, status: next, payment_status: paid ? 'paid' : 'pending' };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------
function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'LOGIN': // POST /auth/login | POST /auth/otp/verify
      return {
        ...state,
        currentUser: action.user,
        selectedAddressId: state.addresses.find((a) => a.is_default)?.id ?? null,
      };

    case 'LOGOUT': // POST /auth/logout
      return {
        ...state,
        currentUser: null,
        cart: [],
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

    case 'PLACE_ORDER': // POST /orders
      return {
        ...state,
        orders: [action.order, ...state.orders],
        cart: [],
        lastPlacedOrderId: action.order.id,
        liveOrderIds: [...state.liveOrderIds, action.order.id],
      };

    case 'ADVANCE_LIVE_ORDERS': {
      // Stand-in for websocket / polling GET /orders/:id
      const live = new Set(state.liveOrderIds);
      const orders = state.orders.map((o) => (live.has(o.id) ? advanceOrder(o) : o));
      const liveOrderIds = state.liveOrderIds.filter((id) => {
        const o = orders.find((x) => x.id === id);
        return o !== undefined && !isTerminalStatus(o.status);
      });
      return { ...state, orders, liveOrderIds };
    }

    case 'CANCEL_ORDER': // POST /orders/:id/cancel
      return {
        ...state,
        orders: state.orders.map((o) =>
          o.id === action.id && isCancellable(o) ? { ...o, status: 'CANCELLED' } : o,
        ),
        liveOrderIds: state.liveOrderIds.filter((id) => id !== action.id),
      };

    case 'DISMISS_ORDER_BANNER':
      return { ...state, lastPlacedOrderId: null };

    case 'UPDATE_USER': // PATCH /me
      return state.currentUser
        ? { ...state, currentUser: { ...state.currentUser, ...action.patch } }
        : state;

    case 'UPSERT_ADDRESS': {
      // POST /addresses | PATCH /addresses/:id
      const exists = state.addresses.some((a) => a.id === action.address.id);
      const list = exists
        ? state.addresses.map((a) => (a.id === action.address.id ? action.address : a))
        : [...state.addresses, action.address];
      const addresses = normalizeDefault(
        list,
        action.address.is_default ? action.address.id : undefined,
      );
      return {
        ...state,
        addresses,
        selectedAddressId: exists ? state.selectedAddressId : action.address.id,
      };
    }

    case 'DELETE_ADDRESS': {
      // DELETE /addresses/:id
      const addresses = normalizeDefault(state.addresses.filter((a) => a.id !== action.id));
      const selectedAddressId =
        state.selectedAddressId === action.id
          ? (addresses.find((a) => a.is_default)?.id ?? null)
          : state.selectedAddressId;
      return { ...state, addresses, selectedAddressId };
    }

    case 'SET_DEFAULT_ADDRESS': // PATCH /addresses/:id { is_default: true }
      return { ...state, addresses: normalizeDefault(state.addresses, action.id) };

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
  currentUser: User | null;
  categories: Category[];
  products: Product[];
  addresses: Address[];
  cart: CartItem[];
  orders: Order[];
  lastPlacedOrderId: ID | null;
  // derived
  cartCount: number;
  bill: BillBreakdown;
  selectedAddress: Address | null;
  defaultAddress: Address | null;
  // auth
  login: (input: LoginInput) => void;
  logout: () => void;
  updateUser: (patch: Partial<Pick<User, 'name' | 'phone' | 'email'>>) => void;
  // cart
  addToCart: (product: Product, opts?: { quantity?: number; spice_level?: SpiceLevel; note?: string }) => void;
  changeQuantity: (cartItemId: ID, delta: number) => void;
  updateCartItem: (cartItemId: ID, patch: Pick<CartItem, 'note' | 'spice_level'>) => void;
  removeFromCart: (cartItemId: ID) => void;
  clearCart: () => void;
  // orders
  placeOrder: (input: PlaceOrderInput) => Order;
  cancelOrder: (orderId: ID) => void;
  dismissOrderBanner: () => void;
  // addresses
  saveAddress: (input: AddressInput) => Address;
  deleteAddress: (addressId: ID) => void;
  setDefaultAddress: (addressId: ID) => void;
  selectAddress: (addressId: ID) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** How often the mock kitchen moves live orders one step forward. */
const KITCHEN_TICK_MS = 15000;
const ORDER_BANNER_MS = 8000;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const hasLiveOrders = state.liveOrderIds.length > 0;
  useEffect(() => {
    if (!hasLiveOrders) return;
    const timer = setInterval(() => dispatch({ type: 'ADVANCE_LIVE_ORDERS' }), KITCHEN_TICK_MS);
    return () => clearInterval(timer);
  }, [hasLiveOrders]);

  // Auto-hide the "order placed" banner after a few seconds.
  useEffect(() => {
    if (!state.lastPlacedOrderId) return;
    const timer = setTimeout(() => dispatch({ type: 'DISMISS_ORDER_BANNER' }), ORDER_BANNER_MS);
    return () => clearTimeout(timer);
  }, [state.lastPlacedOrderId]);

  const userOrders = state.currentUser
    ? state.orders
        .filter((o) => o.user_id === state.currentUser?.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
    : [];
  const userAddresses = state.currentUser
    ? state.addresses.filter((a) => a.user_id === state.currentUser?.id)
    : [];
  const defaultAddress = userAddresses.find((a) => a.is_default) ?? userAddresses[0] ?? null;
  const selectedAddress =
    userAddresses.find((a) => a.id === state.selectedAddressId) ?? defaultAddress;

  const value: AppContextValue = {
    currentUser: state.currentUser,
    categories: [...state.categories]
      .filter((c) => c.is_active)
      .sort((a, b) => a.sort_order - b.sort_order),
    products: state.products,
    addresses: userAddresses,
    cart: state.cart,
    orders: userOrders,
    lastPlacedOrderId: state.lastPlacedOrderId,

    cartCount: state.cart.reduce((n, c) => n + c.quantity, 0),
    bill: computeBill(state.cart),
    selectedAddress,
    defaultAddress,

    login: (input) => {
      const user: User =
        input.method === 'email'
          ? { ...MOCK_USER, email: input.email.trim().toLowerCase() }
          : { ...MOCK_USER, phone: input.phone };
      dispatch({ type: 'LOGIN', user });
    },
    logout: () => dispatch({ type: 'LOGOUT' }),
    updateUser: (patch) => dispatch({ type: 'UPDATE_USER', patch }),

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

    placeOrder: (input) => {
      const user = state.currentUser;
      const address = userAddresses.find((a) => a.id === input.address_id);
      if (!user) throw new Error('You must be logged in to place an order.');
      if (!address) throw new Error('Please select a delivery address.');
      if (state.cart.length === 0) throw new Error('Your cart is empty.');

      const now = new Date();
      const orderId = newId('ord');
      const bill = computeBill(state.cart);
      const items: OrderItem[] = state.cart.map((c) => ({
        id: newId('oit'),
        order_id: orderId,
        product_id: c.product_id,
        product_name: c.product.name,
        unit_price: c.product.price,
        quantity: c.quantity,
        spice_level: c.spice_level,
        note: c.note,
        line_total: c.product.price * c.quantity,
      }));
      const order: Order = {
        id: orderId,
        order_number: nextOrderNumber(state.orders, now),
        user_id: user.id,
        address_snapshot: { ...address },
        delivery_date: input.delivery_date,
        slot_label: input.slot_label,
        status: input.payment_method === 'online' ? 'PENDING_PAYMENT' : 'CONFIRMED',
        ...bill,
        payment_method: input.payment_method,
        payment_status: 'pending',
        created_at: now.toISOString(),
        items,
      };
      dispatch({ type: 'PLACE_ORDER', order });
      return order;
    },
    cancelOrder: (id) => dispatch({ type: 'CANCEL_ORDER', id }),
    dismissOrderBanner: () => dispatch({ type: 'DISMISS_ORDER_BANNER' }),

    saveAddress: (input) => {
      const user = state.currentUser ?? MOCK_USER;
      const address: Address = {
        ...input,
        id: input.id ?? newId('adr'),
        user_id: user.id,
        city: 'Pune',
        line2: input.line2?.trim() || undefined,
        landmark: input.landmark?.trim() || undefined,
        is_default: input.is_default || userAddresses.length === 0,
      };
      dispatch({ type: 'UPSERT_ADDRESS', address });
      return address;
    },
    deleteAddress: (id) => dispatch({ type: 'DELETE_ADDRESS', id }),
    setDefaultAddress: (id) => dispatch({ type: 'SET_DEFAULT_ADDRESS', id }),
    selectAddress: (id) => dispatch({ type: 'SELECT_ADDRESS', id }),
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
