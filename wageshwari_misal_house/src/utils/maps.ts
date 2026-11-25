import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking, Platform } from 'react-native';

import { SHOP } from '@/constants/shop';

/**
 * Can this build show a map?
 * - iOS: Apple Maps, no key needed.
 * - Android: Google Maps needs `GOOGLE_MAPS_ANDROID_API_KEY` at build time (app.config.ts).
 *   In Expo Go the map uses Expo Go's own setup and may show blank; test maps in a preview build.
 * - Web: react-native-maps has no web version.
 */
export function mapsAvailable(): boolean {
  if (Platform.OS === 'web') return false;
  if (Platform.OS === 'ios') return true;
  const configured = Boolean(
    (Constants.expoConfig?.extra as { googleMapsConfigured?: boolean } | undefined)?.googleMapsConfigured,
  );
  return configured || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Google Maps "directions to the hotel" link. A plain Maps URL: needs no API key and opens
 * the Google Maps app when installed (otherwise the browser).
 */
export const shopDirectionsUrl = () =>
  `https://www.google.com/maps/dir/?api=1&destination=${SHOP.latitude},${SHOP.longitude}`;

export const openShopDirections = () => Linking.openURL(shopDirectionsUrl());

export type Coords = { latitude: number; longitude: number };
