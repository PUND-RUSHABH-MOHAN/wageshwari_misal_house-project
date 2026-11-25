import * as Location from 'expo-location';
import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { SHOP } from '@/constants/shop';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { distanceFromShopKm, formatKm } from '@/utils/geo';
import type { Coords } from '@/utils/maps';

import type { LocationPickerProps } from './LocationPickerModal';

const SHOP_COORDS = { latitude: SHOP.latitude, longitude: SHOP.longitude };
const STREET_ZOOM = { latitudeDelta: 0.008, longitudeDelta: 0.008 }; // ~900 m across
const AREA_ZOOM = { latitudeDelta: 0.07, longitudeDelta: 0.07 }; // whole 3 km circle

/**
 * Full-screen map to place the delivery pin. The pin is fixed in the middle of the screen and
 * the customer moves the map under it (the usual food-app pattern; no dragging a tiny marker).
 * The shaded circle is the delivery area; Confirm is disabled outside it.
 */
export function LocationPickerModal({ visible, initial, onClose, onConfirm }: LocationPickerProps) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const start: Coords = initial ?? SHOP_COORDS;
  const [center, setCenter] = useState<Coords>(start);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const km = distanceFromShopKm(center.latitude, center.longitude);
  const inside = km <= SHOP.deliveryRadiusKm;

  const goTo = (coords: Coords, zoom = STREET_ZOOM) => {
    mapRef.current?.animateToRegion({ ...coords, ...zoom }, 600);
    setCenter(coords);
  };

  const goToMyLocation = async (askPermission: boolean) => {
    setNote(null);
    try {
      const permission = askPermission
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        if (askPermission) setNote('Location permission is off. Move the map to your address instead.');
        return;
      }
      setLocating(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      goTo({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
    } catch {
      if (askPermission) setNote("Couldn't get your location. Move the map to your address instead.");
    } finally {
      setLocating(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          initialRegion={{ ...start, ...(initial ? STREET_ZOOM : AREA_ZOOM) }}
          onRegionChangeComplete={(r: Region) => setCenter({ latitude: r.latitude, longitude: r.longitude })}
          // New address: once the map is up, jump to where the phone is (only if location is already allowed).
          onMapReady={() => {
            if (!initial) goToMyLocation(false);
          }}
          showsUserLocation
          showsMyLocationButton={false}
          toolbarEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}>
          <Circle
            center={SHOP_COORDS}
            radius={SHOP.deliveryRadiusKm * 1000}
            strokeColor={Colors.primary}
            strokeWidth={2}
            fillColor="rgba(142, 27, 27, 0.08)"
          />
          <Marker coordinate={SHOP_COORDS} title={SHOP.name} description={`${SHOP.locality}, ${SHOP.city}`}>
            <View style={styles.shopMarker}>
              <Text style={styles.shopMarkerText}>🍲</Text>
            </View>
          </Marker>
        </MapView>

        {/* The fixed pin: its tip marks the map centre. */}
        <View pointerEvents="none" style={styles.pinWrap}>
          <Icon name="location" size={46} color={inside ? Colors.primary : Colors.danger} />
        </View>

        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.roundBtn} accessibilityLabel="Close map">
            <Icon name="close" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Pin your delivery location</Text>
            <Text style={styles.subtitle}>Move the map so the pin sits on your door</Text>
          </View>
        </View>

        {/* Bottom card */}
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <Pressable
            onPress={() => goToMyLocation(true)}
            style={styles.myLocation}
            accessibilityLabel="Go to my current location">
            <Icon name="myLocation" size={18} color={Colors.primary} />
            <Text style={styles.myLocationText}>{locating ? 'Finding you…' : 'My location'}</Text>
          </Pressable>

          <View style={[styles.status, inside ? styles.statusOk : styles.statusBad]}>
            <Icon name={inside ? 'checkCircle' : 'info'} size={18} color={inside ? Colors.success : Colors.danger} />
            <Text style={[styles.statusText, { color: inside ? Colors.success : Colors.danger }]}>
              {inside
                ? `${formatKm(km)} from the hotel · we deliver here`
                : `${formatKm(km)} from the hotel · outside our ${SHOP.deliveryRadiusKm} km delivery area`}
            </Text>
          </View>
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <Button title="Confirm location" onPress={() => onConfirm(center)} disabled={!inside} />
          <Pressable onPress={() => goTo(SHOP_COORDS, AREA_ZOOM)} hitSlop={8}>
            <Text style={styles.link}>Show the whole delivery area</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.surface },
  pinWrap: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    // Icon box is 46x46 and the pin's tip is at its bottom-centre.
    transform: [{ translateX: -23 }, { translateY: -44 }],
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    backgroundColor: 'rgba(255,255,255,0.94)',
  },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerText: { flex: 1 },
  title: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.text },
  subtitle: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: Spacing.md,
    padding: Spacing.lg,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    backgroundColor: Colors.background,
    boxShadow: '0px -6px 24px rgba(0, 0, 0, 0.15)',
  },
  myLocation: {
    position: 'absolute',
    top: -56,
    right: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  myLocationText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
  status: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  statusOk: { backgroundColor: Colors.successSoft, borderColor: '#B7DDBE' },
  statusBad: { backgroundColor: Colors.dangerSoft, borderColor: '#F3B9B9' },
  statusText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13.5, lineHeight: 19 },
  note: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary, textAlign: 'center' },
  shopMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  shopMarkerText: { fontSize: 18 },
});
