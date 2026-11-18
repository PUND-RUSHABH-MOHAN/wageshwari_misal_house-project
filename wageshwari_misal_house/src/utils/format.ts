import type { Address, OrderStatus, SpiceLevel } from '@/types';

/** Indian digit grouping: 1234567 -> "12,34,567". */
function groupIndian(n: number): string {
  const s = String(n);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${rest},${last3}`;
}

/**
 * Converts an integer paise amount to a display string.
 * formatCurrency(12000) -> "₹120", formatCurrency(12050) -> "₹120.50"
 */
export function formatCurrency(paise: number): string {
  const rounded = Math.round(paise);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const rupees = Math.floor(abs / 100);
  const fraction = abs % 100;
  const body =
    fraction === 0 ? groupIndian(rupees) : `${groupIndian(rupees)}.${String(fraction).padStart(2, '0')}`;
  return `${negative ? '-' : ''}₹${body}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local-date ISO string: YYYY-MM-DD */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** YYYYMMDD, used inside order numbers. */
export function toCompactDate(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** "2026-11-06" -> "Fri, 6 Nov 2026" */
export function formatDeliveryDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** ISO timestamp -> "6 Nov 2026, 9:42 AM" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hour12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "9876543210" -> "+91 98765 43210" */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return phone;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function formatAddress(a: Pick<Address, 'line1' | 'line2' | 'landmark' | 'city' | 'pincode'>): string {
  return [a.line1, a.line2, a.landmark ? `Near ${a.landmark}` : undefined, `${a.city} - ${a.pincode}`]
    .filter(Boolean)
    .join(', ');
}

export const SPICE_LABELS: Record<SpiceLevel, string> = {
  mild: 'Mild',
  medium: 'Medium',
  teekha: 'Teekha / तर्री',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Payment Pending',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  OUT_FOR_DELIVERY: 'Out for Delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const isValidIndianMobile = (v: string) => /^[6-9]\d{9}$/.test(v);
export const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
/** Mirrors the Cognito password policy (backend/terraform/cognito.tf). */
export const PASSWORD_RULE = 'At least 8 characters, with a lowercase letter and a number';
export const isValidPassword = (v: string) => v.length >= 8 && /[a-z]/.test(v) && /\d/.test(v);
/** Cognito email codes are 6 digits. */
export const isValidEmailCode = (v: string) => /^\d{6}$/.test(v.trim());
/** Pune pincodes are 411xxx / 412xxx / 410xxx. */
export const isValidPunePincode = (v: string) => /^41[0-2]\d{3}$/.test(v);
