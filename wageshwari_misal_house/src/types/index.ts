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
export type ServiceCity = 'Pune';

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
  is_default: boolean;
}

/** Payload for create (no id) / update (with id) address endpoints. */
export type AddressInput = Omit<Address, 'id' | 'user_id' | 'city'> & { id?: ID };

// ---------------------------------------------------------------------------
// categories & products
// ---------------------------------------------------------------------------
export type CategoryName = 'Misal' | 'Thali' | 'Vada Pav' | 'Chaha';

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
export type PaymentStatus = 'pending' | 'paid';

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
