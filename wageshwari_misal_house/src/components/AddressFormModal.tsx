import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Pill, TextField } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { errorMessage } from '@/services/api';
import type { Address, AddressInput, AddressLabel } from '@/types';
import { isValidIndianMobile, isValidPunePincode } from '@/utils/format';

const LABELS: AddressLabel[] = ['Home', 'Work', 'Other'];

type Errors = Partial<Record<'receiver_name' | 'receiver_phone' | 'line1' | 'pincode', string>>;

/**
 * Add / edit address sheet. Parent should pass `key={initial?.id ?? 'new'}`
 * so form state re-initialises when switching between addresses.
 */
export function AddressFormModal({
  visible,
  initial,
  defaults,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial?: Address | null;
  defaults?: { receiver_name?: string; receiver_phone?: string };
  onClose: () => void;
  /** Saves to the server; a rejection is shown in the sheet and keeps it open. */
  onSave: (input: AddressInput) => Promise<void>;
}) {
  const [label, setLabel] = useState<AddressLabel>(initial?.label ?? 'Home');
  const [receiverName, setReceiverName] = useState(initial?.receiver_name ?? defaults?.receiver_name ?? '');
  const [receiverPhone, setReceiverPhone] = useState(
    initial?.receiver_phone ?? defaults?.receiver_phone ?? '',
  );
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [landmark, setLandmark] = useState(initial?.landmark ?? '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const submit = async () => {
    if (saving) return;
    const next: Errors = {};
    if (!receiverName.trim()) next.receiver_name = 'Receiver name is required';
    if (!isValidIndianMobile(receiverPhone)) next.receiver_phone = 'Enter a valid 10-digit mobile number';
    if (line1.trim().length < 5) next.line1 = 'Enter flat / house no. and building';
    if (!isValidPunePincode(pincode)) next.pincode = 'We deliver only in Pune (410xxx – 412xxx)';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSaveError(null);
    setSaving(true);
    try {
      await onSave({
        id: initial?.id,
        label,
        receiver_name: receiverName.trim(),
        receiver_phone: receiverPhone,
        line1: line1.trim(),
        line2: line2.trim() || undefined,
        landmark: landmark.trim() || undefined,
        pincode,
        is_default: isDefault,
      });
    } catch (e) {
      setSaveError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const digitsOnly = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={initial ? 'Edit address' : 'Add new address'}
      subtitle="Delivering across Pune city"
      footer={
        <View style={styles.footer}>
          {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}
          <Button title={initial ? 'Update address' : 'Save address'} onPress={submit} loading={saving} />
        </View>
      }>
      <View style={styles.labelRow}>
        {LABELS.map((l) => (
          <Pill key={l} label={l} selected={label === l} onPress={() => setLabel(l)} style={styles.labelPill} />
        ))}
      </View>

      <TextField
        label="Flat / House no., Building *"
        value={line1}
        onChangeText={setLine1}
        placeholder="Flat 402, Shivneri Heights"
        error={errors.line1}
      />
      <TextField
        label="Area / Street"
        value={line2}
        onChangeText={setLine2}
        placeholder="Karve Road, Erandwane"
      />
      <TextField
        label="Landmark"
        value={landmark}
        onChangeText={setLandmark}
        placeholder="Near Nal Stop"
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField label="City" value="Pune" editable={false} style={styles.readonly} />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Pincode *"
            value={pincode}
            onChangeText={(v) => setPincode(digitsOnly(v, 6))}
            keyboardType="number-pad"
            placeholder="411004"
            error={errors.pincode}
          />
        </View>
      </View>
      <TextField
        label="Receiver name *"
        value={receiverName}
        onChangeText={setReceiverName}
        placeholder="Who will receive the order?"
        error={errors.receiver_name}
      />
      <TextField
        label="Receiver phone *"
        prefix="+91"
        value={receiverPhone}
        onChangeText={(v) => setReceiverPhone(digitsOnly(v, 10))}
        keyboardType="phone-pad"
        placeholder="98765 43210"
        error={errors.receiver_phone}
      />

      <Pressable style={styles.defaultRow} onPress={() => setIsDefault((d) => !d)}>
        <View style={styles.flex}>
          <Text style={styles.defaultTitle}>Set as default address</Text>
          <Text style={styles.defaultHint}>Used automatically at checkout</Text>
        </View>
        <Switch
          value={isDefault}
          onValueChange={setIsDefault}
          trackColor={{ true: Colors.primary, false: Colors.border }}
          thumbColor={Colors.white}
        />
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', gap: Spacing.sm },
  footer: { gap: Spacing.sm },
  saveError: { fontSize: 13, color: Colors.danger, fontWeight: '600', textAlign: 'center' },
  labelPill: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.md },
  flex: { flex: 1 },
  readonly: { color: Colors.textMuted },
  defaultRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  defaultTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  defaultHint: { fontSize: 12, color: Colors.textMuted },
});
