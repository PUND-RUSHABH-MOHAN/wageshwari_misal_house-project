/**
 * Images bundled with the app: the logo, the login background, and fallback photos for
 * categories / dishes (used when a menu item's image_url is missing or fails to load).
 * Real data (menu, addresses, orders) comes from the API.
 */
import type { ID } from '@/types';

/** Metro asset id returned by require('…png|jpg'). */
export type BundledImage = number;

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
