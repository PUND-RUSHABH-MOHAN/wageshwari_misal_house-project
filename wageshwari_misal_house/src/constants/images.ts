/**
 * Artwork bundled with the app.
 *
 * Menu images come from the API (`image_url`). The food photos below are only a fallback,
 * shown when an API image is missing or fails to load, for rows whose id matches. Once the
 * backend serves real images these maps can be emptied.
 */
import type { ID } from '@/types';

/** Metro asset id returned by require('…png|jpg'). */
export type BundledImage = number;

export const LOGO: BundledImage = require('@/assets/images/logo.png');
/** Shop banner, downscaled — shown blurred behind the login form. */
export const LOGIN_BG: BundledImage = require('@/assets/images/login-bg.jpg');

const FOOD = {
  misal: require('@/assets/images/food/misal.jpg'),
  specialThali: require('@/assets/images/food/special-thali.jpg'),
  misalThali: require('@/assets/images/food/misal-thali.jpg'),
  vadaPav: require('@/assets/images/food/vada-pav.jpg'),
  chaha: require('@/assets/images/food/chaha.jpg'),
};

/** Keyed by the category ids the backend is expected to seed (see BACKEND_INTEGRATION_REPORT.md). */
export const CATEGORY_FALLBACK_IMAGES: Record<ID, BundledImage> = {
  cat_misal: FOOD.misal,
  cat_thali: FOOD.specialThali,
  cat_vadapav: FOOD.vadaPav,
  cat_chaha: FOOD.chaha,
};

export const PRODUCT_FALLBACK_IMAGES: Record<ID, BundledImage> = {
  prd_misal_pav: FOOD.misal,
  prd_special_thali: FOOD.specialThali,
  prd_misal_thali: FOOD.misalThali,
  prd_kolhapuri_misal: FOOD.misal,
  prd_vada_pav: FOOD.vadaPav,
  prd_chaha: FOOD.chaha,
};

/** API image first, then the bundled photo, then nothing (caller shows a placeholder). */
export function imageSources(imageUrl: string | null | undefined, fallback: BundledImage | undefined) {
  const sources: ({ uri: string } | BundledImage)[] = [];
  if (imageUrl) sources.push({ uri: imageUrl });
  if (fallback !== undefined) sources.push(fallback);
  return sources;
}
