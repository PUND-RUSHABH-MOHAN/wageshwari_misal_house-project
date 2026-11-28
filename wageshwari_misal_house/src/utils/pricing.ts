import type { BillBreakdown, CartItem, Paise } from '@/types';

/** Flat delivery fee: ₹30. */
export const DELIVERY_FEE_PAISE: Paise = 3000;

/** GST in basis points (500 bps = 5%) so all maths stays integer. */
export const GST_RATE_BPS = 500;

export const lineTotal = (item: Pick<CartItem, 'quantity'> & { product: { price: Paise } }): Paise =>
  item.product.price * item.quantity;

/** Bill computed exactly the way the backend will: integer paise, GST on item subtotal. */
export function computeBill(cart: CartItem[]): BillBreakdown {
  const subtotal = cart.reduce((sum, item) => sum + lineTotal(item), 0);
  if (subtotal === 0) return { subtotal: 0, delivery_fee: 0, tax: 0, total: 0 };
  const delivery_fee = DELIVERY_FEE_PAISE;
  const tax = Math.round((subtotal * GST_RATE_BPS) / 10000);
  return { subtotal, delivery_fee, tax, total: subtotal + delivery_fee + tax };
}

/**
 * Smallest food subtotal (before delivery and GST) the server accepts: ₹100.
 * Mirrors MIN_ORDER_PAISE on the orders Lambda (backend/terraform/variables.tf).
 */
export const MIN_ORDER_PAISE: Paise = 10000;

/** Paise still needed to reach the minimum order (0 when it's met). */
export const shortOfMinimum = (bill: Pick<BillBreakdown, 'subtotal'>): Paise =>
  Math.max(0, MIN_ORDER_PAISE - bill.subtotal);

// ---------------------------------------------------------------------------
// India time. "Today", kitchen hours and delivery times follow the hotel's clock (IST, UTC+05:30,
// no daylight saving), not the phone's time zone, so the app agrees with the server even
// on a phone or emulator set to another zone.
// ---------------------------------------------------------------------------
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const pad2 = (n: number) => String(n).padStart(2, '0');

/** The IST calendar date `days` after `now`, as YYYY-MM-DD. */
export function istDate(now: Date = new Date(), days = 0): string {
  const d = new Date(now.getTime() + IST_OFFSET_MS + days * 86400000);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Minutes since midnight in IST. */
export function istMinutes(now: Date = new Date()): number {
  const d = new Date(now.getTime() + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "7:05 AM" for an ISO timestamp, in IST (the kitchen's clock). */
export function istClockTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getUTCMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Online ordering hours (part 7d): 9:00 AM – 8:30 PM IST, matching store.py OPEN_HOUR / LAST_ORDER.
 * Delivery runs until 9 PM. The server has the final say (409 KITCHEN_CLOSED); this only lets
 * the app say so before the customer taps Place order.
 */
export const KITCHEN_OPEN_HOUR = 9;
export const KITCHEN_CLOSE_HOUR = 21;
export const LAST_ORDER_MINUTES = 20 * 60 + 30;

/** Can an order be placed right now (by the clock)? */
export function isOrderingOpen(now: Date = new Date()): boolean {
  const m = istMinutes(now);
  return m >= KITCHEN_OPEN_HOUR * 60 && m <= LAST_ORDER_MINUTES;
}

/** @deprecated part 7d: use isOrderingOpen (orders stop at 8:30 PM). */
export const isKitchenOpen = isOrderingOpen;

/** Whole minutes from now until an ISO time (never below 0). */
export function minutesUntil(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 60000));
}

/** "about 35 min" / "about 1 hr 10 min" */
export function aboutMinutes(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h} hr${m ? ` ${m} min` : ''}`;
}
