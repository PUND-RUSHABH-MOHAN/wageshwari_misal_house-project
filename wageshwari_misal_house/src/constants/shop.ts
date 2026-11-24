/**
 * The hotel itself: where it is and when the kitchen is open.
 * Change the address here and every screen that shows it follows.
 *
 * Not the delivery area: that's decided separately (roadmap part 4).
 */
export const SHOP = {
  name: 'Wagheshwar Misal House',
  /** "A/P" = at post (village + post office). */
  line1: 'A/P Chandanzira',
  line2: 'Jalna – Chh. Sambhajinagar Highway',
  locality: 'Chandanzira',
  city: 'Jalna',
  pincode: '431203',
  hours: '7 AM – 2 PM',
} as const;

/** One line for footers, e.g. "Chandanzira, Jalna · Open 7 AM – 2 PM". */
export const SHOP_TAGLINE = `${SHOP.locality}, ${SHOP.city} · Open ${SHOP.hours}`;

/** Full postal address on one line. */
export const SHOP_ADDRESS = `${SHOP.line1}, ${SHOP.line2}, ${SHOP.city} ${SHOP.pincode}`;
