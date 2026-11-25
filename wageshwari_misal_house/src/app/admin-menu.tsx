/**
 * Manage menu (admins only): every category and dish, hidden ones included
 * (GET /admin/categories + /admin/products). Quick "in stock" switch per dish; tap a dish or
 * category to edit it. After each change the customer menu is reloaded too.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { CategoryEditSheet, ProductEditSheet } from '@/components/MenuEditSheets';
import { Button, Card, EmptyState, Tag, VegBadge } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { adminApi, errorMessage, type CategoryInput, type ProductInput } from '@/services/api';
import { withAuth } from '@/services/session';
import type { AdminProduct, Category } from '@/types';
import { formatCurrency } from '@/utils/format';

export default function AdminMenuScreen() {
  const { isAdmin, reloadCatalog } = useApp();
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [productTarget, setProductTarget] = useState<{ product: AdminProduct | null; categoryId?: string }>();
  const [categoryTarget, setCategoryTarget] = useState<Category | null | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const [cats, prods] = await withAuth((t) => Promise.all([adminApi.categories(t), adminApi.products(t)]));
      setCategories(cats);
      setProducts(prods);
      setStatus('ready');
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  // Load whenever the screen is opened.
  useFocusEffect(
    useCallback(() => {
      if (isAdmin) load();
    }, [isAdmin, load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  /** After any change: re-read the admin lists and refresh the customer menu in this app. */
  const afterChange = async () => {
    await load();
    reloadCatalog();
  };

  const toggleStock = async (p: AdminProduct, inStock: boolean) => {
    setTogglingId(p.id);
    setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, is_available: inStock } : x)));
    try {
      await withAuth((t) => adminApi.updateProduct(t, p.id, { is_available: inStock }));
      reloadCatalog();
    } catch (e) {
      setProducts((list) => list.map((x) => (x.id === p.id ? { ...x, is_available: p.is_available } : x)));
      Alert.alert("Couldn't update the dish", errorMessage(e));
    } finally {
      setTogglingId(null);
    }
  };

  const saveProduct = async (input: ProductInput, id: string | null) => {
    try {
      if (id) await withAuth((t) => adminApi.updateProduct(t, id, input));
      else await withAuth((t) => adminApi.createProduct(t, input));
    } catch (e) {
      throw new Error(errorMessage(e));
    }
    setProductTarget(undefined);
    await afterChange();
  };

  const saveCategory = async (input: CategoryInput, id: string | null) => {
    try {
      if (id) await withAuth((t) => adminApi.updateCategory(t, id, input));
      else await withAuth((t) => adminApi.createCategory(t, input));
    } catch (e) {
      throw new Error(errorMessage(e));
    }
    setCategoryTarget(undefined);
    await afterChange();
  };

  const knownCategories = new Set(categories.map((c) => c.id));
  const orphans = products.filter((p) => !knownCategories.has(p.category_id));
  // One card per category, plus "Without a category" if a dish points at a missing one.
  const sections: { id: string; category: Category | null; dishes: AdminProduct[] }[] = [
    ...categories.map((c) => ({ id: c.id, category: c, dishes: products.filter((p) => p.category_id === c.id) })),
    ...(orphans.length > 0 ? [{ id: '__other', category: null, dishes: orphans }] : []),
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} accessibilityLabel="Back" style={styles.back}>
          <Icon name="chevronLeft" size={22} color={Colors.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title}>Manage menu</Text>
          <Text style={styles.subtitle}>Changes reach customers within a minute.</Text>
        </View>
      </View>

      {!isAdmin ? (
        <EmptyState emoji="🔒" title="Kitchen staff only" message="This screen is for the hotel's admin accounts." />
      ) : status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <Text style={styles.muted}>{error}</Text>
          <Button title="Retry" variant="outline" onPress={() => load()} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          {error ? <Text style={styles.staleNote}>Couldn&apos;t refresh: {error}</Text> : null}
          {sections.map(({ category, id, dishes }) => {
              return (
                <Card key={id} style={styles.section}>
                  <Pressable
                    style={styles.catRow}
                    onPress={() => category && setCategoryTarget(category)}
                    disabled={!category}
                    accessibilityLabel={category ? `Edit category ${category.name}` : undefined}>
                    <View style={styles.flex}>
                      <Text style={styles.catName}>
                        {category ? category.name : 'Without a category'}
                        {category?.name_mr ? <Text style={styles.catMr}>  {category.name_mr}</Text> : null}
                      </Text>
                      <Text style={styles.muted}>
                        {dishes.length} dish{dishes.length === 1 ? '' : 'es'}
                        {category ? ` · position ${category.sort_order}` : ''}
                      </Text>
                    </View>
                    {category && !category.is_active ? (
                      <Tag label="Hidden" color={Colors.textMuted} bg={Colors.surfaceMuted} />
                    ) : null}
                    {category ? <Icon name="edit" size={18} color={Colors.primary} /> : null}
                  </Pressable>

                  {dishes.map((p) => (
                    <View key={p.id} style={styles.dishRow}>
                      <Pressable
                        style={styles.dishInfo}
                        onPress={() => setProductTarget({ product: p })}
                        accessibilityLabel={`Edit ${p.name}`}>
                        <View style={styles.dishNameRow}>
                          <VegBadge isVeg={p.is_veg} size={12} />
                          <Text style={[styles.dishName, !p.is_active && styles.dimmed]} numberOfLines={1}>
                            {p.name}
                          </Text>
                        </View>
                        <View style={styles.dishTags}>
                          <Text style={styles.price}>{formatCurrency(p.price)}</Text>
                          {!p.is_active ? <Tag label="Hidden" color={Colors.textMuted} bg={Colors.surfaceMuted} /> : null}
                          {!p.is_available ? <Tag label="Sold out" color={Colors.danger} bg={Colors.dangerSoft} /> : null}
                          {p.has_spice_level ? <Tag label="Spice" icon="flame" color={Colors.spice} bg={Colors.spiceSoft} /> : null}
                        </View>
                      </Pressable>
                      <View style={styles.stock}>
                        <Switch
                          value={p.is_available}
                          onValueChange={(v) => toggleStock(p, v)}
                          disabled={togglingId === p.id}
                          trackColor={{ true: Colors.success, false: Colors.border }}
                          thumbColor={Colors.white}
                          accessibilityLabel={`${p.name} in stock`}
                        />
                        <Text style={styles.stockLabel}>{p.is_available ? 'In stock' : 'Sold out'}</Text>
                      </View>
                    </View>
                  ))}

                  {category ? (
                    <Pressable
                      style={styles.addRow}
                      onPress={() => setProductTarget({ product: null, categoryId: category.id })}>
                      <Icon name="plus" size={16} color={Colors.primary} />
                      <Text style={styles.addText}>Add a dish to {category.name}</Text>
                    </Pressable>
                  ) : null}
                </Card>
              );
            })}
          <Button title="Add a category" icon="plus" variant="outline" onPress={() => setCategoryTarget(null)} />
        </ScrollView>
      )}

      <ProductEditSheet
        key={productTarget ? (productTarget.product?.id ?? `new-${productTarget.categoryId}`) : 'closed'}
        target={productTarget}
        categories={categories}
        onClose={() => setProductTarget(undefined)}
        onSave={saveProduct}
      />
      <CategoryEditSheet
        key={categoryTarget === undefined ? 'closed' : (categoryTarget?.id ?? 'new')}
        target={categoryTarget}
        onClose={() => setCategoryTarget(undefined)}
        onSave={saveCategory}
      />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
  muted: { fontSize: 12, color: Colors.textMuted, textAlign: 'left' },
  staleNote: { fontSize: 12, color: Colors.warning, fontWeight: '600' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { paddingVertical: Spacing.sm },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  catName: { fontSize: 17, fontWeight: '800', color: Colors.text },
  catMr: { fontSize: 14, fontWeight: '600', color: Colors.textMuted },
  dishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  dishInfo: { flex: 1, gap: 4 },
  dishNameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  dishName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  dimmed: { color: Colors.textSubtle },
  dishTags: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.sm },
  price: { fontSize: 14, fontWeight: '800', color: Colors.text },
  stock: { alignItems: 'center', minWidth: 64 },
  stockLabel: { fontSize: 11, color: Colors.textMuted },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
  },
  addText: { color: Colors.primary, fontWeight: '700', fontSize: 14 },
});
