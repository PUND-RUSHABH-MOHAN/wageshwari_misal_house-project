/**
 * Delivery-time wording (part 7d). The server works out every time (backend/src/eta.py:
 * cooking time + kitchen queue + travel); the app only shows it, always as an estimate.
 */
import type { Order, OrderStatus, RefundStatus } from '@/types';
import { aboutMinutes, istClockTime, minutesUntil } from '@/utils/pricing';

/** Statuses where an estimate still means something to the customer. */
const LIVE: OrderStatus[] = ['PENDING', 'PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'ASSIGNED', 'OUT_FOR_DELIVERY'];

export const hasLiveEstimate = (o: Pick<Order, 'status' | 'estimated_delivery_at'>) =>
  Boolean(o.estimated_delivery_at) && LIVE.includes(o.status);

/** "1:35 PM · about 25 min" (or "1:35 PM · any minute now" once it's due). */
export function etaWithCountdown(iso: string, now: Date = new Date()): string {
  const left = minutesUntil(iso, now);
  return `${istClockTime(iso)} · ${left <= 1 ? 'any minute now' : aboutMinutes(left)}`;
}

/** Line for an order card / tracking: what time to expect it, or when it came. */
export function deliveryTimeLine(o: Order, now: Date = new Date()): string | null {
  if (o.status === 'DELIVERED' && o.delivered_at) return `Delivered at ${istClockTime(o.delivered_at)}`;
  if (o.status === 'CANCELLED') return o.cancelled_at ? `Cancelled at ${istClockTime(o.cancelled_at)}` : null;
  if (hasLiveEstimate(o)) return `Estimated delivery ${etaWithCountdown(o.estimated_delivery_at!, now)}`;
  return o.slot_label ? o.slot_label : null; // orders from before part 7d
}

/** "Delayed by about 15 min" notice text, or null when on time. */
export function delayNotice(o: Order): string | null {
  if (!o.delayed || !o.delay_minutes) return null;
  const reason = o.delay_reason ? ` ${o.delay_reason}.` : '';
  return `Running about ${o.delay_minutes} min late. New estimate ${istClockTime(o.estimated_delivery_at!)}.${reason} Sorry for the wait!`;
}

export const REFUND_LABELS: Record<RefundStatus, string> = {
  pending: 'Refund pending',
  refunded: 'Refunded',
  not_needed: 'No refund due',
};

/** What the customer sees about their money on a cancelled UPI order. */
export function refundNotice(o: Order): string | null {
  switch (o.refund_status) {
    case 'pending':
      return 'The hotel will refund your UPI payment to the same UPI account. This is done by hand, usually the same day.';
    case 'refunded':
      return `Your UPI payment has been refunded${o.refund_reference ? ` (ref ${o.refund_reference})` : ''}.`;
    case 'not_needed':
      return 'No UPI payment reached the hotel for this order, so there is nothing to refund.';
    default:
      return null;
  }
}
