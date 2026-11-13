import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { ProductImage } from '@/components/ProductImage';
import { CookingNoteField, SpiceOptions } from '@/components/SpiceLevelSheet';
import { Button, QuantityStepper, Tag, VegBadge } from '@/components/ui';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import type { Product, SpiceLevel } from '@/types';
import { formatCurrency } from '@/utils/format';

const HERO_HEIGHT = 300;
const MAX_QTY = 20;

/**
 * Full product view opened by tapping a dish card: large photo, full description,
 * spice level + cooking note, and a sticky "Add to cart" footer.
 * Parent should pass a `key` per product so the form state resets.
 */
export function ProductDetailSheet({
  product,
  visible,
  quantityInCart,
  onClose,
  onAdd,
}: {
  product: Product | null;
  visible: boolean;
  /** Units of this product already in the cart (all lines). */
  quantityInCart: number;
  onClose: () => void;
  onAdd: (result: { spice_level?: SpiceLevel; note?: string; quantity: number }) => void;
}) {
  const insets = useSafeAreaInsets();
  const [spice, setSpice] = useState<SpiceLevel>('medium');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState(1);

  if (!product) return null;
  const soldOut = !product.is_available;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close dish details" />

        <View style={styles.sheet}>
          <ScrollView style={styles.scroll} bounces={false} keyboardShouldPersistTaps="handled">
            {/* Hero photo */}
            <View>
              <ProductImage product={product} width="100%" height={HERO_HEIGHT} radius={0} />
              <View style={styles.heroShade} pointerEvents="none" />
              <View style={styles.grabber} />
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Close"
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.8 }]}>
                <Icon name="close" size={20} color={Colors.text} />
              </Pressable>
              {soldOut ? (
                <View style={styles.soldOutBadge}>
                  <Text style={styles.soldOutBadgeText}>SOLD OUT</Text>
                </View>
              ) : null}
            </View>

            {/* Details card overlapping the photo */}
            <View style={styles.content}>
              <View style={styles.metaRow}>
                <View style={styles.vegRow}>
                  <VegBadge isVeg={product.is_veg} size={16} />
                  <Text style={[styles.vegText, !product.is_veg && { color: Colors.danger }]}>
                    {product.is_veg ? 'Pure Veg' : 'Non-Veg'}
                  </Text>
                </View>
                {product.has_spice_level ? (
                  <Tag label="Choose your spice" icon="flame" color={Colors.spice} bg={Colors.spiceSoft} />
                ) : null}
              </View>

              <Text style={styles.name}>{product.name}</Text>
              <Text style={styles.nameMr}>{product.name_mr}</Text>

              <View style={styles.priceRow}>
                <Text style={styles.price}>{formatCurrency(product.price)}</Text>
                {quantityInCart > 0 ? (
                  <View style={styles.inCartPill}>
                    <Icon name="checkCircle" size={14} color={Colors.success} />
                    <Text style={styles.inCartText}>{quantityInCart} in cart</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.divider} />

              <Text style={styles.sectionLabel}>About this dish</Text>
              <Text style={styles.desc}>{product.description}</Text>

              {!soldOut ? (
                <View style={styles.form}>
                  {product.has_spice_level ? <SpiceOptions value={spice} onChange={setSpice} /> : null}
                  <CookingNoteField value={note} onChange={setNote} />
                </View>
              ) : null}
            </View>
          </ScrollView>

          {/* Sticky add-to-cart footer */}
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
            {soldOut ? (
              <Button title="Currently sold out" onPress={onClose} disabled style={styles.footerBtn} />
            ) : (
              <>
                <QuantityStepper
                  quantity={qty}
                  onIncrement={() => setQty((q) => Math.min(q + 1, MAX_QTY))}
                  onDecrement={() => setQty((q) => Math.max(q - 1, 1))}
                />
                <Button
                  style={styles.footerBtn}
                  icon="cart"
                  title={`Add to cart · ${formatCurrency(product.price * qty)}`}
                  onPress={() =>
                    onAdd({
                      spice_level: product.has_spice_level ? spice : undefined,
                      note,
                      quantity: qty,
                    })
                  }
                />
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: Colors.overlay },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    overflow: 'hidden',
    maxHeight: '92%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  scroll: { flexGrow: 0 },

  heroShade: {
    ...StyleSheet.absoluteFill,
    // Darkens the top edge so the grabber + close button stay visible on bright photos
    experimental_backgroundImage: 'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 35%)',
  },
  grabber: {
    position: 'absolute',
    top: Spacing.sm,
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.lg,
    right: Spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.raised,
  },
  soldOutBadge: {
    position: 'absolute',
    left: Spacing.lg,
    top: Spacing.lg,
    backgroundColor: Colors.danger,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 4,
  },
  soldOutBadgeText: { fontFamily: Fonts.bold, fontSize: 12, color: Colors.white, letterSpacing: 0.8 },

  content: {
    marginTop: -Radius.xxl,
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  vegRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  vegText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.veg },
  name: {
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 36,
    color: Colors.text,
    marginTop: Spacing.sm,
  },
  nameMr: { fontFamily: Fonts.semibold, fontSize: 18, lineHeight: 26, color: Colors.primary },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.sm },
  price: { fontFamily: Fonts.bold, fontSize: 26, lineHeight: 34, color: Colors.text },
  inCartPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
  },
  inCartText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.success },
  // Dotted rule echoes the dotted inner ring of the logo
  divider: {
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.primaryBorder,
    marginVertical: Spacing.lg,
  },
  sectionLabel: { fontFamily: Fonts.bold, fontSize: 17, lineHeight: 24, color: Colors.text },
  desc: { fontFamily: Fonts.regular, fontSize: 15.5, lineHeight: 23, color: Colors.textMuted, marginTop: 2 },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    backgroundColor: Colors.surface,
    ...Shadow.bar,
  },
  footerBtn: { flex: 1 },
});
