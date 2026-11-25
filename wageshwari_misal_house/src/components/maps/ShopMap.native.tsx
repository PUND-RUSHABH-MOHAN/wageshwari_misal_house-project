import { Platform, Pressable, StyleSheet } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from 'react-native-maps';

import { SHOP } from '@/constants/shop';
import { Colors, Radius } from '@/constants/theme';
import { openShopDirections } from '@/utils/maps';

const SHOP_COORDS = { latitude: SHOP.latitude, longitude: SHOP.longitude };

/**
 * Small, non-interactive map of the hotel with the delivery area. On Android it uses Google's
 * "lite mode" (a static map image), which is cheap to render. Tapping opens directions.
 */
export function ShopMap({ height = 150 }: { height?: number }) {
  return (
    <Pressable
      onPress={openShopDirections}
      accessibilityRole="link"
      accessibilityLabel={`Map of ${SHOP.name}. Opens directions in Google Maps.`}
      style={[styles.frame, { height }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        liteMode
        initialRegion={{ ...SHOP_COORDS, latitudeDelta: 0.06, longitudeDelta: 0.06 }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        pointerEvents="none">
        <Circle
          center={SHOP_COORDS}
          radius={SHOP.deliveryRadiusKm * 1000}
          strokeColor={Colors.primary}
          strokeWidth={1.5}
          fillColor="rgba(142, 27, 27, 0.08)"
        />
        <Marker coordinate={SHOP_COORDS} title={SHOP.name} />
      </MapView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
