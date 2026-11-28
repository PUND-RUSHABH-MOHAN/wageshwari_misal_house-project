/**
 * One order on the Kitchen board (admins only): what to cook, who it's for, who delivers it,
 * and the one button that moves it on (part 7c: Confirm -> auto-assign -> Picked up -> Delivered).
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

/**
 * The single forward step the server allows from each status. CONFIRMED has none: it needs a
 * delivery boy (Assign). ASSIGNED / OUT_FOR_DELIVERY are normally the delivery boy's taps; the
 * admin can do them too (e.g. when the owner delivers).
 */
export const NEXT_STEP: Partial<Record<OrderStatus, { status: OrderStatus; label: string; icon: IconName }>> = {
  PENDING: { status: 'CONFIRMED', label: 'Confirm order', icon: 'checkCircle' },
  // UPI: after checking the hotel's UPI app for this amount / order number / UTR.
  PENDING_PAYMENT: { status: 'CONFIRMED', label: 'Payment received · Confirm', icon: 'checkCircle' },
  ASSIGNED: { status: 'OUT_FOR_DELIVERY', label: 'Picked up', icon: 'bag' },
  PREPARING: { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery', icon: 'bag' }, // before part 7c
  OUT_FOR_DELIVERY: { status: 'DELIVERED', label: 'Mark delivered', icon: 'checkCircle' },
};

export const isKitchenDone = (s: OrderStatus) => s === 'DELIVERED' || s === 'CANCELLED';

export function KitchenOrderCard({
  order,
  busy,
  onNext,
  onCancel,
  onAssign,
}: {
  order: AdminOrder;
  /** A status change for this order is in flight. */
  busy: boolean;
  onNext: (status: OrderStatus) => void;
  onCancel: () => void;
  /** Open the delivery boy picker (assign / reassign). */
  onAssign: () => void;
}) {
  const a = order.address_snapshot;
  const next = NEXT_STEP[order.status];
  const done = isKitchenDone(order.status);
  const collectCash = order.payment_method === 'cod' && order.payment_status !== 'paid' && !done;
  const boy = order.delivery_boy;
  const canReassign = order.status === 'ASSIGNED' || order.status === 'PREPARING';

  return (
    <View style={[styles.card, done && styles.cardDone]}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.orderNo}>{order.order_number}</Text>
          <Text style={styles.meta}>Placed {istClockTime(order.created_at)}</Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      {/* UPI orders: check the money before cooking */}
      {order.status === 'PENDING_PAYMENT' ? (
        <View style={styles.payCheck}>
          <Text style={styles.payTitle}>
            Check {formatCurrency(order.total)} in your UPI app
          </Text>
          <Text style={styles.meta}>
            Note “Order {order.order_number}”
            {order.utr ? '' : order.payment_expires_at ? ` · auto-cancels at ${istClockTime(order.payment_expires_at)} if unpaid` : ''}
          </Text>
          {order.utr ? (
            <Text selectable style={styles.utr}>
              UTR {order.utr}
            </Text>
          ) : (
            <Text style={styles.meta}>The customer hasn’t entered a UTR yet.</Text>
          )}
        </View>
      ) : null}

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

      {/* Who delivers it (part 7c) */}
      {boy ? (
        <View style={styles.boy}>
          <Icon name="delivery" size={20} color={Colors.primaryDark} />
          <View style={styles.flex}>
            <Text style={styles.boyName}>{boy.name}</Text>
            <Text style={styles.meta}>
              {order.assigned_by === 'auto' ? 'Assigned automatically' : 'Assigned by hand'}
              {order.assigned_at ? ` · ${istClockTime(order.assigned_at)}` : ''}
            </Text>
          </View>
          {boy.phone ? (
            <Pressable
              onPress={() => callPhone(boy.phone)}
              hitSlop={6}
              accessibilityLabel={`Call ${boy.name}`}
              style={styles.roundBtn}>
              <Icon name="phone" size={18} color={Colors.primary} />
            </Pressable>
          ) : null}
          {canReassign ? (
            <Pressable onPress={onAssign} hitSlop={8} disabled={busy} accessibilityRole="button">
              <Text style={styles.link}>Reassign</Text>
            </Pressable>
          ) : null}
        </View>
      ) : order.status === 'CONFIRMED' || order.status === 'PREPARING' ? (
        <View style={styles.noBoy}>
          <Icon name="info" size={18} color={Colors.warning} />
          <Text style={styles.noBoyText}>No delivery boy yet. Assign someone to send it out.</Text>
        </View>
      ) : null}

      {order.status === 'CANCELLED' ? (
        <Text style={styles.cancelled}>
          {order.cancelled_by === 'kitchen'
            ? `Cancelled by the kitchen: ${order.cancel_reason ?? ''}`
            : 'Cancelled by the customer'}
        </Text>
      ) : null}

      {!done ? (
        <View style={styles.actions}>
          {order.status === 'CONFIRMED' || (order.status === 'PREPARING' && !boy) ? (
            <Button title="Assign delivery boy" icon="delivery" onPress={onAssign} loading={busy} style={styles.flex} />
          ) : next ? (
            <Button
              title={next.label}
              icon={next.icon}
              // ASSIGNED: normally the delivery boy taps "Picked up"; this is the admin's fallback.
              variant={order.status === 'ASSIGNED' ? 'outline' : undefined}
              onPress={() => onNext(next.status)}
              loading={busy}
              style={styles.flex}
            />
          ) : null}
          <Button
            title={order.status === 'PENDING_PAYMENT' ? 'Not received' : 'Cancel'}
            variant="ghost"
            onPress={onCancel}
            disabled={busy}
            style={styles.cancelBtn}
          />
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
  payCheck: {
    gap: 4,
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  payTitle: { fontSize: 15, fontWeight: '800', color: Colors.warning },
  utr: { fontSize: 16, fontWeight: '800', color: Colors.text, letterSpacing: 1 },
  boy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  boyName: { fontSize: 14, fontWeight: '800', color: Colors.primaryDark },
  link: { fontSize: 13, fontWeight: '800', color: Colors.primary },
  noBoy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.warningSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  noBoyText: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.warning },
});
