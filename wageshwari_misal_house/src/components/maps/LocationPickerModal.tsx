/**
 * Web fallback. Phones use LocationPickerModal.native.tsx (react-native-maps has no web
 * version); the address form only offers "Pin on map" where `mapsAvailable()` is true.
 */
import type { Coords } from '@/utils/maps';

export type LocationPickerProps = {
  visible: boolean;
  /** Where to start: the address being edited. New addresses start at the phone's location or the hotel. */
  initial?: Coords | null;
  onClose: () => void;
  /** Called with the pin's position. Only enabled inside the delivery area. */
  onConfirm: (coords: Coords) => void;
};

export function LocationPickerModal(_props: LocationPickerProps) {
  return null;
}
