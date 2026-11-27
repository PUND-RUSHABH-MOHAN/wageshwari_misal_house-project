import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Button, Tag } from '@/components/ui';
import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { isCancellable } from '@/context/AppContext';
import type { Order, OrderStatus } from '@/types';
import {
  formatAddress,
  formatCurrency,
  formatDateTime,
  formatDeliveryDate,
  formatPhone,
  ORDER_STATUS_LABELS,
  SPICE_LABELS,
} from '@/utils/format';

const STATUS_COLORS: Record<OrderStatus, { fg: string; bg: string }> = {
  PENDING_PAYMENT: { fg: Colors.warning, bg: Colors.warningSoft },
  CONFIRMED: { fg: Colors.info, bg: Colors.infoSoft },
  PREPARING: { fg: Colors.primaryDark, bg: Colors.primarySoft },
  OUT_FOR_DELIVERY: { fg: '#6A1B9A', bg: '#F3E5F5' },
  DELIVERED: { fg: Colors.success, bg: Colors.successSoft },
  CANCELLED: { fg: Colors.danger, bg: Colors.dangerSoft },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const c = STATUS_COLORS[status];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <View style={[styles.badgeDot, { backgroundColor: c.fg }]} />
      <Text style={[styles.badgeText, { color: c.fg }]}>{ORDER_STATUS_LABELS[status].toUpperCase()}</Text>
    </View>
  );
}

const TIMELINE: { status: OrderStatus; title: string; hint: string; icon: IconName }[] = [
  { status: 'CONFIRMED', title: 'Order confirmed', hint: 'Kitchen has received your order', icon: 'checkCircle' },
  { status: 'PREPARING', title: 'Preparing', hint: 'Tarri is simmering, pav is toasting', icon: 'flame' },
  { status: 'OUT_FOR_DELIVERY', title: 'Out for delivery', hint: 'Rider is on the way', icon: 'bag' },
  { status: 'DELIVERED', title: 'Delivered', hint: 'Enjoy your misal!', icon: 'home' },
];
const RANK: Record<OrderStatus, number> = {
  PENDING_PAYMENT: -1,
  CONFIRMED: 0,
  PREPARING: 1,
  OUT_FOR_DELIVERY: 2,
  DELIVERED: 3,
  CANCELLED: -2,
};

export function OrderTimeline({ order }: { order: Order }) {
  const { status } = order;
  if (status === 'CANCELLED') {
    const text =
      order.cancelled_by === 'kitchen' && order.cancel_reason
        ? `The kitchen cancelled this order: ${order.cancel_reason}`
        : order.cancelled_by === 'system' && order.cancel_reason
          ? `Cancelled: ${order.cancel_reason}`
          : 'This order was cancelled.';
    return (
      <View style={[styles.notice, { backgroundColor: Colors.dangerSoft }]}>
        <Icon name="close" size={16} color={Colors.danger} />
        <Text style={[styles.noticeText, { color: Colors.danger }]}>{text}</Text>
      </View>
    );
  }
  const current = RANK[status];
  return (
    <View>
      {status === 'PENDING_PAYMENT' ? (
        <View style={[styles.notice, { backgroundColor: Colors.warningSoft, marginBottom: Spacing.md }]}>
          <Icon name="clock" size={16} color={Colors.warning} />
          <Text style={[styles.noticeText, { color: Colors.warning }]}>
            {order.payment_status === 'submitted'
              ? `The hotel is checking your UPI payment (UTR ${order.utr}).`
              : 'Waiting for your UPI payment.'}
          </Text>
        </View>
      ) : null}
      {TIMELINE.map((step, i) => {
        const done = i <= current;
        const active = i === current && status !== 'DELIVERED';
        const last = i === TIMELINE.length - 1;
        return (
          <View key={step.status} style={styles.step}>
            <View style={styles.stepRail}>
              <View
                style={[
                  styles.stepDot,
                  done && styles.stepDotDone,
                  active && styles.stepDotActive,
                ]}>
                <Icon name={step.icon} size={13} color={done ? Colors.white : Colors.textSubtle} />
              </View>
              {!last ? <View style={[styles.stepLine, i < current && styles.stepLineDone]} /> : null}
            </View>
            <View style={styles.stepBody}>
              <Text style={[styles.stepTitle, !done && styles.stepTitleTodo]}>
                {step.title}
                {active ? '  •  Now' : ''}
              </Text>
              <Text style={styles.stepHint}>{step.hint}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function OrderCard({
  order,
  expanded,
  onToggle,
  onCancel,
  cancelling = false,
}: {
  order: Order;
  expanded: boolean;
  onToggle: () => void;
  onCancel: () => void;
  /** Spinner on the cancel button while POST /orders/:id/cancel runs. */
  cancelling?: boolean;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const summary = order.items.map((i) => `${i.quantity} × ${i.product_name}`).join(', ');
  const a = order.address_snapshot;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <View style={styles.headRow}>
          <View style={styles.flex}>
            <Text style={styles.orderNo}>{order.order_number}</Text>
            <Text style={styles.meta}>{formatDateTime(order.created_at)}</Text>
          </View>
          <StatusBadge status={order.status} />
        </View>
        <Text style={styles.summary} numberOfLines={expanded ? undefined : 2}>
          {summary}
        </Text>
        <View style={styles.footRow}>
          <Text style={styles.meta}>
            {itemCount} item{itemCount > 1 ? 's' : ''} · {order.payment_method === 'cod' ? 'COD' : 'UPI'}
          </Text>
          <View style={styles.totalRow}>
            <Text style={styles.total}>{formatCurrency(order.total)}</Text>
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={18} color={Colors.textMuted} />
          </View>
        </View>
      </Pressable>

      {/* UPI order not paid yet: straight to the Pay screen */}
      {order.status === 'PENDING_PAYMENT' && order.payment_status === 'pending' && order.upi_payment ? (
        <Button
          title={`Pay ${formatCurrency(order.total)} now`}
          icon="upi"
          onPress={() => router.push({ pathname: '/pay/[id]', params: { id: order.id } })}
          style={styles.payNow}
        />
      ) : null}

      {expanded ? (
        <View style={styles.receipt}>
          <View style={styles.divider} />

          <Text style={styles.blockTitle}>Order status</Text>
          <OrderTimeline order={order} />

          <View style={styles.divider} />
          <Text style={styles.blockTitle}>Delivery</Text>
          <View style={styles.infoRow}>
            <Icon name="clock" size={16} color={Colors.primary} />
            <Text style={styles.infoText}>
              {formatDeliveryDate(order.delivery_date)} · {order.slot_label}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Icon name="location" size={16} color={Colors.primary} />
            <View style={styles.flex}>
              <Text style={styles.infoStrong}>
                {a.label} · {a.receiver_name} ({formatPhone(a.receiver_phone)})
              </Text>
              <Text style={styles.infoText}>{formatAddress(a)}</Text>
            </View>
          </View>

          <View style={styles.divider} />
          <Text style={styles.blockTitle}>Items</Text>
          {order.items.map((item) => (
            <View key={item.id} style={styles.itemRow}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>
                  {item.quantity} × {item.product_name}
                </Text>
                <View style={styles.itemTags}>
                  {item.spice_level ? (
                    <Tag label={SPICE_LABELS[item.spice_level]} icon="flame" color={Colors.spice} bg={Colors.spiceSoft} />
                  ) : null}
                  {item.note ? <Text style={styles.itemNote}>“{item.note}”</Text> : null}
                </View>
              </View>
              <Text style={styles.itemPrice}>{formatCurrency(item.line_total)}</Text>
            </View>
          ))}

          <View style={styles.divider} />
          <BillRow label="Item subtotal" value={formatCurrency(order.subtotal)} />
          <BillRow label="Delivery fee" value={formatCurrency(order.delivery_fee)} />
          <BillRow label="GST (5%)" value={formatCurrency(order.tax)} />
          <View style={styles.dashed} />
          <BillRow label="Grand total" value={formatCurrency(order.total)} strong />
          <View style={styles.payRow}>
            <Icon name={order.payment_method === 'cod' ? 'cash' : 'upi'} size={16} color={Colors.textMuted} />
            <Text style={styles.meta}>
              {order.payment_method === 'cod' ? 'Cash on Delivery' : 'UPI'} ·{' '}
            </Text>
            <Text
              style={[
                styles.meta,
                { fontWeight: '800', color: order.payment_status === 'paid' ? Colors.success : Colors.warning },
              ]}>
              {order.payment_status === 'paid'
                ? 'PAID'
                : order.payment_status === 'submitted'
                  ? 'BEING CHECKED'
                  : 'PAYMENT PENDING'}
            </Text>
          </View>

          {isCancellable(order) ? (
            <Button
              title="Cancel order"
              variant="danger"
              onPress={onCancel}
              loading={cancelling}
              style={styles.cancelBtn}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function BillRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.billRow}>
      <Text style={[styles.billLabel, strong && styles.billStrong]}>{label}</Text>
      <Text style={[styles.billValue, strong && styles.billStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  orderNo: { fontSize: 15, fontWeight: '800', color: Colors.text, letterSpacing: 0.3 },
  meta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  summary: { fontSize: 14, color: Colors.text, marginTop: Spacing.md, lineHeight: 20 },
  footRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: Spacing.md,
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  total: { fontSize: 16, fontWeight: '800', color: Colors.text },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  receipt: { gap: Spacing.sm },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  dashed: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.border,
    marginVertical: Spacing.xs,
  },
  blockTitle: { fontSize: 13, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, marginBottom: 4 },
  infoRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  infoStrong: { fontSize: 13, fontWeight: '700', color: Colors.text },
  infoText: { fontSize: 13, color: Colors.textMuted, lineHeight: 18, flexShrink: 1 },

  itemRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  itemName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  itemTags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm, marginTop: 4 },
  itemNote: { fontSize: 12, fontStyle: 'italic', color: Colors.textMuted },
  itemPrice: { fontSize: 14, fontWeight: '700', color: Colors.text },

  billRow: { flexDirection: 'row', justifyContent: 'space-between' },
  billLabel: { fontSize: 14, color: Colors.textMuted },
  billValue: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  billStrong: { fontSize: 16, fontWeight: '800', color: Colors.text },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  cancelBtn: { marginTop: Spacing.md },
  payNow: { marginTop: Spacing.md },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  noticeText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },

  step: { flexDirection: 'row', gap: Spacing.md },
  stepRail: { alignItems: 'center', width: 26 },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: Colors.success },
  stepDotActive: { backgroundColor: Colors.primary, boxShadow: '0px 0px 0px 4px #FFE0C7' },
  stepLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: Colors.border, marginVertical: 2 },
  stepLineDone: { backgroundColor: Colors.success },
  stepBody: { flex: 1, paddingBottom: Spacing.md },
  stepTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  stepTitleTodo: { color: Colors.textSubtle },
  stepHint: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
});
