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

export const DELIVERY_SLOTS: DeliverySlot[] = [
  { id: 'slot_early', name: 'Early Bird', time: '7:00 - 8:00 AM', start_hour: 7 },
  { id: 'slot_morning', name: 'Morning', time: '8:00 - 9:00 AM', start_hour: 8 },
  { id: 'slot_breakfast', name: 'Breakfast', time: '9:00 - 10:00 AM', start_hour: 9 },
  { id: 'slot_brunch', name: 'Brunch', time: '10:00 - 11:00 AM', start_hour: 10 },
  { id: 'slot_lunch', name: 'Lunch', time: '12:00 - 1:00 PM', start_hour: 12 },
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

/** Same-day slots close 30 minutes before they start (IST). */
export function isSlotAvailable(slot: DeliverySlot, isToday: boolean, now: Date = new Date()): boolean {
  if (!isToday) return true;
  return istMinutes(now) < slot.start_hour * 60 - 30;
}

/** Kitchen hours: 7:00 AM – 2:00 PM IST. */
export const KITCHEN_OPEN_HOUR = 7;
export const KITCHEN_CLOSE_HOUR = 14;

export function isKitchenOpen(now: Date = new Date()): boolean {
  const h = Math.floor(istMinutes(now) / 60);
  return h >= KITCHEN_OPEN_HOUR && h < KITCHEN_CLOSE_HOUR;
}
