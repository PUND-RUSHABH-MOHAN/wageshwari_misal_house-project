/**
 * Kitchen (admins): pick a delivery boy for a confirmed order, or move it to someone else.
 * GET /admin/delivery-boys when it opens; POST /admin/orders/:id/assign on tap.
 * Off-duty delivery boys can still be picked (the admin may know they're around).
 * "Off duty" takes someone out of auto-assign (e.g. before removing them from the `delivery`
 * group); only the delivery boy can switch himself back on.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from '@/components/BottomSheet';
import { Icon } from '@/components/Icon';
import { Button } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { adminApi, errorMessage } from '@/services/api';
import { withAuth } from '@/services/session';
import type { AdminOrder, DeliveryBoy } from '@/types';
import { formatPhone } from '@/utils/format';

export function AssignSheet({
  order,
  onClose,
  onAssigned,
}: {
  /** The order to assign; null = closed. */
  order: AdminOrder | null;
  onClose: () => void;
  onAssigned: (updated: AdminOrder) => void;
}) {
  const [boys, setBoys] = useState<DeliveryBoy[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    let live = true;
    withAuth((t) => adminApi.deliveryBoys(t))
      .then((list) => live && setBoys(list))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [order]);

  const pick = async (boy: DeliveryBoy) => {
    if (!order || savingId) return;
    setSavingId(boy.id);
    setError(null);
    try {
      onAssigned(await withAuth((t) => adminApi.assign(t, order.id, boy.id)));
    } catch (e) {
      setError(errorMessage(e));
      setSavingId(null);
    }
  };

  const takeOffDuty = (boy: DeliveryBoy) =>
    Alert.alert(`Take ${boy.name} off duty?`, 'New orders won’t be assigned to him automatically.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Off duty',
        style: 'destructive',
        onPress: async () => {
          try {
            const updated = await withAuth((t) => adminApi.takeOffDuty(t, boy.id));
            setBoys((list) => (list ?? []).map((b) => (b.id === updated.id ? updated : b)));
          } catch (e) {
            setError(errorMessage(e));
          }
        },
      },
    ]);

  const current = order?.delivery_boy?.id;

  return (
    <BottomSheet
      visible={order !== null}
      onClose={onClose}
      title={current ? 'Reassign delivery' : 'Assign a delivery boy'}
      subtitle={order ? `${order.order_number} · ${order.slot_label}` : undefined}
      footer={<Button title="Close" variant="ghost" onPress={onClose} />}>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {boys === null && !error ? (
        <ActivityIndicator color={Colors.primary} style={styles.loading} />
      ) : boys && boys.length === 0 ? (
        <Text style={styles.empty}>
          No delivery boys yet. Add the person to the “delivery” group in Cognito, then ask them to log in again
          and open the Deliveries tab once.
        </Text>
      ) : (
        <View style={styles.list}>
          {(boys ?? []).map((boy) => {
            const mine = boy.id === current;
            return (
              <Pressable
                key={boy.id}
                onPress={() => pick(boy)}
                disabled={mine || savingId !== null}
                style={({ pressed }) => [styles.row, mine && styles.rowMine, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Assign to ${boy.name}`}>
                <Icon name="delivery" size={22} color={boy.on_duty ? Colors.success : Colors.textSubtle} />
                <View style={styles.flex}>
                  <Text style={styles.name}>
                    {boy.name}
                    {mine ? '  (assigned now)' : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {boy.on_duty ? 'On duty' : 'Off duty'} · {boy.active_orders} active
                    {boy.phone ? ` · ${formatPhone(boy.phone)}` : ''}
                  </Text>
                </View>
                {savingId === boy.id ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : boy.on_duty ? (
                  <Pressable onPress={() => takeOffDuty(boy)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.offDuty}>Off duty</Text>
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { marginVertical: Spacing.xl },
  list: { gap: Spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  rowMine: { borderColor: Colors.primary, backgroundColor: Colors.primarySoft },
  pressed: { opacity: 0.8 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.text },
  meta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  empty: { fontSize: 14, color: Colors.textMuted, lineHeight: 20 },
  error: { fontSize: 13, color: Colors.danger, marginBottom: Spacing.md },
  offDuty: { fontSize: 12, fontWeight: '800', color: Colors.danger },
});
