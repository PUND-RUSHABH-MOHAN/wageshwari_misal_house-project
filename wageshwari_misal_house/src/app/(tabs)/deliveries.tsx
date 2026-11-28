/**
 * Deliveries tab (part 7c): for accounts in the Cognito `delivery` group only (the tab is hidden
 * for everyone else and the server answers 403).
 * - On duty switch (GET/PATCH /delivery/me). Only on-duty delivery boys get orders automatically;
 *   it switches itself off at midnight.
 * - My orders (GET /delivery/orders): customer, phone, full address + map, items, cash to collect.
 *   Re-checks every 20 s while open, so newly assigned orders appear by themselves.
 * - "Picked up" -> "Delivered" (POST /delivery/orders/:id/status).
 * The server sends the customer's phone and address only while the delivery is active.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { StatusBadge } from '@/components/OrderCard';
import { Button, EmptyState, Tag } from '@/components/ui';
import { HOME_HREF } from '@/constants/routes';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { deliveryApi, errorMessage, isApiError } from '@/services/api';
import { withAuth } from '@/services/session';
import type { DeliveryBoy, DeliveryOrder } from '@/types';
import { formatCurrency, formatDeliveryDate, formatPhone, SPICE_LABELS } from '@/utils/format';
import { callPhone, openMapAt } from '@/utils/maps';
import { istClockTime, istDate } from '@/utils/pricing';

const POLL_MS = 20000;
const ACCOUNT_HREF = '/profile' as const;

const isActive = (o: DeliveryOrder) => o.status === 'ASSIGNED' || o.status === 'OUT_FOR_DELIVERY';

export default function DeliveriesScreen() {
  const { isDeliveryBoy } = useApp();
  const [me, setMe] = useState<DeliveryBoy | null>(null);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [boy, list] = await Promise.all([
        withAuth((t) => deliveryApi.me(t)),
        withAuth((t) => deliveryApi.orders(t)),
      ]);
      setMe(boy);
      setOrders(list);
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!isDeliveryBoy) return;
      load();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [isDeliveryBoy, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggleDuty = async (next: boolean) => {
    setSwitching(true);
    try {
      setMe(await withAuth((t) => deliveryApi.setOnDuty(t, next)));
    } catch (e) {
      if (isApiError(e) && e.code === 'PHONE_REQUIRED') {
        Alert.alert('Add your mobile number', e.message, [
          { text: 'Later', style: 'cancel' },
          { text: 'Open Account', onPress: () => router.navigate(ACCOUNT_HREF) },
        ]);
      } else {
        Alert.alert("Couldn't change your duty status", errorMessage(e));
      }
    } finally {
      setSwitching(false);
    }
  };

  const move = async (order: DeliveryOrder, next: 'OUT_FOR_DELIVERY' | 'DELIVERED') => {
    setBusyId(order.id);
    try {
      const updated = await withAuth((t) => deliveryApi.setStatus(t, order.id, next));
      setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e) {
      Alert.alert("Couldn't update the order", errorMessage(e));
      load();
    } finally {
      setBusyId(null);
    }
  };

  const onNext = (order: DeliveryOrder) => {
    if (order.status === 'ASSIGNED') {
      Alert.alert('Picked up from the kitchen?', `${order.order_number} · ${order.customer?.name ?? ''}`, [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Picked up', onPress: () => move(order, 'OUT_FOR_DELIVERY') },
      ]);
      return;
    }
    const cash = order.collect_cash ?? 0;
    Alert.alert(
      'Delivered?',
      cash > 0 ? `Collect ${formatCurrency(cash)} cash before you confirm.` : 'Already paid by UPI.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: cash > 0 ? 'Delivered, cash collected' : 'Delivered', onPress: () => move(order, 'DELIVERED') },
      ],
    );
  };

  if (!isDeliveryBoy) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <EmptyState
          emoji="🔒"
          title="Delivery staff only"
          message="This screen is for the hotel's delivery accounts."
          actionLabel="Go to menu"
          onAction={() => router.navigate(HOME_HREF)}
        />
      </SafeAreaView>
    );
  }

  const active = orders.filter(isActive);
  const finished = orders.filter((o) => !isActive(o));
  const onDuty = me?.on_duty ?? false;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Deliveries</Text>
        <Text style={styles.subtitle}>{formatDeliveryDate(istDate(new Date(), 0))}</Text>
        <View style={[styles.dutyRow, onDuty ? styles.dutyOn : styles.dutyOff]}>
          <View style={styles.flex}>
            <Text style={[styles.dutyTitle, { color: onDuty ? Colors.success : Colors.textMuted }]}>
              {onDuty ? 'On duty' : 'Off duty'}
            </Text>
            <Text style={styles.dutyHint}>
              {onDuty
                ? 'New orders can be assigned to you. Switches off at midnight.'
                : 'Switch on to get orders automatically.'}
            </Text>
          </View>
          {switching || me === null ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Switch
              value={onDuty}
              onValueChange={toggleDuty}
              trackColor={{ true: Colors.success, false: Colors.border }}
              accessibilityLabel="On duty"
            />
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {status === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : status === 'error' ? (
          <View style={styles.center}>
            <Text style={styles.muted}>{error}</Text>
            <Button title="Retry" variant="outline" onPress={() => load()} />
          </View>
        ) : (
          <>
            {error ? <Text style={styles.staleNote}>Couldn&apos;t refresh: {error}</Text> : null}
            <Text style={styles.section}>My deliveries · {active.length}</Text>
            {active.length === 0 ? (
              <Text style={[styles.muted, styles.empty]}>
                {onDuty ? 'Nothing to deliver right now. New orders show up here by themselves.' : 'No orders.'}
              </Text>
            ) : (
              active.map((o) => (
                <DeliveryCard key={o.id} order={o} busy={busyId === o.id} onNext={() => onNext(o)} />
              ))
            )}
            {finished.length > 0 ? (
              <>
                <Text style={styles.section}>Finished today · {finished.length}</Text>
                {finished.map((o) => (
                  <View key={o.id} style={styles.doneRow}>
                    <View style={styles.flex}>
                      <Text style={styles.doneNo}>{o.order_number}</Text>
                      <Text style={styles.muted}>
                        {o.area}
                        {o.delivered_at ? ` · ${istClockTime(o.delivered_at)}` : ''}
                        {o.cancel_reason ? ` · ${o.cancel_reason}` : ''}
                      </Text>
                    </View>
                    <StatusBadge status={o.status} />
                  </View>
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeliveryCard({ order, busy, onNext }: { order: DeliveryOrder; busy: boolean; onNext: () => void }) {
  const a = order.address;
  const c = order.customer;
  const cash = order.collect_cash ?? 0;
  const today = order.delivery_date === istDate(new Date(), 0);
  return (
    <View style={styles.card}>
      <View style={styles.headRow}>
        <View style={styles.flex}>
          <Text style={styles.orderNo}>{order.order_number}</Text>
          <Text style={styles.muted}>
            {today ? 'Today' : formatDeliveryDate(order.delivery_date)} · {order.slot_label}
          </Text>
        </View>
        <StatusBadge status={order.status} />
      </View>

      {c ? (
        <View style={styles.customer}>
          <View style={styles.flex}>
            <Text style={styles.customerName}>{c.name}</Text>
            <Text style={styles.muted}>{formatPhone(c.phone)}</Text>
          </View>
          <Pressable
            onPress={() => callPhone(c.phone)}
            hitSlop={6}
            accessibilityLabel={`Call ${c.name}`}
            style={styles.roundBtn}>
            <Icon name="phone" size={18} color={Colors.primary} />
          </Pressable>
        </View>
      ) : null}

      {a ? (
        <View style={styles.customer}>
          <View style={styles.flex}>
            {a.label ? <Text style={styles.addressLabel}>{a.label}</Text> : null}
            <Text style={styles.address}>
              {[a.line1, a.line2, a.landmark ? `Near ${a.landmark}` : null].filter(Boolean).join(', ')}
            </Text>
            <Text style={styles.muted}>
              {a.city}, {a.state} {a.pincode}
            </Text>
          </View>
          <Pressable
            onPress={() => openMapAt({ latitude: a.latitude, longitude: a.longitude })}
            hitSlop={6}
            accessibilityLabel="Open the delivery pin in Google Maps"
            style={styles.roundBtn}>
            <Icon name="directions" size={18} color={Colors.primary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.items}>
        {order.items.map((item, i) => (
          <View key={`${item.product_name}-${i}`} style={styles.itemRow}>
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

      <View style={[styles.payBox, cash > 0 ? styles.payCash : styles.payPaid]}>
        <Icon name={cash > 0 ? 'cash' : 'checkCircle'} size={18} color={cash > 0 ? Colors.warning : Colors.success} />
        <Text style={[styles.payText, { color: cash > 0 ? Colors.warning : Colors.success }]}>
          {cash > 0 ? `Collect ${formatCurrency(cash)} cash` : 'Paid by UPI · nothing to collect'}
        </Text>
      </View>

      <Button
        title={order.status === 'ASSIGNED' ? 'Picked up' : 'Delivered'}
        icon={order.status === 'ASSIGNED' ? 'bag' : 'checkCircle'}
        onPress={onNext}
        loading={busy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  title: { fontFamily: Fonts.extrabold, fontSize: 26, lineHeight: 34, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textMuted, marginTop: -Spacing.sm },
  dutyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  dutyOn: { backgroundColor: Colors.successSoft },
  dutyOff: { backgroundColor: Colors.surfaceMuted },
  dutyTitle: { fontSize: 15, fontWeight: '800' },
  dutyHint: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  center: { alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xxl },
  muted: { fontSize: 12, color: Colors.textMuted, marginTop: 2, lineHeight: 17 },
  empty: { textAlign: 'center', paddingVertical: Spacing.lg, fontSize: 14 },
  staleNote: { fontSize: 12, color: Colors.warning },
  section: { fontSize: 13, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.5, marginTop: Spacing.sm },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadow.card,
  },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  orderNo: { fontSize: 15, fontWeight: '800', color: Colors.text, letterSpacing: 0.3 },
  customer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  customerName: { fontSize: 16, fontWeight: '800', color: Colors.text },
  addressLabel: { fontSize: 11, fontWeight: '800', color: Colors.primary, letterSpacing: 0.5 },
  address: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  items: { gap: Spacing.sm, backgroundColor: Colors.surfaceMuted, borderRadius: Radius.md, padding: Spacing.md },
  itemRow: { flexDirection: 'row', gap: Spacing.sm },
  qty: { fontSize: 15, fontWeight: '800', color: Colors.primary, minWidth: 30 },
  itemName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  itemTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm, marginTop: 2 },
  note: { fontSize: 13, color: Colors.text, fontStyle: 'italic' },
  payBox: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.md, padding: Spacing.md },
  payCash: { backgroundColor: Colors.warningSoft },
  payPaid: { backgroundColor: Colors.successSoft },
  payText: { fontSize: 15, fontWeight: '800' },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  doneNo: { fontSize: 14, fontWeight: '700', color: Colors.text },
});
