/**
 * Edit sheets for the admin "Manage menu" screen. Each sheet is remounted (key) per item, so
 * its fields start from that item. `onSave` throws on failure; the message shows in the sheet.
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Button, Pill, TextField } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import type { CategoryInput, ProductInput } from '@/services/api';
import type { AdminProduct, Category } from '@/types';

/** "90" / "90.5" / "₹1,200" -> paise, or null if it isn't a price from ₹1 to ₹5,000. */
export function parseRupees(text: string): number | null {
  const clean = text.replace(/[₹,\s]/g, '');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(clean)) return null;
  const paise = Math.round(Number(clean) * 100);
  return paise >= 100 && paise <= 500000 ? paise : null;
}

const rupeesText = (paise: number) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <View style={styles.flex}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.toggleHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: Colors.primary, false: Colors.border }}
        thumbColor={Colors.white}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Dish
// ---------------------------------------------------------------------------
export function ProductEditSheet({
  target,
  categories,
  onClose,
  onSave,
}: {
  /** undefined = closed; { product: null, categoryId } = new dish; { product } = edit */
  target: { product: AdminProduct | null; categoryId?: string } | undefined;
  categories: Category[];
  onClose: () => void;
  onSave: (input: ProductInput, id: string | null) => Promise<void>;
}) {
  const p = target?.product ?? null;
  const [name, setName] = useState(p?.name ?? '');
  const [nameMr, setNameMr] = useState(p?.name_mr ?? '');
  const [description, setDescription] = useState(p?.description ?? '');
  const [price, setPrice] = useState(p ? rupeesText(p.price) : '');
  const [categoryId, setCategoryId] = useState(p?.category_id ?? target?.categoryId ?? categories[0]?.id ?? '');
  const [isVeg, setIsVeg] = useState(p?.is_veg ?? true);
  const [hasSpice, setHasSpice] = useState(p?.has_spice_level ?? false);
  const [inStock, setInStock] = useState(p?.is_available ?? true);
  const [visible, setVisible] = useState(p?.is_active ?? true);
  const [errors, setErrors] = useState<{ name?: string; price?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const paise = parseRupees(price);
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter the dish name.';
    if (paise === null) next.price = 'Enter a price from ₹1 to ₹5,000, e.g. 90 or 90.50.';
    if (!categoryId) next.form = 'Pick a category.';
    setErrors(next);
    if (Object.keys(next).length > 0 || paise === null) return;
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          name_mr: nameMr.trim(),
          description: description.trim(),
          price: paise,
          category_id: categoryId,
          is_veg: isVeg,
          has_spice_level: hasSpice,
          is_available: inStock,
          is_active: visible,
        },
        p?.id ?? null,
      );
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : 'Could not save. Please try again.' });
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={target !== undefined}
      onClose={onClose}
      title={p ? 'Edit dish' : 'New dish'}
      subtitle={p ? p.name : 'New dishes use the category photo for now.'}
      footer={
        <>
          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          <Button title={p ? 'Save changes' : 'Add dish'} onPress={save} loading={saving} />
        </>
      }>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Misal Pav" maxLength={60} error={errors.name} />
      <TextField label="Marathi name (optional)" value={nameMr} onChangeText={setNameMr} placeholder="मिसळ पाव" maxLength={60} />
      <TextField
        label="Price (₹)"
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="90"
        prefix="₹"
        error={errors.price}
      />
      <TextField
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="Spicy kat with farsan, onion, lemon and two pav"
        multiline
        maxLength={300}
      />
      <Text style={styles.label}>Category</Text>
      <View style={styles.chips}>
        {categories.map((c) => (
          <Pill key={c.id} label={c.name} selected={c.id === categoryId} onPress={() => setCategoryId(c.id)} />
        ))}
      </View>
      <ToggleRow label="Vegetarian" value={isVeg} onChange={setIsVeg} />
      <ToggleRow label="Spice levels" hint="Customers pick mild / medium / teekha" value={hasSpice} onChange={setHasSpice} />
      <ToggleRow label="In stock" hint="Off = shown as sold out, can't be ordered" value={inStock} onChange={setInStock} />
      <ToggleRow label="Visible on the menu" hint="Off = hidden from customers" value={visible} onChange={setVisible} />
    </BottomSheet>
  );
}

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------
export function CategoryEditSheet({
  target,
  onClose,
  onSave,
}: {
  /** undefined = closed; null = new category */
  target: Category | null | undefined;
  onClose: () => void;
  onSave: (input: CategoryInput, id: string | null) => Promise<void>;
}) {
  const c = target ?? null;
  const [name, setName] = useState(c?.name ?? '');
  const [nameMr, setNameMr] = useState(c?.name_mr ?? '');
  const [order, setOrder] = useState(c ? String(c.sort_order) : '');
  const [visible, setVisible] = useState(c?.is_active ?? true);
  const [errors, setErrors] = useState<{ name?: string; order?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Enter the category name.';
    const sort = order.trim() === '' ? undefined : Number(order);
    if (sort !== undefined && (!Number.isInteger(sort) || sort < 0 || sort > 999)) {
      next.order = 'A whole number from 0 to 999 (lower shows first).';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          name_mr: nameMr.trim(),
          is_active: visible,
          ...(sort !== undefined ? { sort_order: sort } : {}),
        },
        c?.id ?? null,
      );
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : 'Could not save. Please try again.' });
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      visible={target !== undefined}
      onClose={onClose}
      title={c ? 'Edit category' : 'New category'}
      footer={
        <>
          {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
          <Button title={c ? 'Save changes' : 'Add category'} onPress={save} loading={saving} />
        </>
      }>
      <TextField label="Name" value={name} onChangeText={setName} placeholder="Misal" maxLength={40} error={errors.name} />
      <TextField label="Marathi name (optional)" value={nameMr} onChangeText={setNameMr} placeholder="मिसळ" maxLength={40} />
      <TextField
        label="Position (optional)"
        value={order}
        onChangeText={setOrder}
        keyboardType="number-pad"
        placeholder={c ? undefined : 'Last'}
        error={errors.order}
      />
      <ToggleRow label="Visible on the menu" hint="Off = the whole category is hidden" value={visible} onChange={setVisible} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontSize: 13, fontWeight: '700', color: Colors.textMuted, marginBottom: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: Colors.text },
  toggleHint: { fontSize: 12, color: Colors.textMuted },
  formError: { fontSize: 13, color: Colors.danger, fontWeight: '600', marginBottom: Spacing.sm },
});
