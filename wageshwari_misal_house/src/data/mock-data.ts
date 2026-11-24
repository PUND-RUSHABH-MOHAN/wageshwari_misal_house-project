/**
 * Local mock data for the parts without a backend yet (addresses, orders), shaped
 * exactly like API responses, plus bundled images and the logo.
 */
import type { Address, ID, Order, User } from '@/types';
import { addDays, toCompactDate, toISODate } from '@/utils/format';

/** Metro asset id returned by require('…png|jpg'). */
export type BundledImage = number;

export const MOCK_USER: User = {
  id: 'usr_01',
  name: 'Tushar Kulange',
  phone: '9876543210',
  email: 'tushar@example.com',
  role: 'customer',
  is_active: true,
};

export const MOCK_ADDRESSES: Address[] = [
  {
    id: 'adr_01',
    user_id: MOCK_USER.id,
    label: 'Home',
    receiver_name: 'Tushar Kulange',
    receiver_phone: '9876543210',
    line1: 'Flat 12, Sai Residency',
    line2: 'Kothrud',
    landmark: 'Karishma Society',
    city: 'Pune',
    pincode: '411038',
    is_default: true,
  },
  {
    id: 'adr_02',
    user_id: MOCK_USER.id,
    label: 'Work',
    receiver_name: 'Tushar Kulange',
    receiver_phone: '9876543210',
    line1: 'Office 7B, Panchshil Tech Park',
    line2: 'Yerwada',
    landmark: 'Don Bosco School',
    city: 'Pune',
    pincode: '411006',
    is_default: false,
  },
];

// The menu (categories + products) now comes from GET /categories and GET /products.
// Its starting data lives in backend/terraform/menu_seed.tf.

/**
 * Bundled artwork (cropped from the shop banner), keyed by category / product id.
 * Shown while the CloudFront photo (`image_url`) loads, and if it fails to load.
 */
const FOOD = {
  misal: require('@/assets/images/food/misal.jpg'),
  specialThali: require('@/assets/images/food/special-thali.jpg'),
  misalThali: require('@/assets/images/food/misal-thali.jpg'),
  vadaPav: require('@/assets/images/food/vada-pav.jpg'),
  chaha: require('@/assets/images/food/chaha.jpg'),
};

export const LOGO: BundledImage = require('@/assets/images/logo.png');
/** Shop banner, downscaled — shown blurred behind the login form. */
export const LOGIN_BG: BundledImage = require('@/assets/images/login-bg.jpg');

export const CATEGORY_IMAGES: Record<ID, BundledImage> = {
  cat_misal: FOOD.misal,
  cat_thali: FOOD.specialThali,
  cat_vadapav: FOOD.vadaPav,
  cat_chaha: FOOD.chaha,
};

export const PRODUCT_IMAGES: Record<ID, BundledImage> = {
  prd_misal_pav: FOOD.misal,
  prd_special_thali: FOOD.specialThali,
  prd_misal_thali: FOOD.misalThali,
  prd_kolhapuri_misal: FOOD.misal,
  prd_vada_pav: FOOD.vadaPav,
  prd_chaha: FOOD.chaha,
};

/** Two historical orders so the Orders tab isn't empty on first launch. */
export function buildSeedOrders(now: Date = new Date()): Order[] {
  const home = MOCK_ADDRESSES[0];
  const twoDaysAgo = addDays(now, -2);
  twoDaysAgo.setHours(8, 12, 0, 0);
  const todayEarly = new Date(now);
  todayEarly.setHours(7, 5, 0, 0);

  const pastId = 'ord_seed_01';
  const todayId = 'ord_seed_02';

  return [
    {
      id: todayId,
      order_number: `WMH-${toCompactDate(todayEarly)}-0011`,
      user_id: MOCK_USER.id,
      address_snapshot: home,
      delivery_date: toISODate(todayEarly),
      slot_label: 'Breakfast 9:00 - 10:00 AM',
      status: 'PREPARING',
      subtotal: 39000,
      delivery_fee: 3000,
      tax: 1950,
      total: 43950,
      payment_method: 'online',
      payment_status: 'paid',
      created_at: todayEarly.toISOString(),
      items: [
        {
          id: 'oit_seed_03',
          order_id: todayId,
          product_id: 'prd_special_thali',
          product_name: 'Special Misal Thali',
          unit_price: 18000,
          quantity: 2,
          spice_level: 'teekha',
          note: 'Extra onion & lemon',
          line_total: 36000,
        },
        {
          id: 'oit_seed_04',
          order_id: todayId,
          product_id: 'prd_chaha',
          product_name: 'Kadak Chaha',
          unit_price: 1500,
          quantity: 2,
          line_total: 3000,
        },
      ],
    },
    {
      id: pastId,
      order_number: `WMH-${toCompactDate(twoDaysAgo)}-0007`,
      user_id: MOCK_USER.id,
      address_snapshot: home,
      delivery_date: toISODate(twoDaysAgo),
      slot_label: 'Morning 8:00 - 9:00 AM',
      status: 'DELIVERED',
      subtotal: 14000,
      delivery_fee: 3000,
      tax: 700,
      total: 17700,
      payment_method: 'cod',
      payment_status: 'paid',
      created_at: twoDaysAgo.toISOString(),
      items: [
        {
          id: 'oit_seed_01',
          order_id: pastId,
          product_id: 'prd_misal_pav',
          product_name: 'Misal Pav',
          unit_price: 9000,
          quantity: 1,
          spice_level: 'medium',
          line_total: 9000,
        },
        {
          id: 'oit_seed_02',
          order_id: pastId,
          product_id: 'prd_vada_pav',
          product_name: 'Vada Pav',
          unit_price: 2500,
          quantity: 2,
          line_total: 5000,
        },
      ],
    },
  ];
}
