import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AddressFormModal } from '@/components/AddressFormModal';
import { Icon } from '@/components/Icon';
import { ShopMap } from '@/components/maps/ShopMap';
import { Button, Card, SectionTitle, Tag, TextLink } from '@/components/ui';
import { SHOP } from '@/constants/shop';
import { Colors, Fonts, InputStyles, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import type { Address } from '@/types';
import { formatAddress, formatPhone, isValidIndianMobile } from '@/utils/format';
import { formatKm } from '@/utils/geo';
import { mapsAvailable, openShopDirections } from '@/utils/maps';

export default function ProfileScreen() {
  const {
    currentUser,
    addresses,
    addressesStatus,
    addressesError,
    reloadAddresses,
    orders,
    updateUser,
    saveAddress,
    deleteAddress,
    setDefaultAddress,
    logout,
  } = useApp();
  /** Address id with a delete / set-default request in flight. */
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);

  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // `undefined` = sheet closed, `null` = adding new, Address = editing
  const [addressTarget, setAddressTarget] = useState<Address | null | undefined>(undefined);

  if (!currentUser) return null;

  const initials = currentUser.name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const startPhoneEdit = () => {
    setPhoneDraft(currentUser.phone);
    setPhoneError(null);
    setEditingPhone(true);
  };

  const savePhone = async () => {
    if (!isValidIndianMobile(phoneDraft)) {
      setPhoneError('Enter a valid 10-digit mobile number starting with 6–9');
      return;
    }
    if (savingPhone) return;
    setSavingPhone(true);
    try {
      await updateUser({ phone: phoneDraft }); // PATCH /me
      setEditingPhone(false);
    } catch (e) {
      setPhoneError(errorMessage(e));
    } finally {
      setSavingPhone(false);
    }
  };

  const runAddressAction = async (id: string, action: () => Promise<void>) => {
    setBusyAddressId(id);
    try {
      await action();
    } catch (e) {
      Alert.alert("Couldn't update the address", errorMessage(e));
    } finally {
      setBusyAddressId(null);
    }
  };

  const confirmDelete = (a: Address) =>
    Alert.alert('Delete this address?', `${a.label}: ${a.line1}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => runAddressAction(a.id, () => deleteAddress(a.id)) },
    ]);

  const signOut = async () => {
    setSigningOut(true);
    await logout(); // clears the session locally; revokes the refresh token server-side
  };

  const sortedAddresses = [...addresses].sort((a, b) => Number(b.is_default) - Number(a.is_default));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Profile</Text>

        {/* User card */}
        <Card style={styles.userCard}>
          <View style={styles.userRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.name}>{currentUser.name}</Text>
              <View style={styles.inline}>
                <Icon name="mail" size={14} color={Colors.textMuted} />
                <Text style={styles.email}>{currentUser.email}</Text>
              </View>
              <Text style={styles.ordersCount}>
                {orders.length} order{orders.length === 1 ? '' : 's'} · Member since 2024
              </Text>
            </View>
          </View>

          {/* Phone — primary identifier */}
          <View style={styles.phoneBox}>
            <View style={styles.phoneHead}>
              <View style={styles.inline}>
                <Icon name="phone" size={14} color={Colors.primary} />
                <Text style={styles.phoneLabel}>Primary mobile number</Text>
              </View>
              {!editingPhone ? <TextLink title="Edit" onPress={startPhoneEdit} /> : null}
            </View>

            {editingPhone ? (
              <>
                <View style={[styles.phoneInputWrap, InputStyles.focused, phoneError ? InputStyles.error : null]}>
                  <Text style={styles.phonePrefix}>+91</Text>
                  <TextInput
                    value={phoneDraft}
                    onChangeText={(v) => {
                      setPhoneDraft(v.replace(/\D/g, '').slice(0, 10));
                      setPhoneError(null);
                    }}
                    keyboardType="phone-pad"
                    autoFocus
                    style={styles.phoneInput}
                    placeholder="98765 43210"
                    placeholderTextColor={Colors.textSubtle}
                    onSubmitEditing={savePhone}
                  />
                </View>
                {phoneError ? <Text style={styles.error}>{phoneError}</Text> : null}
                <View style={styles.phoneActions}>
                  <Button title="Cancel" variant="ghost" onPress={() => setEditingPhone(false)} style={styles.flex} />
                  <Button title="Save" onPress={savePhone} loading={savingPhone} style={styles.flex} />
                </View>
              </>
            ) : (
              <Text style={styles.phoneValue}>{formatPhone(currentUser.phone)}</Text>
            )}
            <Text style={styles.phoneHint}>Used for delivery updates from our rider.</Text>
          </View>
        </Card>

        {/* Addresses */}
        <View>
          <SectionTitle
            title="Saved addresses"
            action={<TextLink title="+ Add new" onPress={() => setAddressTarget(null)} />}
          />
          <View style={styles.addressList}>
            {sortedAddresses.length === 0 ? (
              <Card>
                {addressesStatus === 'loading' || addressesStatus === 'idle' ? (
                  <Text style={styles.muted}>Loading your addresses…</Text>
                ) : addressesStatus === 'error' ? (
                  <View style={styles.inline}>
                    <Text style={[styles.muted, styles.flex]}>{addressesError}</Text>
                    <TextLink title="Retry" onPress={reloadAddresses} />
                  </View>
                ) : (
                  <Text style={styles.muted}>
                    No saved addresses. Add one to speed up checkout (up to 5, within 3 km of the hotel).
                  </Text>
                )}
              </Card>
            ) : null}
            {sortedAddresses.map((a) => (
              <Card key={a.id} style={[styles.addressCard, a.is_default && styles.addressCardDefault]}>
                <View style={styles.addressHead}>
                  <View style={styles.inline}>
                    <Icon name={a.label === 'Work' ? 'bag' : a.label === 'Home' ? 'home' : 'location'} size={16} color={Colors.primary} />
                    <Text style={styles.addressLabel}>{a.label}</Text>
                    {a.is_default ? <Tag label="DEFAULT" /> : null}
                  </View>
                  <Pressable onPress={() => setAddressTarget(a)} hitSlop={8} accessibilityLabel={`Edit ${a.label} address`}>
                    <Icon name="edit" size={18} color={Colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={styles.addressReceiver}>
                  {a.receiver_name} · {formatPhone(a.receiver_phone)}
                </Text>
                <Text style={styles.addressText}>{formatAddress(a)}</Text>
                <Text style={styles.addressDistance}>{formatKm(a.distance_km)} from the hotel</Text>
                <View style={[styles.addressActions, busyAddressId === a.id && styles.busy]}>
                  {!a.is_default ? (
                    <TextLink
                      title="Set as default"
                      onPress={() => busyAddressId || runAddressAction(a.id, () => setDefaultAddress(a.id))}
                    />
                  ) : null}
                  <Pressable
                    onPress={() => busyAddressId || confirmDelete(a)}
                    hitSlop={8}
                    style={styles.inline}
                    accessibilityLabel={`Delete ${a.label} address`}>
                    <Icon name="trash" size={14} color={Colors.danger} />
                    <Text style={styles.deleteText}>Remove</Text>
                  </Pressable>
                </View>
              </Card>
            ))}
          </View>
        </View>

        {/* The hotel */}
        <View>
          <SectionTitle title="Visit us" />
          <Card style={styles.shopCardCol}>
            {mapsAvailable() ? <ShopMap /> : null}
            <View style={styles.shopCard}>
              <Icon name="location" size={22} color={Colors.primary} />
              <View style={styles.flex}>
                <Text style={styles.shopName}>{SHOP.name}</Text>
                <Text style={styles.shopLine}>
                  {SHOP.line1}, {SHOP.line2}
                </Text>
                <Text style={styles.shopLine}>
                  {SHOP.city} {SHOP.pincode} · Open {SHOP.hours}
                </Text>
                <Text style={styles.shopLine}>We deliver within {SHOP.deliveryRadiusKm} km of the hotel.</Text>
              </View>
            </View>
            <Button title="Directions" icon="directions" variant="outline" onPress={openShopDirections} />
          </Card>
        </View>

        <Button
          title="Sign Out"
          icon="logout"
          variant="danger"
          onPress={signOut}
          loading={signingOut}
          style={styles.signOut}
        />
        <Text style={styles.version}>Wagheshwar Misal House · v1.0.0 (prototype)</Text>
      </ScrollView>

      <AddressFormModal
        key={addressTarget === undefined ? 'closed' : (addressTarget?.id ?? 'new')}
        visible={addressTarget !== undefined}
        initial={addressTarget ?? null}
        defaults={{ receiver_name: currentUser.name, receiver_phone: currentUser.phone }}
        onClose={() => setAddressTarget(undefined)}
        onSave={async (input) => {
          await saveAddress(input); // throws -> the form shows the error and stays open
          setAddressTarget(undefined);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  scroll: { padding: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxl * 2 },
  title: { fontFamily: Fonts.extrabold, fontSize: 26, lineHeight: 34, color: Colors.text },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  muted: { color: Colors.textMuted, fontSize: 14 },

  userCard: { gap: Spacing.lg },
  userRow: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'center' },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: Colors.white, fontSize: 24, fontWeight: '900' },
  name: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: Colors.text },
  email: { fontSize: 14, color: Colors.textMuted },
  ordersCount: { fontSize: 12, color: Colors.textSubtle, marginTop: 4 },

  phoneBox: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1.5,
    borderColor: Colors.primaryBorder,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  phoneHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  phoneLabel: { fontSize: 12, fontWeight: '800', color: Colors.primaryDark, letterSpacing: 0.3 },
  phoneValue: { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: 0.5 },
  phoneHint: { fontSize: 12, color: Colors.textMuted },
  phoneInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    paddingHorizontal: Spacing.md,
  },
  phonePrefix: { fontSize: 17, fontWeight: '700', color: Colors.text },
  phoneInput: { flex: 1, minHeight: 50, fontFamily: Fonts.semibold, fontSize: 17, color: Colors.text, backgroundColor: 'transparent', ...InputStyles.reset },
  phoneActions: { flexDirection: 'row', gap: Spacing.sm },
  error: { fontSize: 12, color: Colors.danger },

  addressList: { gap: Spacing.md },
  addressCard: { gap: 6, borderWidth: 1.5, borderColor: 'transparent' },
  addressCardDefault: { borderColor: Colors.primaryBorder },
  addressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  addressLabel: { fontSize: 15, fontWeight: '800', color: Colors.text },
  addressReceiver: { fontSize: 13, fontWeight: '600', color: Colors.text },
  addressText: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  addressActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.xl, marginTop: Spacing.xs },
  deleteText: { color: Colors.danger, fontWeight: '700', fontSize: 14 },

  signOut: { marginTop: Spacing.sm },
  version: { textAlign: 'center', fontSize: 12, color: Colors.textSubtle },
  shopCard: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  shopCardCol: { gap: Spacing.md },
  addressDistance: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textSubtle },
  busy: { opacity: 0.4 },
  shopName: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.text },
  shopLine: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: Colors.textMuted },
});
