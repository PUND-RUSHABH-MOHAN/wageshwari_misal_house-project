import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { OrderCard } from '@/components/OrderCard';
import { EmptyState, LoadState } from '@/components/ui';
import { HOME_HREF } from '@/constants/routes';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { isTerminalStatus, useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import type { ID } from '@/types';
import { formatCurrency } from '@/utils/format';

export default function OrdersScreen() {
  const { orders, lastPlacedOrderId, dismissOrderBanner, cancelOrder, ordersLoad, refreshOrders } = useApp();
  const [expandedId, setExpandedId] = useState<ID | null>(null);
  const [cancellingId, setCancellingId] = useState<ID | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshOrders();
    setRefreshing(false);
  };

  const onCancel = async (id: ID) => {
    if (cancellingId) return;
    setActionError(null);
    setCancellingId(id);
    try {
      await cancelOrder(id);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setCancellingId(null);
    }
  };

  const showLoadState = orders.length === 0 && ordersLoad.status !== 'ready';
  const [prevPlacedId, setPrevPlacedId] = useState<ID | null>(null);

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
          {ordersLoad.status === 'loading' && orders.length === 0
            ? 'Loading your orders…'
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
          </View>
          <Pressable onPress={dismissOrderBanner} hitSlop={10} accessibilityLabel="Dismiss">
            <Icon name="close" size={18} color={Colors.white} />
          </Pressable>
        </View>
      ) : null}

      {actionError ? (
        <Pressable style={styles.errorBox} onPress={() => setActionError(null)} accessibilityLabel="Dismiss error">
          <Icon name="info" size={16} color={Colors.danger} />
          <Text style={styles.errorText}>{actionError}</Text>
          <Icon name="close" size={14} color={Colors.danger} />
        </Pressable>
      ) : null}
      {ordersLoad.status === 'error' && orders.length > 0 ? (
        <Text style={styles.staleNote}>Couldn&apos;t refresh: {ordersLoad.error} Pull down to retry.</Text>
      ) : null}

      <FlatList
        data={orders}
        keyExtractor={(o) => o.id}
        contentContainerStyle={[styles.list, orders.length === 0 && styles.flexGrow]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} tintColor={Colors.primary} />
        }
        ListEmptyComponent={
          showLoadState ? (
            <LoadState
              loading={ordersLoad.status === 'loading' || ordersLoad.status === 'idle'}
              error={ordersLoad.error}
              onRetry={() => void refreshOrders()}
            />
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
            onCancel={() => void onCancel(item.id)}
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
  list: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  separator: { height: Spacing.md },
  errorBox: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.dangerSoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  errorText: { flex: 1, fontSize: 13, color: Colors.danger, fontWeight: '600' },
  staleNote: { marginHorizontal: Spacing.lg, fontSize: 12, color: Colors.warning },
});
