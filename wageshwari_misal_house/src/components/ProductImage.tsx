import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { imageSources, PRODUCT_FALLBACK_IMAGES } from '@/constants/images';
import { Colors, Radius } from '@/constants/theme';
import type { Product } from '@/types';

/**
 * Shows `product.image_url` from the API. If that is missing or fails to load, falls back
 * to a bundled photo for the product id (if we ship one), then to a plate emoji.
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
  const sources = imageSources(product.image_url, PRODUCT_FALLBACK_IMAGES[product.id]);
  const [attempt, setAttempt] = useState(0);
  const source = sources[attempt];

  return (
    <View style={[styles.tile, { width: w, height: h, borderRadius: radius }, style]}>
      <Text style={{ fontSize: Math.min(h * 0.4, 96) }}>🍽️</Text>
      {source !== undefined ? (
        <Image
          key={attempt}
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setAttempt((n) => n + 1)}
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
