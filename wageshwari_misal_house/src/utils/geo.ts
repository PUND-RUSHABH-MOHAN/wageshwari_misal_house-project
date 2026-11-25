import { SHOP } from '@/constants/shop';

/** Straight-line (great-circle) distance in km between two points (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dp = rad(lat2 - lat1);
  const dl = rad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Distance from the hotel. Used for an instant preview; the server re-checks. */
export const distanceFromShopKm = (lat: number, lon: number) =>
  distanceKm(SHOP.latitude, SHOP.longitude, lat, lon);

export const isWithinDeliveryArea = (lat: number, lon: number) =>
  distanceFromShopKm(lat, lon) <= SHOP.deliveryRadiusKm;

export const formatKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
