/**
 * Pay a UPI order (part 7): direct UPI to the hotel, no payment gateway.
 * 1. "Pay with UPI app" opens GPay / PhonePe / Paytm with the hotel's UPI ID, the exact amount and the
 *    order number filled in (upi:// link from the server). Or scan the QR from another phone.
 * 2. The customer types the 12-digit UTR from their UPI app -> POST /orders/:id/payment.
 * 3. The kitchen checks its UPI app and confirms; this screen follows the order via the
 *    Orders polling in AppContext (every 20 s while an order is active).
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { Button, Card, TextField } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import { formatCurrency } from '@/utils/format';

const ORDERS_HREF = '/orders' as const;

/** mm:ss until `iso`, or null when it has passed. */
function timeLeft(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function PayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { orders, reloadOrders, submitPayment } = useApp();
  const order = orders.find((o) => o.id === id);

  const [utr, setUtr] = useState('');
  const [utrError, setUtrError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Fresh status when the screen opens (e.g. coming back from the UPI app).
  useFocusEffect(
    useCallback(() => {
      reloadOrders();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Countdown tick while waiting for payment.
  const waiting = order?.status === 'PENDING_PAYMENT' && order.payment_status === 'pending';
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waiting]);

  const openUpiApp = async () => {
    if (!order?.upi_payment) return;
    try {
      await Linking.openURL(order.upi_payment.uri);
    } catch {
      Alert.alert(
        'No UPI app found',
        'Install GPay, PhonePe, Paytm or your bank’s UPI app, or scan the QR code from another phone.',
      );
    }
  };

  const sendUtr = async () => {
    const clean = utr.replace(/\s/g, '');
    if (!/^\d{12}$/.test(clean)) {
      setUtrError('The UTR is the 12-digit number in your UPI app’s payment details.');
      return;
    }
    if (!order) return;
    setSending(true);
    setUtrError(null);
    try {
      await submitPayment(order.id, clean);
      setEditing(false);
      setUtr('');
    } catch (e) {
      setUtrError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.navigate(ORDERS_HREF)} hitSlop={10} accessibilityLabel="Back" style={styles.back}>
        <Icon name="chevronLeft" size={22} color={Colors.text} />
      </Pressable>
      <View style={styles.flex}>
        <Text style={styles.title}>Pay by UPI</Text>
        {order ? <Text style={styles.subtitle}>{order.order_number}</Text> : null}
      </View>
    </View>
  );

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const left = timeLeft(order.payment_expires_at, now);
  const pay = order.upi_payment;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      {header}
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {order.status === 'CANCELLED' ? (
          <Card style={styles.gap}>
            <Text style={styles.bigTitle}>Order cancelled</Text>
            <Text style={styles.body}>{order.cancel_reason ?? 'This order was cancelled.'}</Text>
            <Text style={styles.body}>Please don’t pay for this order.</Text>
            <Button title="Back to orders" onPress={() => router.navigate(ORDERS_HREF)} />
          </Card>
        ) : order.payment_status === 'paid' ? (
          <Card style={styles.gap}>
            <View style={styles.okRow}>
              <Icon name="checkCircle" size={28} color={Colors.success} />
              <Text style={styles.bigTitle}>Payment received</Text>
            </View>
            <Text style={styles.body}>
              Thank you! {formatCurrency(order.total)} reached the hotel and your order is confirmed.
            </Text>
            <Button title="Track my order" onPress={() => router.navigate(ORDERS_HREF)} />
          </Card>
        ) : (
          <>
            {/* Step 1: pay */}
            {pay && order.payment_status === 'pending' ? (
              <Card style={styles.gap}>
                <Text style={styles.step}>1 · Pay</Text>
                <Text style={styles.amount}>{formatCurrency(order.total)}</Text>
                <Text style={styles.body}>
                  to <Text style={styles.strong}>{pay.payee_name}</Text>
                </Text>
                <Text selectable style={styles.upiId}>
                  {pay.upi_id}
                </Text>
                {left ? (
                  <Text style={styles.timer}>Pay within {left}, or the order is cancelled.</Text>
                ) : (
                  <Text style={styles.timer}>Time to pay is up. Enter your UTR if you already paid.</Text>
                )}
                <Button title={`Pay ₹${pay.amount} with UPI app`} icon="upi" onPress={openUpiApp} />
                <View style={styles.qrBox}>
                  <QRCode value={pay.uri} size={190} />
                  <Text style={styles.hint}>Paying from another phone? Scan this QR with any UPI app.</Text>
                </View>
              </Card>
            ) : null}

            {/* Step 2: tell us the UTR */}
            {order.payment_status === 'submitted' && !editing ? (
              <Card style={styles.gap}>
                <View style={styles.okRow}>
                  <Icon name="clock" size={24} color={Colors.warning} />
                  <Text style={styles.bigTitle}>Checking your payment</Text>
                </View>
                <Text style={styles.body}>
                  The hotel is matching UTR <Text style={styles.strong}>{order.utr}</Text> with its UPI app. Your
                  order is confirmed as soon as they see it; this screen updates by itself.
                </Text>
                <Button title="Wrong UTR? Change it" variant="ghost" onPress={() => setEditing(true)} />
                <Button title="Go to my orders" variant="outline" onPress={() => router.navigate(ORDERS_HREF)} />
              </Card>
            ) : (
              <Card style={styles.gap}>
                <Text style={styles.step}>2 · After paying, enter the UTR</Text>
                <Text style={styles.hint}>
                  Open the payment in your UPI app and copy the 12-digit UTR / UPI Ref. No.
                </Text>
                <TextField
                  label="UTR / UPI reference number"
                  value={utr}
                  onChangeText={(v) => {
                    setUtr(v.replace(/[^\d\s]/g, '').slice(0, 14));
                    setUtrError(null);
                  }}
                  keyboardType="number-pad"
                  placeholder="e.g. 412345678901"
                  maxLength={14}
                  error={utrError ?? undefined}
                />
                <Button title="I’ve paid" onPress={sendUtr} loading={sending} />
                {editing ? <Button title="Keep the old UTR" variant="ghost" onPress={() => setEditing(false)} /> : null}
              </Card>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.extrabold, fontSize: 24, lineHeight: 32, color: Colors.text },
  subtitle: { fontSize: 12, color: Colors.textMuted },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  gap: { gap: Spacing.md },
  step: { fontSize: 13, fontWeight: '800', color: Colors.primaryDark, textTransform: 'uppercase', letterSpacing: 0.5 },
  amount: { fontSize: 34, fontWeight: '800', color: Colors.text },
  body: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  strong: { fontWeight: '800' },
  upiId: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.primary,
    backgroundColor: Colors.primarySoft,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  timer: { fontSize: 12, color: Colors.warning, fontWeight: '700' },
  qrBox: {
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.lg,
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  hint: { fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
  bigTitle: { fontSize: 18, fontWeight: '800', color: Colors.text },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
});
