import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { ProductImage } from '@/components/ProductImage';
import { VegBadge } from '@/components/ui';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import type { Product } from '@/types';
import { formatCurrency } from '@/utils/format';

const MIN_QTY = 1;
const MAX_QTY = 20;
const ADDED_FEEDBACK_MS = 1200;

/**
 * Grid tile: photo, name, price, a "− count +" selector and a full-width ADD button.
 * The counter picks how many to add; ADD sends that quantity to `onAdd`.
 */
export function ProductCard({
  product,
  width,
  quantityInCart,
  onOpen,
  onAdd,
}: {
  product: Product;
  /** Tile width in px (the grid computes it from the screen width). */
  width: number;
  /** Total units of this product across all cart lines. */
  quantityInCart: number;
  /** Tapping the card (outside the counter / ADD) opens the detail sheet. */
  onOpen: () => void;
  onAdd: (quantity: number) => void;
}) {
  const soldOut = !product.is_available;
  const [qty, setQty] = useState(MIN_QTY);
  const [justAdded, setJustAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const handleAdd = () => {
    onAdd(qty);
    // Spice dishes open a sheet first, so only flash "Added" for direct adds
    if (!product.has_spice_level) {
      setJustAdded(true);
      setQty(MIN_QTY);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setJustAdded(false), ADDED_FEEDBACK_MS);
    }
  };

  const imageSize = width - Spacing.sm * 2;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${product.name}, ${formatCurrency(product.price)}. View details`}
      // The card is one a11y element, so expose the nested ADD button as a custom action
      accessibilityActions={soldOut ? [] : [{ name: 'add', label: `Add ${product.name}` }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'add' && handleAdd()}
      onPress={onOpen}
      style={({ pressed }) => [styles.card, { width }, soldOut && styles.cardSoldOut, pressed && styles.cardPressed]}>
      <View>
        <ProductImage product={product} size={imageSize} radius={Radius.lg} />
        <View style={styles.vegChip}>
          <VegBadge isVeg={product.is_veg} size={14} />
        </View>
        {product.has_spice_level ? (
          <View style={styles.spiceChip}>
            <Icon name="flame" size={13} color={Colors.spice} />
          </View>
        ) : null}
        {quantityInCart > 0 ? (
          <View style={styles.inCartChip}>
            <Icon name="checkCircle" size={12} color={Colors.white} />
            <Text style={styles.inCartText}>{quantityInCart} in cart</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.nameMr} numberOfLines={1}>
          {product.name_mr}
        </Text>
        <Text style={styles.price}>{formatCurrency(product.price)}</Text>

        {/* − count + */}
        <View style={[styles.counter, soldOut && styles.counterDisabled]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Decrease count"
            disabled={soldOut || qty <= MIN_QTY}
            hitSlop={8}
            onPress={() => setQty((q) => Math.max(q - 1, MIN_QTY))}
            style={({ pressed }) => [styles.counterBtn, pressed && styles.counterBtnPressed]}>
            <Icon name="minus" size={18} color={qty <= MIN_QTY || soldOut ? Colors.textSubtle : Colors.primary} />
          </Pressable>
          <Text style={styles.counterValue} accessibilityLabel={`Count ${qty}`}>
            {qty}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Increase count"
            disabled={soldOut || qty >= MAX_QTY}
            hitSlop={8}
            onPress={() => setQty((q) => Math.min(q + 1, MAX_QTY))}
            style={({ pressed }) => [styles.counterBtn, pressed && styles.counterBtnPressed]}>
            <Icon name="plus" size={18} color={qty >= MAX_QTY || soldOut ? Colors.textSubtle : Colors.primary} />
          </Pressable>
        </View>

        {soldOut ? (
          <View style={[styles.addBtn, styles.soldOutBtn]}>
            <Text style={styles.soldOutText}>SOLD OUT</Text>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add ${qty} ${product.name}`}
            onPress={handleAdd}
            style={({ pressed }) => [
              styles.addBtn,
              justAdded && styles.addBtnDone,
              pressed && styles.addBtnPressed,
            ]}>
            {justAdded ? <Icon name="check" size={18} color={Colors.white} /> : null}
            <Text style={styles.addText}>{justAdded ? 'ADDED' : 'ADD'}</Text>
          </Pressable>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.sm,
    ...Shadow.card,
  },
  cardSoldOut: { opacity: 0.6 },
  cardPressed: { transform: [{ scale: 0.98 }], boxShadow: '0px 1px 4px rgba(80, 20, 10, 0.06)' },

  vegChip: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: 6,
    padding: 3,
  },
  spiceChip: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.pill,
    padding: 4,
  },
  inCartChip: {
    position: 'absolute',
    bottom: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.success,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  inCartText: { fontFamily: Fonts.bold, fontSize: 11, lineHeight: 16, color: Colors.white },

  body: { paddingHorizontal: 4, paddingTop: Spacing.sm, paddingBottom: 2 },
  name: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: Colors.text },
  nameMr: { fontFamily: Fonts.semibold, fontSize: 13, lineHeight: 18, color: Colors.primary },
  price: { fontFamily: Fonts.extrabold, fontSize: 18, lineHeight: 24, color: Colors.text, marginTop: 2 },

  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 40,
    marginTop: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
  },
  counterDisabled: { opacity: 0.6 },
  counterBtn: {
    width: 38,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  counterBtnPressed: { backgroundColor: Colors.primarySoft },
  counterValue: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: Colors.text },

  addBtn: {
    flexDirection: 'row',
    gap: 4,
    height: 44,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnPressed: { backgroundColor: Colors.primaryDark },
  addBtnDone: { backgroundColor: Colors.success },
  addText: { fontFamily: Fonts.bold, fontSize: 16, lineHeight: 22, color: Colors.white, letterSpacing: 0.8 },
  soldOutBtn: { backgroundColor: Colors.surfaceMuted },
  soldOutText: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.textMuted, letterSpacing: 0.6 },
});
