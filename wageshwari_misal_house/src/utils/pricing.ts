import type { BillBreakdown, CartItem, DeliverySlot, Paise } from '@/types';

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
 * One-hour delivery slots, 9 AM – 9 PM IST. Mirrors SLOTS in backend/src/orders.py: the server
 * accepts only these exact labels (`${name} ${time}`), so change both together.
 */
export const DELIVERY_SLOTS: DeliverySlot[] = [
  { id: 'slot_09', name: 'Morning', time: '9:00 - 10:00 AM', start_hour: 9 },
  { id: 'slot_10', name: 'Morning', time: '10:00 - 11:00 AM', start_hour: 10 },
  { id: 'slot_11', name: 'Morning', time: '11:00 AM - 12:00 PM', start_hour: 11 },
  { id: 'slot_12', name: 'Afternoon', time: '12:00 - 1:00 PM', start_hour: 12 },
  { id: 'slot_13', name: 'Afternoon', time: '1:00 - 2:00 PM', start_hour: 13 },
  { id: 'slot_14', name: 'Afternoon', time: '2:00 - 3:00 PM', start_hour: 14 },
  { id: 'slot_15', name: 'Afternoon', time: '3:00 - 4:00 PM', start_hour: 15 },
  { id: 'slot_16', name: 'Afternoon', time: '4:00 - 5:00 PM', start_hour: 16 },
  { id: 'slot_17', name: 'Evening', time: '5:00 - 6:00 PM', start_hour: 17 },
  { id: 'slot_18', name: 'Evening', time: '6:00 - 7:00 PM', start_hour: 18 },
  { id: 'slot_19', name: 'Evening', time: '7:00 - 8:00 PM', start_hour: 19 },
  { id: 'slot_20', name: 'Evening', time: '8:00 - 9:00 PM', start_hour: 20 },
];

export const slotLabel = (slot: DeliverySlot) => `${slot.name} ${slot.time}`;

/**
 * Smallest food subtotal (before delivery and GST) the server accepts: ₹100.
 * Mirrors MIN_ORDER_PAISE on the orders Lambda (backend/terraform/variables.tf).
 */
export const MIN_ORDER_PAISE: Paise = 10000;

/** Paise still needed to reach the minimum order (0 when it's met). */
export const shortOfMinimum = (bill: Pick<BillBreakdown, 'subtotal'>): Paise =>
  Math.max(0, MIN_ORDER_PAISE - bill.subtotal);

// ---------------------------------------------------------------------------
// India time. Slots, "today" and kitchen hours follow the hotel's clock (IST, UTC+05:30,
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

/** Same-day slots close 30 minutes before they start (IST). */
export function isSlotAvailable(slot: DeliverySlot, isToday: boolean, now: Date = new Date()): boolean {
  if (!isToday) return true;
  return istMinutes(now) < slot.start_hour * 60 - 30;
}

/** Online delivery hours: 9:00 AM – 9:00 PM IST (store.py OPEN_HOUR / CLOSE_HOUR). */
export const KITCHEN_OPEN_HOUR = 9;
export const KITCHEN_CLOSE_HOUR = 21;

export function isKitchenOpen(now: Date = new Date()): boolean {
  const h = Math.floor(istMinutes(now) / 60);
  return h >= KITCHEN_OPEN_HOUR && h < KITCHEN_CLOSE_HOUR;
}
