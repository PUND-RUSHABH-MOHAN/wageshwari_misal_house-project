/**
 * Kitchen: stop online orders (PATCH /admin/store with accepting_orders: false).
 * The optional message is shown to customers on Home and in the Cart until someone re-opens.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Pill, TextField } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';

/** Must stay ≤ 120 characters (MESSAGE_MAX in backend/src/store.py). */
const QUICK_MESSAGES = [
  'Hotel is closed today.',
  "We're closed for a holiday. See you soon!",
  'Too many orders right now. Please try again in a while.',
];
const MESSAGE_MAX = 120;

export function StopOrdersSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  /** Throws on failure; the error is shown in the sheet. Empty message = the default text. */
  onConfirm: (message: string) => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = message.trim().replace(/\s+/g, ' ');

  const confirm = async () => {
    setSaving(true);
    setError(null);
    try {
      await onConfirm(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop orders. Please try again.');
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Stop online orders?"
      subtitle="No new orders (today or tomorrow) until you turn them back on."
      footer={<Button title="Stop online orders" variant="danger" onPress={confirm} loading={saving} />}>
      <Text style={styles.hint}>
        Orders already placed are not affected. Customers see this message (optional):
      </Text>
      <View style={styles.chips}>
        {QUICK_MESSAGES.map((m) => (
          <Pill key={m} label={m} selected={trimmed === m} onPress={() => setMessage(m)} />
        ))}
      </View>
      <TextField
        label="Message for customers"
        value={message}
        onChangeText={setMessage}
        placeholder="We're not taking online orders right now."
        maxLength={MESSAGE_MAX}
        error={error ?? undefined}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: Colors.textMuted, marginBottom: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.lg },
});
