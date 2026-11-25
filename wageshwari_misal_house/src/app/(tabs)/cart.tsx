import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressPickerModal } from '@/components/AddressPickerModal';
import { Icon, type IconName } from '@/components/Icon';
import { BillRow } from '@/components/OrderCard';
import { SpiceLevelSheet } from '@/components/SpiceLevelSheet';
import {
  Button,
  Card,
  EmptyState,
  Pill,
  QuantityStepper,
  SectionTitle,
  Tag,
  TextLink,
  VegBadge,
} from '@/components/ui';
import { HOME_HREF } from '@/constants/routes';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import type { CartItem, PaymentMethod } from '@/types';
import { formatAddress, formatCurrency, formatDeliveryDate, SPICE_LABELS } from '@/utils/format';
import {
  DELIVERY_SLOTS,
  isSlotAvailable,
  istDate,
  MIN_ORDER_PAISE,
  shortOfMinimum,
  slotLabel,
} from '@/utils/pricing';

type DayKey = 'today' | 'tomorrow';

/** `available: false` shows the option greyed out. Online payment arrives in part 7. */
const PAYMENT_OPTIONS: { method: PaymentMethod; title: string; hint: string; icon: IconName; available: boolean }[] = [
  { method: 'cod', title: 'Cash on Delivery', hint: 'Pay cash or UPI to the rider', icon: 'cash', available: true },
  { method: 'online', title: 'UPI / Online', hint: 'Coming soon', icon: 'upi', available: false },
];

export default function CartScreen() {
  const { cart, bill, cartCount, selectedAddress, changeQuantity, updateCartItem, clearCart, placeOrder } =
    useApp();

  const now = new Date();
  const todayHasSlots = DELIVERY_SLOTS.some((s) => isSlotAvailable(s, true, now));

  const [day, setDay] = useState<DayKey>(todayHasSlots ? 'today' : 'tomorrow');
  const [slotId, setSlotId] = useState<string | null>(null);
  const payment: PaymentMethod = 'cod'; // the only option until online payment is ready
  const [addressOpen, setAddressOpen] = useState(false);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isToday = day === 'today';
  const effectiveDay: DayKey = isToday && !todayHasSlots ? 'tomorrow' : day;
  // Dates and slot times follow India time (IST), like the server.
  const todayIso = istDate(now);
  const tomorrowIso = istDate(now, 1);
  const deliveryDate = effectiveDay === 'today' ? todayIso : tomorrowIso;
  const availableSlots = DELIVERY_SLOTS.filter((s) => isSlotAvailable(s, effectiveDay === 'today', now));
  // Keep the user's choice if still valid, otherwise fall back to the first open slot.
  const selectedSlot = availableSlots.find((s) => s.id === slotId) ?? availableSlots[0] ?? null;

  if (cart.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <EmptyState
          emoji="🍽️"
          title="Your Misal plate is empty!"
          message="Browse our menu and add a steaming plate of Puneri or Kolhapuri misal."
          actionLabel="Browse Menu"
          onAction={() => router.navigate(HOME_HREF)}
        />
      </SafeAreaView>
    );
  }

  const shortBy = shortOfMinimum(bill);
  const soldOut = cart.filter((c) => !c.product.is_available);

  const handlePlaceOrder = async () => {
    if (placing) return;
    if (!selectedAddress) {
      setError('Please add a delivery address.');
      setAddressOpen(true);
      return;
    }
    if (!selectedSlot) {
      setError('Please choose a delivery slot.');
      return;
    }
    if (soldOut.length > 0) {
      setError(`${soldOut[0].product.name} is sold out right now. Please remove it to continue.`);
      return;
    }
    if (shortBy > 0) {
      setError(`Add ${formatCurrency(shortBy)} more. Minimum order is ${formatCurrency(MIN_ORDER_PAISE)} of food.`);
      return;
    }
    setError(null);
    setPlacing(true);
    try {
      await placeOrder({
        address_id: selectedAddress.id,
        delivery_date: deliveryDate,
        slot_label: slotLabel(selectedSlot),
        payment_method: payment,
      });
      router.navigate('/orders');
    } catch (e) {
      // The server re-checks prices, slot, address and stock; show what it said.
      setError(errorMessage(e));
    } finally {
      setPlacing(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Your Cart</Text>
          <Text style={styles.subtitle}>
            {cartCount} item{cartCount > 1 ? 's' : ''} from Wagheshwar Misal House
          </Text>
        </View>
        <TextLink title="Clear" onPress={clearCart} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Items */}
        <Card style={styles.itemsCard}>
          {cart.map((item, idx) => (
            <View key={item.id} style={[styles.itemRow, idx > 0 && styles.itemRowBorder]}>
              <View style={styles.itemInfo}>
                <View style={styles.itemNameRow}>
                  <VegBadge isVeg={item.product.is_veg} size={12} />
                  <Text style={styles.itemName} numberOfLines={2}>
                    {item.product.name}
                  </Text>
                </View>
                <Text style={styles.unitPrice}>{formatCurrency(item.product.price)} each</Text>
                <View style={styles.itemTags}>
                  {!item.product.is_available ? (
                    <Tag label="Sold out" color={Colors.danger} bg={Colors.dangerSoft} />
                  ) : null}
                  {item.spice_level ? (
                    <Tag label={SPICE_LABELS[item.spice_level]} icon="flame" color={Colors.spice} bg={Colors.spiceSoft} />
                  ) : null}
                  <Pressable onPress={() => setEditing(item)} hitSlop={6} style={styles.noteBtn}>
                    <Icon name="note" size={13} color={Colors.primary} />
                    <Text style={styles.noteText} numberOfLines={1}>
                      {item.note ? `“${item.note}”` : item.spice_level ? 'Edit' : 'Add note'}
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View style={styles.itemRight}>
                <QuantityStepper
                  compact
                  quantity={item.quantity}
                  onIncrement={() => changeQuantity(item.id, 1)}
                  onDecrement={() => changeQuantity(item.id, -1)}
                />
                <Text style={styles.lineTotal}>{formatCurrency(item.product.price * item.quantity)}</Text>
              </View>
            </View>
          ))}
          <Pressable style={styles.addMore} onPress={() => router.navigate(HOME_HREF)}>
            <Icon name="plus" size={16} color={Colors.primary} />
            <Text style={styles.addMoreText}>Add more items</Text>
          </Pressable>
        </Card>

        {/* Address */}
        <Card>
          <SectionTitle
            title="Delivery address"
            action={<TextLink title={selectedAddress ? 'Change' : 'Add'} onPress={() => setAddressOpen(true)} />}
          />
          {selectedAddress ? (
            <View style={styles.addressRow}>
              <View style={styles.addressIcon}>
                <Icon name={selectedAddress.label === 'Work' ? 'bag' : 'home'} size={18} color={Colors.primary} />
              </View>
              <View style={styles.flex}>
                <Text style={styles.addressTitle}>
                  {selectedAddress.label} · {selectedAddress.receiver_name}
                </Text>
                <Text style={styles.addressText}>{formatAddress(selectedAddress)}</Text>
              </View>
            </View>
          ) : (
            <Button title="Add delivery address" icon="plus" variant="outline" onPress={() => setAddressOpen(true)} />
          )}
        </Card>

        {/* Slot */}
        <Card>
          <SectionTitle title="Delivery slot" />
          <View style={styles.dayRow}>
            <Pill
              label="Today"
              sublabel={todayHasSlots ? formatDeliveryDate(todayIso).slice(0, -5) : 'Slots closed'}
              selected={effectiveDay === 'today'}
              disabled={!todayHasSlots}
              onPress={() => setDay('today')}
              style={styles.flex}
            />
            <Pill
              label="Tomorrow"
              sublabel={formatDeliveryDate(tomorrowIso).slice(0, -5)}
              selected={effectiveDay === 'tomorrow'}
              onPress={() => setDay('tomorrow')}
              style={styles.flex}
            />
          </View>
          <View style={styles.slotGrid}>
            {DELIVERY_SLOTS.map((slot) => {
              const available = availableSlots.includes(slot);
              return (
                <Pill
                  key={slot.id}
                  label={slot.name}
                  sublabel={slot.time}
                  selected={selectedSlot?.id === slot.id}
                  disabled={!available}
                  onPress={() => setSlotId(slot.id)}
                  style={styles.slotPill}
                />
              );
            })}
          </View>
        </Card>

        {/* Payment */}
        <Card>
          <SectionTitle title="Payment method" />
          <View style={styles.payGrid}>
            {PAYMENT_OPTIONS.map((opt) => {
              const selected = payment === opt.method;
              return (
                <Pressable
                  key={opt.method}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: !opt.available }}
                  disabled={!opt.available}
                  style={[
                    styles.payOption,
                    selected && styles.payOptionSelected,
                    !opt.available && styles.payOptionDisabled,
                  ]}>
                  <View style={styles.payHead}>
                    <Icon name={opt.icon} size={22} color={selected ? Colors.primary : Colors.textMuted} />
                    <Icon
                      name={selected ? 'radioOn' : 'radioOff'}
                      size={20}
                      color={selected ? Colors.primary : Colors.textSubtle}
                    />
                  </View>
                  <Text style={styles.payTitle}>{opt.title}</Text>
                  <Text style={styles.payHint}>{opt.hint}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Bill */}
        <Card style={styles.billCard}>
          <SectionTitle title="Bill details" />
          <BillRow label="Item subtotal" value={formatCurrency(bill.subtotal)} />
          <BillRow label="Delivery fee" value={formatCurrency(bill.delivery_fee)} />
          <BillRow label="GST (5% on items)" value={formatCurrency(bill.tax)} />
          <View style={styles.dashed} />
          <BillRow label="Grand total" value={formatCurrency(bill.total)} strong />
          {shortBy > 0 ? (
            <Text style={styles.minimum}>
              Minimum order is {formatCurrency(MIN_ORDER_PAISE)} of food (delivery and GST not included). Add{' '}
              {formatCurrency(shortBy)} more.
            </Text>
          ) : null}
        </Card>

        <Text style={styles.policy}>
          Orders can be cancelled free of charge until the kitchen starts preparing.
        </Text>
      </ScrollView>

      {/* Sticky footer */}
      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.footerRow}>
          <View>
            <Text style={styles.footerTotal}>{formatCurrency(bill.total)}</Text>
            <Text style={styles.footerHint}>
              {shortBy > 0 ? `Add ${formatCurrency(shortBy)} more` : 'Pay on delivery'}
            </Text>
          </View>
          <Button
            title="Place Order"
            onPress={handlePlaceOrder}
            loading={placing}
            disabled={!selectedSlot || shortBy > 0 || soldOut.length > 0}
            style={styles.placeBtn}
          />
        </View>
      </View>

      <AddressPickerModal visible={addressOpen} onClose={() => setAddressOpen(false)} />
      <SpiceLevelSheet
        key={editing?.id ?? 'none'}
        mode="edit"
        product={editing?.product ?? null}
        visible={editing !== null}
        initialSpice={editing?.spice_level ?? 'medium'}
        initialNote={editing?.note ?? ''}
        onClose={() => setEditing(null)}
        onConfirm={({ spice_level, note }) => {
          if (editing) updateCartItem(editing.id, { spice_level, note });
          setEditing(null);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: { fontFamily: Fonts.extrabold, fontSize: 26, lineHeight: 34, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textMuted },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },

  itemsCard: { paddingVertical: Spacing.sm },
  itemRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md },
  itemRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  itemInfo: { flex: 1, gap: 4 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  itemName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  unitPrice: { fontSize: 12, color: Colors.textMuted },
  itemTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  noteBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 180 },
  noteText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  itemRight: { alignItems: 'flex-end', gap: Spacing.sm },
  lineTotal: { fontSize: 15, fontWeight: '800', color: Colors.text },
  addMore: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: Spacing.md,
  },
  addMoreText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },

  addressRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  addressIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addressTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  addressText: { fontSize: 13, color: Colors.textMuted, lineHeight: 18, marginTop: 2 },

  dayRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  slotPill: { flexBasis: '47%', flexGrow: 1, borderRadius: Radius.md },

  payGrid: { flexDirection: 'row', gap: Spacing.md },
  payOption: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 4,
  },
  payOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  payOptionDisabled: { opacity: 0.5 },
  payHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  payTitle: { fontSize: 14, fontWeight: '800', color: Colors.text },
  payHint: { fontSize: 11, color: Colors.textMuted },

  billCard: { gap: Spacing.sm },
  dashed: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: Colors.border, marginVertical: Spacing.xs },
  minimum: { fontSize: 12, color: Colors.warning, fontWeight: '600', marginTop: Spacing.xs },
  policy: { fontSize: 12, color: Colors.textSubtle, textAlign: 'center', paddingHorizontal: Spacing.lg },

  footer: {
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
    ...Shadow.bar,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  footerTotal: { fontFamily: Fonts.extrabold, fontSize: 22, lineHeight: 28, color: Colors.text },
  footerHint: { fontSize: 12, color: Colors.textMuted },
  placeBtn: { flex: 1 },
  error: { fontSize: 13, color: Colors.danger, fontWeight: '600' },
});
