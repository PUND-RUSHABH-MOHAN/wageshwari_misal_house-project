import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius } from '@/constants/theme';
import { PRODUCT_IMAGES } from '@/data/mock-data';
import type { Product } from '@/types';

/**
 * Shows `product.image_url` (CloudFront). While it loads, and if it fails, the photo
 * bundled with the app for that product id is shown instead; a plate emoji is the
 * last resort.
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
  const bundled = PRODUCT_IMAGES[product.id] ?? null;
  const remote = product.image_url && !failed ? { uri: product.image_url } : null;
  const source = remote ?? bundled;

  return (
    <View style={[styles.tile, { width: w, height: h, borderRadius: radius }, style]}>
      <Text style={{ fontSize: Math.min(h * 0.4, 96) }}>🍽️</Text>
      {source ? (
        <Image
          source={source}
          placeholder={remote ? bundled : undefined}
          placeholderContentFit="cover"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => {
            if (remote) setFailed(true); // fall back to the bundled photo
          }}
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
