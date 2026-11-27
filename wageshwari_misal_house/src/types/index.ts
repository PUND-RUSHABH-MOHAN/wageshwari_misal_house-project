/**
 * Domain types — mirror the v1 database schema 1:1 (snake_case column names)
 * so a REST/GraphQL client can hydrate these objects without mapping layers.
 *
 * MONEY RULE: every price / amount field is an INTEGER in PAISE (₹1 = 100 paise).
 */

export type ID = string;

/** Integer amount in paise. ₹120 === 12000. */
export type Paise = number;

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export type UserRole = 'customer' | 'admin';

export interface User {
  id: ID;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// addresses
// ---------------------------------------------------------------------------
export type AddressLabel = 'Home' | 'Work' | 'Other';
/** The hotel's city (Chandanzira, Jalna). The server sets it on every address. */
export type ServiceCity = 'Jalna';

export interface Address {
  id: ID;
  user_id: ID;
  label: AddressLabel;
  receiver_name: string;
  receiver_phone: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: ServiceCity;
  pincode: string;
  /** GPS position captured on the phone at this address. */
  latitude: number;
  longitude: number;
  /** Straight-line distance from the hotel, computed by the server. Read-only. */
  distance_km: number;
  is_default: boolean;
}

/** Payload for create (no id) / update (with id) address endpoints. */
export type AddressInput = Omit<Address, 'id' | 'user_id' | 'city' | 'distance_km'> & { id?: ID };

// ---------------------------------------------------------------------------
// categories & products
// ---------------------------------------------------------------------------
/** e.g. 'Misal', 'Thali'. Free text: the kitchen can add categories (part 6). */
export type CategoryName = string;

export interface Category {
  id: ID;
  name: CategoryName;
  /** Marathi display name, e.g. "मिसळ". */
  name_mr: string;
  /** Round thumbnail shown in the category strip. */
  image_url: string;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: ID;
  category_id: ID;
  name: string;
  /** Marathi display name, e.g. "मिसळ पाव". */
  name_mr: string;
  description: string;
  /** paise */
  price: Paise;
  image_url: string;
  is_veg: boolean;
  has_spice_level: boolean;
  is_available: boolean;
}

// ---------------------------------------------------------------------------
// cart
// ---------------------------------------------------------------------------
export type SpiceLevel = 'mild' | 'medium' | 'teekha';

export interface CartItem {
  id: ID;
  product_id: ID;
  product: Product;
  quantity: number;
  spice_level?: SpiceLevel;
  note?: string;
}

// ---------------------------------------------------------------------------
// orders & order_items
// ---------------------------------------------------------------------------
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED';

export type PaymentMethod = 'cod' | 'online';
/** UPI: pending -> submitted (customer sent a UTR) -> paid (kitchen checked). COD: pending -> paid on delivery. */
export type PaymentStatus = 'pending' | 'submitted' | 'paid';

/** What the app needs to pay a UPI order (part 7). `uri` opens the UPI app and is the QR content. */
export interface UpiPayment {
  upi_id: string;
  payee_name: string;
  /** Rupees, e.g. "250.50" */
  amount: string;
  note: string;
  uri: string;
}

export interface OrderItem {
  id: ID;
  order_id: ID;
  product_id: ID;
  /** Snapshot of product name at order time. */
  product_name: string;
  /** paise — snapshot of product price at order time. */
  unit_price: Paise;
  quantity: number;
  spice_level?: SpiceLevel;
  note?: string;
  /** paise — unit_price * quantity */
  line_total: Paise;
}

export interface Order {
  id: ID;
  /** Human-readable, e.g. WMH-20261106-0012 */
  order_number: string;
  user_id: ID;
  /** Frozen copy of the address at checkout (JSONB column). */
  address_snapshot: Address;
  /** YYYY-MM-DD */
  delivery_date: string;
  slot_label: string;
  status: OrderStatus;
  subtotal: Paise;
  delivery_fee: Paise;
  tax: Paise;
  total: Paise;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  /** Only on cancelled orders: who cancelled it ('system' = unpaid UPI order expired). */
  cancelled_by?: 'customer' | 'kitchen' | 'system';
  /** Kitchen / system cancels: the reason shown to the customer. */
  cancel_reason?: string;
  /** UPI orders: the 12-digit reference the customer sent after paying. */
  utr?: string;
  /** UPI orders: pay (send a UTR) by this ISO time, or the order is cancelled. */
  payment_expires_at?: string;
  /** UPI orders still waiting for payment: how to pay. */
  upi_payment?: UpiPayment;
  /** ISO timestamp — standard created_at column. */
  created_at: string;
  /** Joined order_items rows (GET /orders/:id?include=items). */
  items: OrderItem[];
}

// ---------------------------------------------------------------------------
// client-side helpers (not tables)
// ---------------------------------------------------------------------------
export interface BillBreakdown {
  subtotal: Paise;
  delivery_fee: Paise;
  tax: Paise;
  total: Paise;
}

export interface DeliverySlot {
  id: string;
  name: string;
  time: string;
  /** 24h hour at which the slot begins; used for same-day cutoff. */
  start_hour: number;
}

export interface PlaceOrderInput {
  address_id: ID;
  delivery_date: string;
  slot_label: string;
  payment_method: PaymentMethod;
}

export type LoginInput =
  | { method: 'email'; email: string; password: string }
  | { method: 'phone'; phone: string; otp: string };

// ---------------------------------------------------------------------------
// admin (part 6): GET /admin/orders, /admin/products
// ---------------------------------------------------------------------------
export interface StatusHistoryEntry {
  status: OrderStatus;
  /** ISO timestamp */
  at: string;
  /** "customer", or the admin's email */
  by: string;
}

export interface AdminOrder extends Order {
  status_history: StatusHistoryEntry[];
}

/** A dish as the kitchen sees it: `is_active: false` = hidden from customers. */
export interface AdminProduct extends Product {
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// store switch (part 7b): GET /store, PATCH /admin/store
// ---------------------------------------------------------------------------
/** Is the hotel taking online orders right now? */
export interface StoreStatus {
  accepting_orders: boolean;
  /** Shown to customers while closed ("" when open). */
  message: string;
  /** "09:00" (IST) */
  opens_at: string;
  /** "21:00" (IST) */
  closes_at: string;
}

/** What PATCH /admin/store returns: the status plus who changed it last. */
export interface AdminStore extends StoreStatus {
  updated_at?: string | null;
  updated_by?: string | null;
}
