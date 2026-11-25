import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AddressFormModal } from '@/components/AddressFormModal';
import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { Button, Tag } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { formatAddress } from '@/utils/format';
import { formatKm } from '@/utils/geo';

/** Choose the delivery address for checkout, or add a new one inline. */
export function AddressPickerModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { addresses, selectedAddress, selectAddress, saveAddress, currentUser } = useApp();
  const [formOpen, setFormOpen] = useState(false);

  return (
    <>
      <BottomSheet
        visible={visible && !formOpen}
        onClose={onClose}
        title="Deliver to"
        subtitle="Choose a saved address"
        footer={
          <Button
            title="Add new address"
            icon="plus"
            variant="outline"
            onPress={() => setFormOpen(true)}
          />
        }>
        {addresses.length === 0 ? (
          <Text style={styles.empty}>No saved addresses yet. Add one to continue.</Text>
        ) : null}
        {addresses.map((a) => {
          const selected = a.id === selectedAddress?.id;
          return (
            <Pressable
              key={a.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                selectAddress(a.id);
                onClose();
              }}
              style={[styles.item, selected && styles.itemSelected]}>
              <Icon
                name={selected ? 'radioOn' : 'radioOff'}
                size={22}
                color={selected ? Colors.primary : Colors.textSubtle}
              />
              <View style={styles.itemText}>
                <View style={styles.titleRow}>
                  <Text style={styles.label}>{a.label}</Text>
                  {a.is_default ? <Tag label="DEFAULT" /> : null}
                </View>
                <Text style={styles.receiver}>
                  {a.receiver_name} · {a.receiver_phone}
                </Text>
                <Text style={styles.addr}>{formatAddress(a)}</Text>
                <Text style={styles.distance}>{formatKm(a.distance_km)} from the hotel</Text>
              </View>
            </Pressable>
          );
        })}
      </BottomSheet>

      <AddressFormModal
        key={formOpen ? 'open' : 'closed'}
        visible={visible && formOpen}
        defaults={{ receiver_name: currentUser?.name, receiver_phone: currentUser?.phone }}
        onClose={() => setFormOpen(false)}
        onSave={async (input) => {
          await saveAddress(input); // throws -> the form shows the error and stays open
          setFormOpen(false);
          onClose();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  empty: { color: Colors.textMuted, fontSize: 14 },
  item: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  itemSelected: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  itemText: { flex: 1, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { fontSize: 15, fontWeight: '800', color: Colors.text },
  receiver: { fontSize: 13, fontWeight: '600', color: Colors.text },
  addr: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  distance: { fontSize: 12, color: Colors.textSubtle },
});
