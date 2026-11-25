/**
 * One order on the Kitchen board (admins only): what to cook, who it's for, and the one
 * button that moves it to the next step.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { StatusBadge } from '@/components/OrderCard';
import { Button, Tag } from '@/components/ui';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import type { AdminOrder, OrderStatus } from '@/types';
import { formatAddress, formatCurrency, formatPhone, SPICE_LABELS } from '@/utils/format';
import { callPhone, openMapAt } from '@/utils/maps';
import { istClockTime } from '@/utils/pricing';

/** The single forward step the server allows from each status. */
export const NEXT_STEP: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: IconName }>> = {
  CONFIRMED: { status: 'PREPARING', label: 'Start preparing', icon: 'flame' },
  PREPARING: { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery', icon: 'bag' },
  OUT_FOR_DELIVERY: { status: 'DELIVERED', label: 'Mark delivered', icon: 'checkCircle' },
};

export const isKitchenDone = (s: OrderStatus) => s === 'DELIVERED' || s === 'CANCELLED';

export function KitchenOrderCard({
  order,
  busy,
  onNext,
  onCancel,
}: {
  order: AdminOrder;
  /** A status change for this order is in flight. */
  busy: boolean;
  onNext: (status: OrderStatus) => void;
  onCancel: () => void;
}) {
  const a = order.address_snapshot;
  const next = NEXT_STEP[order.status];
  const done = isKitchenDone(order.status);
  const collectCash = order.payment_method === 'cod' && order.payment_status !== 'paid' && !done;

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.orderNo}>{order.order_number}</Text>
          <Text style={styles.meta}>Placed {istClockTime(order.created_at)}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      {/* What to cook */}
      <View style={styles.items}>
        {order.items.map((item) => (
          <View key={item.id} style={styles.itemRow}>
            <Text style={styles.qty}>{item.quantity} ×</Text>
            <View style={styles.flex}>
              <Text style={styles.itemName}>{item.product_name}</Text>
              {item.spice_level || item.note ? (
                <View style={styles.itemTags}>
                  {item.spice_level ? (
                    <Tag label={SPICE_LABELS[item.spice_level]} icon="flame" color={Colors.spice} bg={Colors.spiceSoft} />
                  ) : null}
                  {item.note ? <Text style={styles.note}>“{item.note}”</Text> : null}
                </View>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {/* Who it's for */}
      <View style={styles.customer}>
        <View style={styles.flex}>
          <Text style={styles.customerName}>
            {a.receiver_name} · {formatPhone(a.receiver_phone)}
          </Text>
          <Text style={styles.meta}>
            {formatAddress(a)}
            {a.distance_km !== undefined ? ` · ${a.distance_km.toFixed(1)} km` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => callPhone(a.receiver_phone)}
          hitSlop={6}
          accessibilityLabel={`Call ${a.receiver_name}`}
          style={styles.roundBtn}>
          <Icon name="phone" size={18} color={Colors.primary} />
        </Pressable>
        <Pressable
          onPress={() => openMapAt(a)}
          hitSlop={6}
          accessibilityLabel="Open the delivery pin in Google Maps"
          style={styles.roundBtn}>
          <Icon name="directions" size={18} color={Colors.primary} />
        </Pressable>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.total}>{formatCurrency(order.total)}</Text>
        <Text style={[styles.meta, collectCash && styles.collect]}>
          {order.payment_method === 'cod'
            ? order.payment_status === 'paid'
              ? 'Cash collected'
              : collectCash
                ? 'Collect cash on delivery'
                : 'Cash on delivery'
            : 'UPI'}
        </Text>
      </View>

      {order.status === 'CANCELLED' ? (
        <Text style={styles.cancelled}>
          {order.cancelled_by === 'kitchen'
            ? `Cancelled by the kitchen: ${order.cancel_reason ?? ''}`
            : 'Cancelled by the customer'}
        </Text>
      ) : null}

      {!done ? (
        <View style={styles.actions}>
          {next ? (
            <Button
              title={next.label}
              icon={next.icon}
              onPress={() => onNext(next.status)}
              loading={busy}
              style={styles.flex}
            />
          ) : null}
          <Button title="Cancel" variant="ghost" onPress={onCancel} disabled={busy} style={styles.cancelBtn} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.card,
  },
  cardDone: { opacity: 0.7 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  orderNo: { fontSize: 15, fontWeight: '800', color: Colors.text, letterSpacing: 0.3 },
  meta: { fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  items: { gap: Spacing.sm, backgroundColor: Colors.surfaceMuted, borderRadius: Radius.md, padding: Spacing.md },
  itemRow: { flexDirection: 'row', gap: Spacing.sm },
  qty: { fontSize: 16, fontWeight: '800', color: Colors.primary, minWidth: 34 },
  itemName: { fontSize: 16, fontWeight: '700', color: Colors.text },
  itemTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  note: { fontSize: 13, color: Colors.text, fontStyle: 'italic' },
  customer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  customerName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  roundBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  total: { fontSize: 17, fontWeight: '800', color: Colors.text },
  collect: { color: Colors.warning, fontWeight: '800' },
  cancelled: { fontSize: 13, color: Colors.danger, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  cancelBtn: { paddingHorizontal: Spacing.lg },
});
