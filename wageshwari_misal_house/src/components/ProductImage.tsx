import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { PRODUCT_IMAGES } from '@/data/mock-data';
import type { Product } from '@/types';

/**
 * Shows the bundled photo for a product if we ship one, otherwise
 * `product.image_url` from the API, with a plate emoji as last-resort fallback.
 */
export function ProductImage({
  product,
  size,
  width,
  height,
  radius = Radius.lg,
  style,
}: {
  product: Product;
  /** Square size; use `width`/`height` instead for non-square tiles (e.g. a full-width hero). */
  size?: number;
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const h = height ?? size ?? 0;
  const w = width ?? size ?? h;
  const [failed, setFailed] = useState(false);
  const source = PRODUCT_IMAGES[product.id] ?? (product.image_url ? { uri: product.image_url } : null);

  return (
    <View style={[styles.tile, { width: w, height: h, borderRadius: radius }, style]}>
      <Text style={{ fontSize: Math.min(h * 0.4, 96) }}>🍽️</Text>
      {source && !failed ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
          accessibilityLabel={product.name}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
  },
});
