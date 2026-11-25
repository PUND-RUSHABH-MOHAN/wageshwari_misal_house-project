/** Asks the kitchen for a short reason before cancelling an order (shown to the customer). */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Pill, TextField } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import type { AdminOrder } from '@/types';

const QUICK_REASONS = [
  'Out of stock today',
  'Kitchen closed',
  "Couldn't reach the customer",
  "Couldn't find the address",
  'Customer asked to cancel',
];

export function KitchenCancelSheet({
  order,
  onClose,
  onConfirm,
}: {
  /** The order to cancel; null = closed. Remount (key) per order so the text resets. */
  order: AdminOrder | null;
  onClose: () => void;
  /** Throws on failure; the error is shown in the sheet. */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  const valid = trimmed.length >= 3 && trimmed.length <= 120;

  const confirm = async () => {
    if (!valid) {
      setError('Write a short reason (3–120 characters). The customer will see it.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not cancel. Please try again.');
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={order !== null}
      onClose={onClose}
      title="Cancel this order?"
      subtitle={order ? `${order.order_number} · ${order.address_snapshot.receiver_name}` : undefined}
      footer={
        <Button title="Cancel order" variant="danger" onPress={confirm} loading={saving} disabled={!valid} />
      }>
      <Text style={styles.hint}>The customer sees this reason on their order.</Text>
      <View style={styles.chips}>
        {QUICK_REASONS.map((r) => (
          <Pill key={r} label={r} selected={trimmed === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <TextField
        label="Reason"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Out of misal today"
        maxLength={120}
        error={error ?? undefined}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
});
