/**
 * Part 7d kitchen sheets:
 * - DelaySheet: push an order's estimated delivery later (PATCH /admin/orders/:id/eta).
 * - RefundSheet: record the hand-made UPI refund of a cancelled order (POST /admin/orders/:id/refund).
 * - PrepTimeSheet: the base cooking time used for every new estimate (PATCH /admin/store).
 * Each `onConfirm` throws on failure; the message is shown in the sheet.
 */
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Pill, TextField } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { AdminOrder } from '@/types';
import { formatCurrency } from '@/utils/format';
import { istClockTime } from '@/utils/pricing';

const failMessage = (e: unknown) => (e instanceof Error ? e.message : 'Could not save. Please try again.');

// ---------------------------------------------------------------------------
// Delay
// ---------------------------------------------------------------------------
const DELAYS = [10, 15, 20, 30, 45, 60];
const DELAY_REASONS = ['Kitchen is busy', 'Waiting for a delivery boy', 'Heavy rain', 'Traffic on the road'];
const ROUND_MS = 5 * 60000;

/** Same maths as the server (admin.py delay_order): from the current estimate, or now if that passed. */
function previewEta(order: AdminOrder, minutes: number, now = Date.now()): string {
  const current = order.estimated_delivery_at ? new Date(order.estimated_delivery_at).getTime() : now;
  const base = Math.max(current, now) + minutes * 60000;
  return new Date(Math.ceil(base / ROUND_MS) * ROUND_MS).toISOString();
}

export function DelaySheet({
  order,
  onClose,
  onConfirm,
}: {
  /** null = closed. Remount (key) per order so the form resets. */
  order: AdminOrder | null;
  onClose: () => void;
  onConfirm: (minutes: number, reason: string) => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(15);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim().replace(/\s+/g, ' ');

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(minutes, trimmed);
    } catch (e) {
      setError(failMessage(e));
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={order !== null}
      onClose={onClose}
      title="Running late?"
      subtitle={
        order?.estimated_delivery_at
          ? `${order.order_number} · now ${istClockTime(order.estimated_delivery_at)}`
          : order?.order_number
      }
      footer={<Button title={`Push estimate +${minutes} min`} onPress={confirm} loading={saving} />}>
      <Text style={styles.hint}>
        The customer sees the new time. From 10 minutes late they also get a “running late” notice.
      </Text>
      <View style={styles.chips}>
        {DELAYS.map((m) => (
          <Pill key={m} label={`+${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      {order ? <Text style={styles.preview}>New estimate about {istClockTime(previewEta(order, minutes))}</Text> : null}
      <View style={styles.chips}>
        {DELAY_REASONS.map((r) => (
          <Pill key={r} label={r} selected={trimmed === r} onPress={() => setReason(trimmed === r ? '' : r)} />
        ))}
      </View>
      <TextField
        label="Reason (optional, shown to the customer)"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Big order in the kitchen"
        maxLength={120}
        error={error ?? undefined}
      />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Refund
// ---------------------------------------------------------------------------
export function RefundSheet({
  order,
  onClose,
  onConfirm,
}: {
  order: AdminOrder | null;
  onClose: () => void;
  onConfirm: (status: 'refunded' | 'not_needed', reference: string) => Promise<void>;
}) {
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState<'refunded' | 'not_needed' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (status: 'refunded' | 'not_needed') => {
    setSaving(status);
    setError(null);
    try {
      await onConfirm(status, reference.trim());
    } catch (e) {
      setError(failMessage(e));
      setSaving(null);
    }
  };

  // "Refunded" is final: only after the money has really gone back.
  const confirmRefunded = () =>
    Alert.alert(
      'Money sent back?',
      `Only tap this after ${order ? formatCurrency(order.total) : 'the amount'} has left your UPI app. The customer will see “Refunded”.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, refunded', onPress: () => save('refunded') },
      ],
    );
  const confirmNotNeeded = () =>
    Alert.alert(
      'No payment arrived?',
      'Check your UPI app first. The customer will see that there was nothing to refund.',
      [
        { text: 'Check again', style: 'cancel' },
        { text: 'Nothing arrived', onPress: () => save('not_needed') },
      ],
    );

  return (
    <BottomSheet
      visible={order !== null}
      onClose={onClose}
      title="Refund this UPI payment"
      subtitle={order ? `${order.order_number} · ${formatCurrency(order.total)}` : undefined}
      footer={
        <View style={styles.footerCol}>
          <Button title="Refund sent" icon="checkCircle" onPress={confirmRefunded} loading={saving === 'refunded'} disabled={saving !== null} />
          <Button
            title="No payment arrived"
            variant="ghost"
            onPress={confirmNotNeeded}
            loading={saving === 'not_needed'}
            disabled={saving !== null}
          />
        </View>
      }>
      <View style={styles.steps}>
        <Text style={styles.step}>
          1. Open the hotel’s UPI app and find the payment of {order ? formatCurrency(order.total) : ''}
          {order?.utr ? ` with UTR ${order.utr}` : ''} (note “Order {order?.order_number}”).
        </Text>
        <Text style={styles.step}>2. Send the same amount back to that person.</Text>
        <Text style={styles.step}>3. Enter the refund’s UTR below (optional) and tap Refund sent.</Text>
      </View>
      <TextField
        label="Refund UTR / reference (optional)"
        value={reference}
        onChangeText={setReference}
        placeholder="e.g. 412345678901"
        maxLength={40}
        error={error ?? undefined}
      />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Cooking time
// ---------------------------------------------------------------------------
const PREP_CHOICES = [10, 15, 20, 25, 30, 40, 45, 60];

export function PrepTimeSheet({
  visible,
  current,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  current: number;
  onClose: () => void;
  onConfirm: (minutes: number) => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = PREP_CHOICES.includes(current) ? PREP_CHOICES : [...PREP_CHOICES, current].sort((a, b) => a - b);

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(minutes);
    } catch (e) {
      setError(failMessage(e));
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Cooking time"
      subtitle="Used for every new order's estimate"
      footer={
        <Button title={`Save ${minutes} min`} onPress={confirm} loading={saving} disabled={minutes === current} />
      }>
      <Text style={styles.hint}>
        Time to cook and pack one order when the kitchen is free. The app adds 2 min for each order already
        waiting (up to 30 min), then the travel time to the customer.
      </Text>
      <View style={styles.chips}>
        {choices.map((m) => (
          <Pill key={m} label={`${m} min`} selected={minutes === m} onPress={() => setMinutes(m)} />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
  preview: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  steps: { gap: Spacing.sm, marginBottom: Spacing.lg },
  step: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  footerCol: { gap: Spacing.sm },
  error: { fontSize: 13, color: Colors.danger, fontWeight: '600' },
});
