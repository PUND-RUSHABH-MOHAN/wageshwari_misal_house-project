/**
 * The hotel itself: where it is, when the kitchen is open, and how far it delivers.
 * Change the address here and every screen that shows it follows.
 */
export const SHOP = {
  name: 'Wagheshwar Misal House',
  /** "A/P" = at post (village + post office). */
  line1: 'A/P Chandanzira',
  line2: 'Jalna – Chh. Sambhajinagar Highway',
  locality: 'Chandanzira',
  city: 'Jalna',
  pincode: '431203',
  /** Online delivery hours; the slots live in src/utils/pricing.ts (DELIVERY_SLOTS). */
  hours: '9 AM – 9 PM',
  /** 19°51'24.6"N 75°51'07.0"E. Must match `shop_latitude/longitude` in backend/terraform/variables.tf. */
  latitude: 19.856833,
  longitude: 75.851944,
  /** Must match `delivery_radius_km` in backend/terraform/variables.tf; the server has the final say. */
  deliveryRadiusKm: 3,
} as const;

/** One line for footers, e.g. "Chandanzira, Jalna · Open 9 AM – 9 PM". */
export const SHOP_TAGLINE = `${SHOP.locality}, ${SHOP.city} · Open ${SHOP.hours}`;

/** Full postal address on one line. */
export const SHOP_ADDRESS = `${SHOP.line1}, ${SHOP.line2}, ${SHOP.city} ${SHOP.pincode}`;
