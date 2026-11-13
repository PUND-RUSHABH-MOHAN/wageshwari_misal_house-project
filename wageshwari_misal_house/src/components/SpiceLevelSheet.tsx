import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { Button, QuantityStepper } from '@/components/ui';
import { Colors, Fonts, InputStyles, Radius, Spacing } from '@/constants/theme';
import type { Product, SpiceLevel } from '@/types';
import { formatCurrency, SPICE_LABELS } from '@/utils/format';

const OPTIONS: { level: SpiceLevel; flames: number; hint: string }[] = [
  { level: 'mild', flames: 1, hint: 'Gentle heat, kid-friendly' },
  { level: 'medium', flames: 2, hint: 'Classic Puneri balance' },
  { level: 'teekha', flames: 3, hint: 'Extra kat — for the brave!' },
];

/**
 * Used both for "add to cart" (mode="add") and "edit cart line" (mode="edit").
 * Parent should pass a `key` so internal state resets per product / line.
 */
export function SpiceLevelSheet({
  product,
  visible,
  mode = 'add',
  initialSpice = 'medium',
  initialNote = '',
  initialQuantity = 1,
  onClose,
  onConfirm,
}: {
  product: Product | null;
  visible: boolean;
  mode?: 'add' | 'edit';
  initialSpice?: SpiceLevel;
  initialNote?: string;
  /** Starting quantity in add mode (e.g. the count picked on the product card). */
  initialQuantity?: number;
  onClose: () => void;
  onConfirm: (result: { spice_level?: SpiceLevel; note?: string; quantity: number }) => void;
}) {
  const [spice, setSpice] = useState<SpiceLevel>(initialSpice);
  const [note, setNote] = useState(initialNote);
  const [qty, setQty] = useState(initialQuantity);

  if (!product) return null;
  const showSpice = product.has_spice_level;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={product.name}
      subtitle={mode === 'add' ? 'Customise your plate' : 'Edit spice level & cooking note'}
      footer={
        <View style={styles.footerRow}>
          {mode === 'add' ? (
            <QuantityStepper
              quantity={qty}
              onIncrement={() => setQty((q) => Math.min(q + 1, 20))}
              onDecrement={() => setQty((q) => Math.max(q - 1, 1))}
            />
          ) : null}
          <Button
            style={styles.footerBtn}
            title={
              mode === 'add' ? `Add item · ${formatCurrency(product.price * qty)}` : 'Save changes'
            }
            onPress={() =>
              onConfirm({ spice_level: showSpice ? spice : undefined, note, quantity: qty })
            }
          />
        </View>
      }>
      {showSpice ? <SpiceOptions value={spice} onChange={setSpice} /> : null}
      <CookingNoteField value={note} onChange={setNote} />
    </BottomSheet>
  );
}

/** Radio list of spice levels — shared by this sheet and the product detail sheet. */
export function SpiceOptions({ value, onChange }: { value: SpiceLevel; onChange: (level: SpiceLevel) => void }) {
  return (
    <View style={styles.section} accessibilityRole="radiogroup">
      <Text style={styles.label}>Spice level</Text>
      {OPTIONS.map((opt) => {
        const selected = opt.level === value;
        return (
          <Pressable
            key={opt.level}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(opt.level)}
            style={[styles.option, selected && styles.optionSelected]}>
            <View style={styles.flames}>
              {Array.from({ length: 3 }, (_, i) => (
                <Icon key={i} name="flame" size={16} color={i < opt.flames ? Colors.spice : Colors.border} />
              ))}
            </View>
            <View style={styles.optionText}>
              <Text style={styles.optionTitle}>{SPICE_LABELS[opt.level]}</Text>
              <Text style={styles.optionHint}>{opt.hint}</Text>
            </View>
            <Icon
              name={selected ? 'radioOn' : 'radioOff'}
              size={22}
              color={selected ? Colors.primary : Colors.textSubtle}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/** Optional free-text cooking note (max 120 chars). */
export function CookingNoteField({ value, onChange }: { value: string; onChange: (note: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Cooking note (optional)</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="e.g. Less onion, extra lemon, pav separately"
        placeholderTextColor={Colors.textSubtle}
        maxLength={120}
        multiline
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[styles.noteInput, focused && InputStyles.focused]}
      />
      <Text style={styles.counter}>{value.length}/120</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.sm },
  label: { fontSize: 14, fontWeight: '800', color: Colors.text },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  flames: { flexDirection: 'row', width: 54 },
  optionText: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  optionHint: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  noteInput: {
    minHeight: 72,
    borderWidth: 1.5,
    borderRadius: Radius.md + 2,
    padding: Spacing.md,
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: Colors.text,
    ...InputStyles.idle,
    ...InputStyles.reset,
    textAlignVertical: 'top',
  },
  counter: { alignSelf: 'flex-end', fontSize: 11, color: Colors.textSubtle },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  footerBtn: { flex: 1 },
});
