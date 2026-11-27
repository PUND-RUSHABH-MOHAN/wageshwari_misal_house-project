import * as Location from 'expo-location';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FormNotice } from '@/components/AuthLayout';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { LocationPickerModal } from '@/components/maps/LocationPickerModal';
import { Button, Pill, TextField, TextLink } from '@/components/ui';
import { SHOP } from '@/constants/shop';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { errorMessage } from '@/services/api';
import type { Address, AddressInput, AddressLabel } from '@/types';
import { isValidIndianMobile, isValidJalnaPincode } from '@/utils/format';
import { distanceFromShopKm, formatKm } from '@/utils/geo';
import { mapsAvailable, type Coords } from '@/utils/maps';

const LABELS: AddressLabel[] = ['Home', 'Work', 'Other'];
const GPS_TIMEOUT_MS = 20000;

type Errors = Partial<Record<'receiver_name' | 'receiver_phone' | 'line1' | 'pincode' | 'location', string>>;
type LocationState =
  | { kind: 'none' }
  | { kind: 'finding' }
  | { kind: 'found'; coords: Coords; km: number; fresh: boolean }
  | { kind: 'denied' }
  | { kind: 'error'; message: string };

/**
 * Add / edit address sheet. Parent should pass `key={initial?.id ?? 'new'}`
 * so form state re-initialises when switching between addresses.
 *
 * A map position is required: the server refuses addresses more than SHOP.deliveryRadiusKm
 * from the hotel. The customer pins it on a map (Google Maps) or uses the phone's GPS.
 * The distance shown here is a preview.
 */
export function AddressFormModal({
  visible,
  initial,
  defaults,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial?: Address | null;
  defaults?: { receiver_name?: string; receiver_phone?: string };
  onClose: () => void;
  /** Should throw on failure (e.g. ApiError); the message is shown in the form. */
  onSave: (input: AddressInput) => Promise<void>;
}) {
  const [label, setLabel] = useState<AddressLabel>(initial?.label ?? 'Home');
  const [receiverName, setReceiverName] = useState(initial?.receiver_name ?? defaults?.receiver_name ?? '');
  const [receiverPhone, setReceiverPhone] = useState(
    initial?.receiver_phone ?? defaults?.receiver_phone ?? '',
  );
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [landmark, setLandmark] = useState(initial?.landmark ?? '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [location, setLocation] = useState<LocationState>(
    initial
      ? {
          kind: 'found',
          coords: { latitude: initial.latitude, longitude: initial.longitude },
          km: initial.distance_km,
          fresh: false,
        }
      : { kind: 'none' },
  );
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const canUseMap = mapsAvailable();

  const outOfRange = location.kind === 'found' && location.km > SHOP.deliveryRadiusKm;

  /** Store a position (from GPS or the map pin) and fill empty pincode / area fields from it. */
  const applyCoords = async (coords: Coords) => {
    setErrors((e) => ({ ...e, location: undefined }));
    setLocation({ kind: 'found', coords, km: distanceFromShopKm(coords.latitude, coords.longitude), fresh: true });
    // Best effort: uses the phone's own address lookup; the customer can edit the fields.
    try {
      const [place] = await Location.reverseGeocodeAsync(coords);
      if (place?.postalCode && isValidJalnaPincode(place.postalCode)) {
        setPincode((p) => p || place.postalCode || '');
      }
      const area = [place?.street, place?.district].filter(Boolean).join(', ');
      if (area) setLine2((l) => l || area);
    } catch {
      // No address lookup available (offline, emulator); nothing to fill.
    }
  };

  const useCurrentLocation = async () => {
    setErrors((e) => ({ ...e, location: undefined }));
    setLocation({ kind: 'finding' });
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocation({ kind: 'denied' });
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setLocation({ kind: 'error', message: 'Location (GPS) is turned off. Turn it on and try again.' });
        return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), GPS_TIMEOUT_MS)),
      ]);
      await applyCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude });
    } catch {
      setLocation({
        kind: 'error',
        message: "Couldn't get your location. Move near a window or outdoors and try again.",
      });
    }
  };

  const submit = async () => {
    const next: Errors = {};
    if (!receiverName.trim()) next.receiver_name = 'Receiver name is required';
    if (!isValidIndianMobile(receiverPhone)) next.receiver_phone = 'Enter a valid 10-digit mobile number';
    if (line1.trim().length < 5) next.line1 = 'Enter flat / house no. and building';
    if (!isValidJalnaPincode(pincode)) next.pincode = 'Enter a Jalna-area pincode (431xxx)';
    if (location.kind !== 'found') {
      next.location = canUseMap
        ? 'Pin this address on the map (or use your current location)'
        : 'Use your current location to confirm this address';
    }
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || location.kind !== 'found' || outOfRange || saving) return;

    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        label,
        receiver_name: receiverName.trim(),
        receiver_phone: receiverPhone,
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        landmark: landmark.trim() || undefined,
        pincode,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        is_default: isDefault,
      });
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const digitsOnly = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={initial ? 'Edit address' : 'Add new address'}
      subtitle={`We deliver within ${SHOP.deliveryRadiusKm} km of the hotel in ${SHOP.locality}, ${SHOP.city}`}
      footer={
        <Button
          title={initial ? 'Update address' : 'Save address'}
          onPress={submit}
          loading={saving}
          disabled={outOfRange || location.kind === 'finding'}
        />
      }>
      {formError ? <FormNotice tone="error" message={formError} /> : null}

      {/* Delivery location (required) */}
      <View style={[styles.locationBox, errors.location && styles.locationBoxError]}>
        <Text style={styles.locationTitle}>Delivery location *</Text>
        {location.kind === 'found' ? (
          <View style={styles.locationRow}>
            <Icon
              name={outOfRange ? 'info' : 'checkCircle'}
              size={18}
              color={outOfRange ? Colors.danger : Colors.success}
            />
            <Text style={[styles.locationText, { color: outOfRange ? Colors.danger : Colors.success }]}>
              {outOfRange
                ? `This spot is ${formatKm(location.km)} from the hotel. We deliver within ${SHOP.deliveryRadiusKm} km.`
                : `${location.fresh ? 'Location captured' : 'Saved location'} · ${formatKm(location.km)} from the hotel`}
            </Text>
          </View>
        ) : location.kind === 'denied' ? (
          <View style={styles.locationCol}>
            <Text style={[styles.locationText, { color: Colors.danger }]}>
              Location permission is off. Allow it to add a delivery address.
            </Text>
            <TextLink title="Open settings" onPress={() => Linking.openSettings()} />
          </View>
        ) : location.kind === 'error' ? (
          <Text style={[styles.locationText, { color: Colors.danger }]}>{location.message}</Text>
        ) : (
          <Text style={styles.locationHint}>
            {canUseMap
              ? `Put the pin on your door. We use it to check the ${SHOP.deliveryRadiusKm} km delivery area and to guide our rider.`
              : `Stand at this address and tap below. We use it to check the ${SHOP.deliveryRadiusKm} km delivery area and to guide our rider.`}
          </Text>
        )}
        {canUseMap ? (
          <Button
            title={location.kind === 'found' ? 'Move the pin on the map' : 'Pin on map'}
            icon="map"
            onPress={() => setMapOpen(true)}
            disabled={location.kind === 'finding'}
          />
        ) : null}
        <Button
          title={
            location.kind === 'finding'
              ? 'Finding your location…'
              : location.kind === 'found'
                ? 'Use my current location instead'
                : 'Use my current location'
          }
          icon="myLocation"
          variant="outline"
          onPress={useCurrentLocation}
          loading={location.kind === 'finding'}
        />
        {errors.location ? <Text style={styles.fieldError}>{errors.location}</Text> : null}
      </View>

      <View style={styles.labelRow}>
        {LABELS.map((l) => (
          <Pill key={l} label={l} selected={label === l} onPress={() => setLabel(l)} style={styles.labelPill} />
        ))}
      </View>

      <TextField
        label="Flat / House no., Building *"
        value={line1}
        onChangeText={setLine1}
        placeholder="Plot 12, Sai Residency"
        error={errors.line1}
      />
      <TextField
        label="Area / Street"
        value={line2}
        onChangeText={setLine2}
        placeholder="Ekta Nagar, Chandanzira"
      />
      <TextField
        label="Landmark"
        value={landmark}
        onChangeText={setLandmark}
        placeholder="Near Panchamukhi Nagar"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="City" value={SHOP.city} editable={false} style={styles.readonly} />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Pincode *"
            value={pincode}
            onChangeText={(v) => setPincode(digitsOnly(v, 6))}
            keyboardType="number-pad"
            placeholder={SHOP.pincode}
            error={errors.pincode}
          />
        </View>
      </View>
      <TextField
        label="Receiver name *"
        value={receiverName}
        onChangeText={setReceiverName}
        placeholder="Who will receive the order?"
        error={errors.receiver_name}
      />
      <TextField
        label="Receiver phone *"
        prefix="+91"
        value={receiverPhone}
        onChangeText={(v) => setReceiverPhone(digitsOnly(v, 10))}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        error={errors.receiver_phone}
      />

      <Pressable style={styles.defaultRow} onPress={() => setIsDefault((d) => !d)}>
        <View style={styles.flex}>
          <Text style={styles.defaultTitle}>Set as default address</Text>
          <Text style={styles.defaultHint}>Used automatically at checkout</Text>
        </View>
        <Switch
          value={isDefault}
          onValueChange={setIsDefault}
          trackColor={{ true: Colors.primary, false: Colors.border }}
          thumbColor={Colors.white}
        />
      </Pressable>

      {canUseMap ? (
        <LocationPickerModal
          key={mapOpen ? 'map-open' : 'map-closed'} // fresh state each time it opens
          visible={visible && mapOpen}
          initial={location.kind === 'found' ? location.coords : null}
          onClose={() => setMapOpen(false)}
          onConfirm={(coords) => {
            setMapOpen(false);
            applyCoords(coords);
          }}
        />
      ) : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', gap: Spacing.sm },
  labelPill: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.md },
  flex: { flex: 1 },
  readonly: { color: Colors.textMuted },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  defaultTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  defaultHint: { fontSize: 12, color: Colors.textMuted },
  locationBox: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  locationBoxError: { borderColor: Colors.danger },
  locationTitle: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.text },
  locationRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  locationCol: { gap: Spacing.xs },
  locationText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13.5, lineHeight: 19 },
  locationHint: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: Colors.textMuted },
  fieldError: { fontFamily: Fonts.medium, fontSize: 12.5, color: Colors.danger },
});
