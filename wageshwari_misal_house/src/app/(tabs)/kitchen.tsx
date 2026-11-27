/**
 * Kitchen board (admins only; the tab is hidden for customers and the server answers 403).
 * GET /admin/orders for today or tomorrow, grouped by delivery slot; one tap moves an order
 * to its next step (POST /admin/orders/:id/status). Re-checks every 20 s while open.
 * The "Online orders" switch at the top stops / restarts new orders (PATCH /admin/store).
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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

import { KitchenCancelSheet } from '@/components/KitchenCancelSheet';
import { isKitchenDone, KitchenOrderCard } from '@/components/KitchenOrderCard';
import { StopOrdersSheet } from '@/components/StopOrdersSheet';
import { Button, EmptyState, Pill } from '@/components/ui';
import { HOME_HREF } from '@/constants/routes';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { adminApi, errorMessage } from '@/services/api';
import { withAuth } from '@/services/session';
import type { AdminOrder, OrderStatus } from '@/types';
import { formatCurrency, formatDeliveryDate } from '@/utils/format';
import { istDate } from '@/utils/pricing';

const POLL_MS = 20000;

type Day = 'today' | 'tomorrow';

export default function KitchenScreen() {
  const { isAdmin, store, storeOpen, reloadStore, setAcceptingOrders } = useApp();
  const [stopOpen, setStopOpen] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [day, setDay] = useState<Day>('today');
  const date = istDate(new Date(), day === 'today' ? 0 : 1);

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AdminOrder | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** Ignores answers for a day the user has already switched away from. */
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const list = await withAuth((t) => adminApi.orders(t, date));
      if (request !== latest.current) return;
      setOrders(list);
      setStatus('ready');
      setError(null);
    } catch (e) {
      if (request !== latest.current) return;
      setError(errorMessage(e));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error')); // keep a board already on screen
    }
  }, [date]);

  // Load when the tab opens / the day changes, then every 20 s while it's open and the app is active.
  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) return;
      load();
      reloadStore();
      const timer = setInterval(() => {
        if (AppState.currentState === 'active') load();
      }, POLL_MS);
      return () => clearInterval(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin, load]),
  );

  const onToggleStore = (next: boolean) => {
    if (!next) {
      setStopOpen(true); // asks for an optional message first
      return;
    }
    Alert.alert('Start taking online orders?', 'Customers can place orders again straight away.', [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Start orders',
        onPress: async () => {
          setReopening(true);
          try {
            await setAcceptingOrders(true);
          } catch (e) {
            Alert.alert("Couldn't re-open orders", errorMessage(e));
          } finally {
            setReopening(false);
          }
        },
      },
    ]);
  };

  const stopOrders = async (message: string) => {
    try {
      await setAcceptingOrders(false, message);
      setStopOpen(false);
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  };

  const switchDay = (next: Day) => {
    if (next === day) return;
    setDay(next);
    setOrders([]);
    setStatus('loading');
    setError(null);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const replace = (updated: AdminOrder) =>
    setOrders((list) => list.map((o) => (o.id === updated.id ? updated : o)));

  const moveTo = async (order: AdminOrder, next: OrderStatus) => {
    setBusyId(order.id);
    try {
      replace(await withAuth((t) => adminApi.setStatus(t, order.id, next)));
    } catch (e) {
      Alert.alert("Couldn't update the order", errorMessage(e));
      load(); // someone else may have changed it: show the real state
    } finally {
      setBusyId(null);
    }
  };

  const onNext = (order: AdminOrder, next: OrderStatus) => {
    if (next === 'CONFIRMED') {
      // UPI: only after the money is visible in the hotel's UPI app.
      Alert.alert(
        `Received ${formatCurrency(order.total)}?`,
        `Check your UPI app for this amount${order.utr ? ` and UTR ${order.utr}` : ''} (note “Order ${order.order_number}”).`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Yes, received', onPress: () => moveTo(order, next) },
        ],
      );
      return;
    }
    if (next !== 'DELIVERED') {
      moveTo(order, next);
      return;
    }
    Alert.alert('Mark as delivered?', `${order.order_number} · ${order.address_snapshot.receiver_name}`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Delivered', onPress: () => moveTo(order, next) },
    ]);
  };

  const cancelWithReason = async (reason: string) => {
    if (!cancelTarget) return;
    try {
      replace(await withAuth((t) => adminApi.setStatus(t, cancelTarget.id, 'CANCELLED', reason)));
      setCancelTarget(null);
    } catch (e) {
      load();
      throw new Error(errorMessage(e));
    }
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <EmptyState
          emoji="🔒"
          title="Kitchen staff only"
          message="This screen is for the hotel's admin accounts."
          actionLabel="Go to menu"
          onAction={() => router.navigate(HOME_HREF)}
        />
      </SafeAreaView>
    );
  }

  const active = orders.filter((o) => !isKitchenDone(o.status));
  const done = orders.filter((o) => isKitchenDone(o.status));
  // Server order is slot, then time placed; keep it and group consecutive orders by slot.
  const slots: { label: string; orders: AdminOrder[] }[] = [];
  for (const o of active) {
    const last = slots[slots.length - 1];
    if (last && last.label === o.slot_label) last.orders.push(o);
    else slots.push({ label: o.slot_label, orders: [o] });
  }
  const count = (s: OrderStatus[]) => orders.filter((o) => s.includes(o.status)).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Kitchen</Text>
        <Text style={styles.subtitle}>{formatDeliveryDate(date)}</Text>
        <View style={[styles.storeRow, !storeOpen && styles.storeRowClosed]}>
          <View style={styles.flex}>
            <Text style={[styles.storeTitle, !storeOpen && styles.storeTitleClosed]}>
              {storeOpen ? 'Taking online orders' : 'Online orders stopped'}
            </Text>
            <Text style={styles.storeHint} numberOfLines={2}>
              {storeOpen ? 'Turn off when the hotel is closed.' : store?.message || 'Turn on to re-open.'}
            </Text>
          </View>
          {reopening ? (
            <ActivityIndicator color={Colors.primary} />
          ) : (
            <Switch
              value={storeOpen}
              onValueChange={onToggleStore}
              trackColor={{ true: Colors.success, false: Colors.danger }}
              accessibilityLabel="Taking online orders"
            />
          )}
        </View>
        <View style={styles.dayRow}>
          <Pill label="Today" selected={day === 'today'} onPress={() => switchDay('today')} style={styles.flex} />
          <Pill
            label="Tomorrow"
            selected={day === 'tomorrow'}
            onPress={() => switchDay('tomorrow')}
            style={styles.flex}
          />
        </View>
        {orders.length > 0 ? (
          <View style={styles.counts}>
            <Count label="To check" value={count(['PENDING_PAYMENT'])} color={Colors.warning} />
            <Count label="New" value={count(['CONFIRMED'])} color={Colors.info} />
            <Count label="Cooking" value={count(['PREPARING'])} color={Colors.primary} />
            <Count label="On the way" value={count(['OUT_FOR_DELIVERY'])} color="#6A1B9A" />
            <Count label="Delivered" value={count(['DELIVERED'])} color={Colors.success} />
          </View>
        ) : null}
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
        ) : orders.length === 0 ? (
          <Text style={[styles.muted, styles.empty]}>No orders for this day yet. Pull down to refresh.</Text>
        ) : (
          <>
            {error ? <Text style={styles.staleNote}>Couldn&apos;t refresh: {error}</Text> : null}
            {slots.length === 0 ? <Text style={[styles.muted, styles.empty]}>All done for this day. 🎉</Text> : null}
            {slots.map((slot) => (
              <View key={slot.label} style={styles.slot}>
                <Text style={styles.slotTitle}>
                  {slot.label} · {slot.orders.length}
                </Text>
                {slot.orders.map((o) => (
                  <KitchenOrderCard
                    key={o.id}
                    order={o}
                    busy={busyId === o.id}
                    onNext={(next) => onNext(o, next)}
                    onCancel={() => setCancelTarget(o)}
                  />
                ))}
              </View>
            ))}
            {done.length > 0 ? (
              <View style={styles.slot}>
                <Pressable onPress={() => setShowDone((v) => !v)} style={styles.doneToggle} hitSlop={6}>
                  <Text style={styles.slotTitle}>
                    Delivered & cancelled · {done.length}
                  </Text>
                  <Text style={styles.link}>{showDone ? 'Hide' : 'Show'}</Text>
                </Pressable>
                {showDone
                  ? done.map((o) => (
                      <KitchenOrderCard key={o.id} order={o} busy={false} onNext={() => {}} onCancel={() => {}} />
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      <StopOrdersSheet
        key={stopOpen ? 'stop-open' : 'stop-closed'}
        visible={stopOpen}
        onClose={() => setStopOpen(false)}
        onConfirm={stopOrders}
      />
      <KitchenCancelSheet
        key={cancelTarget?.id ?? 'none'}
        order={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={cancelWithReason}
      />
    </SafeAreaView>
  );
}

function Count({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.count}>
      <Text style={[styles.countValue, { color }]}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm, gap: Spacing.sm },
  title: { fontFamily: Fonts.extrabold, fontSize: 26, lineHeight: 34, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textMuted, marginTop: -Spacing.sm },
  dayRow: { flexDirection: 'row', gap: Spacing.sm },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.successSoft,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  storeRowClosed: { backgroundColor: Colors.dangerSoft },
  storeTitle: { fontSize: 14, fontWeight: '800', color: Colors.success },
  storeTitleClosed: { color: Colors.danger },
  storeHint: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  counts: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
  },
  count: { flex: 1, alignItems: 'center' },
  countValue: { fontSize: 20, fontWeight: '800' },
  countLabel: { fontSize: 11, color: Colors.textMuted },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.xl, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingTop: Spacing.xxl },
  muted: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  empty: { paddingTop: Spacing.xxl },
  staleNote: { fontSize: 12, color: Colors.warning, fontWeight: '600' },
  slot: { gap: Spacing.md },
  slotTitle: { fontSize: 15, fontWeight: '800', color: Colors.primaryDark },
  doneToggle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: Colors.primary, fontWeight: '700' },
});
