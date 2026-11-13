/**
 * Seed data shaped exactly like API responses. When the backend lands, replace
 * these with fetches from GET /categories, /products, /me, /addresses, /orders.
 *
 * NOTE: prices are placeholders (the design shows "₹[price]") — update them here.
 */
import type { Address, Category, ID, Order, Product, User } from '@/types';
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

const CDN = 'https://cdn.wagheshwarmisal.in';

export const CATEGORIES: Category[] = [
  { id: 'cat_misal', name: 'Misal', name_mr: 'मिसळ', image_url: `${CDN}/categories/misal.jpg`, sort_order: 1, is_active: true },
  { id: 'cat_thali', name: 'Thali', name_mr: 'थाळी', image_url: `${CDN}/categories/thali.jpg`, sort_order: 2, is_active: true },
  { id: 'cat_vadapav', name: 'Vada Pav', name_mr: 'वडा पाव', image_url: `${CDN}/categories/vada-pav.jpg`, sort_order: 3, is_active: true },
  { id: 'cat_chaha', name: 'Chaha', name_mr: 'चहा', image_url: `${CDN}/categories/chaha.jpg`, sort_order: 4, is_active: true },
];

export const PRODUCTS: Product[] = [
  {
    id: 'prd_misal_pav',
    category_id: 'cat_misal',
    name: 'Misal Pav',
    name_mr: 'मिसळ पाव',
    description: 'Spicy matki usal with tarri, farsan, onion, lemon and 2 soft pav.',
    price: 9000,
    image_url: `${CDN}/products/misal-pav.jpg`,
    is_veg: true,
    has_spice_level: true,
    is_available: true,
  },
  {
    id: 'prd_special_thali',
    category_id: 'cat_thali',
    name: 'Special Misal Thali',
    name_mr: 'स्पेशल मिसळ थाळी',
    description: 'Misal, extra tarri, pav, dahi, papad, farsan, kanda-limbu and taak.',
    price: 18000,
    image_url: `${CDN}/products/special-misal-thali.jpg`,
    is_veg: true,
    has_spice_level: true,
    is_available: true,
  },
  {
    id: 'prd_misal_thali',
    category_id: 'cat_thali',
    name: 'Misal Thali',
    name_mr: 'मिसळ थाळी',
    description: 'Misal with 4 pav, tarri, salad, farsan and a glass of taak.',
    price: 15000,
    image_url: `${CDN}/products/misal-thali.jpg`,
    is_veg: true,
    has_spice_level: true,
    is_available: true,
  },
  {
    id: 'prd_kolhapuri_misal',
    category_id: 'cat_misal',
    name: 'Kolhapuri Misal',
    name_mr: 'कोल्हापुरी मिसळ',
    description: 'Fiery red Kolhapuri kat, sprouted matki, farsan, onion and 2 pav.',
    price: 11000,
    image_url: `${CDN}/products/kolhapuri-misal.jpg`,
    is_veg: true,
    has_spice_level: true,
    is_available: true,
  },
  {
    id: 'prd_vada_pav',
    category_id: 'cat_vadapav',
    name: 'Vada Pav',
    name_mr: 'वडा पाव',
    description: 'Crisp batata vada in soft pav with green chutney, lasun chutney and fried mirchi.',
    price: 2500,
    image_url: `${CDN}/products/vada-pav.jpg`,
    is_veg: true,
    has_spice_level: false,
    is_available: true,
  },
  {
    id: 'prd_chaha',
    category_id: 'cat_chaha',
    name: 'Kadak Chaha',
    name_mr: 'कडक चहा',
    description: 'Strong Puneri cutting chai with ginger and elaichi. Chahala vel nasto!',
    price: 1500,
    image_url: `${CDN}/products/chaha.jpg`,
    is_veg: true,
    has_spice_level: false,
    is_available: true,
  },
];

/**
 * Bundled artwork (cropped from the shop banner). Used before the CDN images
 * in `image_url` exist; keyed by row id so API data plugs in unchanged.
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
