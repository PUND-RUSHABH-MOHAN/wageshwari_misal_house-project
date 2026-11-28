import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { OrderCard } from '@/components/OrderCard';
import { Button, EmptyState } from '@/components/ui';
import { HOME_HREF } from '@/constants/routes';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { isTerminalStatus, useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import type { ID, Order } from '@/types';
import { formatCurrency } from '@/utils/format';
import { hasLiveEstimate } from '@/utils/eta';
import { istClockTime } from '@/utils/pricing';

export default function OrdersScreen() {
  const { orders, ordersStatus, ordersError, reloadOrders, lastPlacedOrderId, dismissOrderBanner, cancelOrder } =
    useApp();
  const [expandedId, setExpandedId] = useState<ID | null>(null);
  const [prevPlacedId, setPrevPlacedId] = useState<ID | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancellingId, setCancellingId] = useState<ID | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    await reloadOrders();
    setRefreshing(false);
  };

  // Part 7d: cancel until the order is out for delivery. The server decides; a "Picked up" that
  // lands first wins and the answer explains why it can't be cancelled any more.
  const confirmCancel = (order: Order) => {
    const paidUpi = order.payment_method === 'online' && (order.payment_status !== 'pending' || Boolean(order.utr));
    Alert.alert(
      'Are you sure you want to cancel this order?',
      `${order.order_number} · ${formatCurrency(order.total)}${
        paidUpi ? '\n\nYour UPI payment will be refunded by the hotel.' : ''
      }`,
      [
        { text: 'Keep Order', style: 'cancel' },
        {
          text: 'Cancel Order',
          style: 'destructive',
          onPress: async () => {
            setCancellingId(order.id);
            try {
              const cancelled = await cancelOrder(order.id); // POST /orders/:id/cancel
              Alert.alert(
                'Order cancelled',
                cancelled.refund_status === 'pending'
                  ? `${cancelled.order_number} has been cancelled. The hotel will refund your UPI payment to the same account, usually the same day.`
                  : `${cancelled.order_number} has been cancelled.`,
              );
            } catch (e) {
              Alert.alert("Couldn't cancel", errorMessage(e));
            } finally {
              setCancellingId(null);
            }
          },
        },
      ],
    );
  };

  const firstLoad = orders.length === 0 && (ordersStatus === 'loading' || ordersStatus === 'idle');
  const loadFailed = orders.length === 0 && ordersStatus === 'error';

  // Auto-expand a freshly placed order (state derived during render, no effect needed).
  if (lastPlacedOrderId !== prevPlacedId) {
    setPrevPlacedId(lastPlacedOrderId);
    if (lastPlacedOrderId) setExpandedId(lastPlacedOrderId);
  }

  const placed = orders.find((o) => o.id === lastPlacedOrderId);
  const activeCount = orders.filter((o) => !isTerminalStatus(o.status)).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>My Orders</Text>
        <Text style={styles.subtitle}>
          {firstLoad
            ? 'Loading…'
            : orders.length === 0
            ? 'No orders yet'
            : `${orders.length} order${orders.length > 1 ? 's' : ''}${activeCount ? ` · ${activeCount} in progress` : ''}`}
        </Text>
      </View>

      {placed ? (
        <View style={styles.banner}>
          <Icon name="checkCircle" size={26} color={Colors.white} />
          <View style={styles.flex}>
            <Text style={styles.bannerTitle}>Order placed successfully! 🎉</Text>
            <Text style={styles.bannerText}>
              {placed.order_number} · {formatCurrency(placed.total)} ·{' '}
              {placed.payment_method === 'cod' ? 'Cash on Delivery' : 'UPI'}
            </Text>
            {hasLiveEstimate(placed) ? (
              <Text style={styles.bannerEta}>
                Estimated delivery {istClockTime(placed.estimated_delivery_at!)} (estimate)
              </Text>
            ) : null}
          </View>
          <Pressable onPress={dismissOrderBanner} hitSlop={10} accessibilityLabel="Dismiss">
            <Icon name="close" size={18} color={Colors.white} />
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={[styles.list, orders.length === 0 && styles.flexGrow]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          firstLoad ? (
            <View style={styles.center}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : loadFailed ? (
            <View style={styles.center}>
              <Text style={styles.errorText}>{ordersError}</Text>
              <Button title="Retry" variant="outline" onPress={() => reloadOrders()} />
            </View>
          ) : (
            <EmptyState
              emoji="🧾"
              title="No orders yet"
              message="Your misal journey starts here. Place your first order and track it live."
              actionLabel="Browse Menu"
              onAction={() => router.navigate(HOME_HREF)}
            />
          )
        }
        renderItem={({ item }) => (
          <OrderCard
            order={item}
            expanded={expandedId === item.id}
            onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
            onCancel={() => confirmCancel(item)}
            cancelling={cancellingId === item.id}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  flexGrow: { flexGrow: 1 },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  title: { fontFamily: Fonts.extrabold, fontSize: 26, lineHeight: 34, color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textMuted },
  banner: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.success,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    ...Shadow.raised,
  },
  bannerTitle: { color: Colors.white, fontSize: 15, fontWeight: '800' },
  bannerText: { color: '#E8F5E9', fontSize: 12, marginTop: 2 },
  bannerEta: { color: Colors.white, fontSize: 13, fontWeight: '800', marginTop: 4 },
  list: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  separator: { height: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  errorText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
});
