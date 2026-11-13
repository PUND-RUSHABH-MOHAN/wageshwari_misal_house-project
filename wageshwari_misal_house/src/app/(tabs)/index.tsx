import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddressPickerModal } from '@/components/AddressPickerModal';
import { Icon } from '@/components/Icon';
import { ProductCard } from '@/components/ProductCard';
import { ProductDetailSheet } from '@/components/ProductDetailSheet';
import { SpiceLevelSheet } from '@/components/SpiceLevelSheet';
import { Colors, Fonts, InputStyles, Radius, Shadow, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { CATEGORY_IMAGES, LOGO } from '@/data/mock-data';
import type { Category, ID, Product } from '@/types';
import { formatCurrency } from '@/utils/format';
import { isKitchenOpen, KITCHEN_OPEN_HOUR } from '@/utils/pricing';

const ALL = 'all';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { categories, products, cart, cartCount, bill, selectedAddress, addToCart } = useApp();
  const { width: screenWidth } = useWindowDimensions();
  const columns = screenWidth >= 1000 ? 4 : screenWidth >= 700 ? 3 : 2;
  const cardWidth = Math.floor((screenWidth - Spacing.lg * 2 - GRID_GAP * (columns - 1)) / columns);

  const [activeCategory, setActiveCategory] = useState<ID>(ALL);
  const [query, setQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [spiceProduct, setSpiceProduct] = useState<Product | null>(null);
  const [spiceQty, setSpiceQty] = useState(1);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);

  const open = isKitchenOpen();
  const activeCategoryIds = new Set(categories.map((c) => c.id));
  const q = query.trim().toLowerCase();

  const visibleProducts = products
    .filter((p) => activeCategoryIds.has(p.category_id))
    .filter((p) => activeCategory === ALL || p.category_id === activeCategory)
    .filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.name_mr.includes(query.trim()) ||
        p.description.toLowerCase().includes(q),
    )
    .sort((a, b) => Number(b.is_available) - Number(a.is_available));

  const selectedCategory = categories.find((c) => c.id === activeCategory);
  const listTitle = q
    ? 'Search results'
    : selectedCategory
      ? `${selectedCategory.name} dishes`
      : 'All dishes';

  const addressLine = selectedAddress
    ? [selectedAddress.line1, selectedAddress.line2, `Pune ${selectedAddress.pincode}`].filter(Boolean).join(', ')
    : 'Tap to add a delivery address';

  const header = (
    <View>
      {/* Maroon hero: address, logo, search */}
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change delivery address"
            onPress={() => setAddressOpen(true)}
            style={({ pressed }) => [styles.addressBtn, pressed && { opacity: 0.8 }]}>
            <Icon name="location" size={30} color={Colors.accent} />
            <View style={styles.flex}>
              <View style={styles.addressTitleRow}>
                <Text style={styles.addressTitle}>{selectedAddress?.label ?? 'Add address'}</Text>
                <Icon name="chevronDown" size={20} color={Colors.white} />
              </View>
              <Text style={styles.addressLine} numberOfLines={1}>
                {addressLine}
              </Text>
            </View>
          </Pressable>

          <View>
            <Image source={LOGO} style={styles.logo} contentFit="contain" accessibilityLabel="Wagheshwar Misal House" />
            <View style={[styles.openPill, !open && styles.closedPill]}>
              <Text style={[styles.openText, !open && styles.closedText]}>{open ? 'OPEN' : 'CLOSED'}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.search, searchFocused && styles.searchFocused]}>
          <Icon name="search" size={24} color={Colors.primary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search misal, vada pav, chaha..."
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            returnKeyType="search"
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            autoCorrect={false}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Icon name="close" size={18} color={Colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Categories */}
      <Text style={styles.sectionTitle}>Categories</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.categories}>
        <CategoryBubble
          label="All"
          image={LOGO}
          selected={activeCategory === ALL}
          onPress={() => setActiveCategory(ALL)}
          isLogo
        />
        {categories.map((c: Category) => (
          <CategoryBubble
            key={c.id}
            label={c.name}
            image={CATEGORY_IMAGES[c.id] ?? { uri: c.image_url }}
            selected={activeCategory === c.id}
            onPress={() => setActiveCategory((cur) => (cur === c.id ? ALL : c.id))}
          />
        ))}
      </ScrollView>

      {!open ? (
        <View style={styles.closedNote}>
          <Icon name="info" size={16} color={Colors.warning} />
          <Text style={styles.closedNoteText}>
            Kitchen opens at {KITCHEN_OPEN_HOUR} AM — you can pre-order for the next slot.
          </Text>
        </View>
      ) : null}

      <View style={styles.listHead}>
        <Text style={styles.sectionTitleInline}>{listTitle}</Text>
        <Text style={styles.count}>
          {visibleProducts.length} item{visibleProducts.length === 1 ? '' : 's'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {isFocused ? <StatusBar style="light" /> : null}
      {/* Keeps the notch / status-bar area maroon while the page scrolls */}
      <View style={[styles.statusFill, { height: insets.top }]} />

      <FlatList
        // numColumns can't change on the fly, so remount when the column count changes
        key={`grid-${columns}`}
        numColumns={columns}
        columnWrapperStyle={styles.gridRow}
        data={visibleProducts}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        contentContainerStyle={[styles.list, cartCount > 0 && styles.listWithBar]}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.noResults}>
            <Text style={styles.noResultsEmoji}>🔍</Text>
            <Text style={styles.noResultsText}>No dishes found{q ? ` for “${query.trim()}”` : ''}.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            width={cardWidth}
            quantityInCart={cart.filter((c) => c.product_id === item.id).reduce((n, c) => n + c.quantity, 0)}
            onOpen={() => setDetailProduct(item)}
            onAdd={(quantity) => {
              if (item.has_spice_level) {
                setSpiceQty(quantity);
                setSpiceProduct(item);
              } else {
                addToCart(item, { quantity });
              }
            }}
          />
        )}
      />

      {cartCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/cart')}
          style={({ pressed }) => [styles.cartBar, pressed && { opacity: 0.92 }]}>
          <View>
            <Text style={styles.cartBarCount}>
              {cartCount} item{cartCount > 1 ? 's' : ''} added
            </Text>
            <Text style={styles.cartBarTotal}>{formatCurrency(bill.subtotal)} + taxes</Text>
          </View>
          <View style={styles.cartBarCta}>
            <Text style={styles.cartBarCtaText}>View Cart</Text>
            <Icon name="chevronRight" size={20} color={Colors.accent} />
          </View>
        </Pressable>
      ) : null}

      <SpiceLevelSheet
        key={spiceProduct ? `${spiceProduct.id}-${spiceQty}` : 'none'}
        product={spiceProduct}
        initialQuantity={spiceQty}
        visible={spiceProduct !== null}
        onClose={() => setSpiceProduct(null)}
        onConfirm={({ spice_level, note, quantity }) => {
          if (spiceProduct) addToCart(spiceProduct, { spice_level, note, quantity });
          setSpiceProduct(null);
        }}
      />
      <ProductDetailSheet
        key={detailProduct ? `detail-${detailProduct.id}` : 'detail-none'}
        product={detailProduct}
        visible={detailProduct !== null}
        quantityInCart={
          detailProduct
            ? cart.filter((c) => c.product_id === detailProduct.id).reduce((n, c) => n + c.quantity, 0)
            : 0
        }
        onClose={() => setDetailProduct(null)}
        onAdd={({ spice_level, note, quantity }) => {
          if (detailProduct) addToCart(detailProduct, { spice_level, note, quantity });
          setDetailProduct(null);
        }}
      />
      <AddressPickerModal visible={addressOpen} onClose={() => setAddressOpen(false)} />
    </View>
  );
}

function CategoryBubble({
  label,
  image,
  selected,
  onPress,
  isLogo,
}: {
  label: string;
  image: React.ComponentProps<typeof Image>['source'];
  selected: boolean;
  onPress: () => void;
  isLogo?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} category`}
      onPress={onPress}
      style={({ pressed }) => [styles.bubble, pressed && { opacity: 0.85 }]}>
      <View style={[styles.bubbleRing, selected && styles.bubbleRingActive]}>
        <Image
          source={image}
          style={[styles.bubbleImg, isLogo && styles.bubbleLogo]}
          contentFit={isLogo ? 'contain' : 'cover'}
        />
      </View>
      <Text style={[styles.bubbleLabel, selected && styles.bubbleLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const BUBBLE = 84;
const GRID_GAP = Spacing.md;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  statusFill: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: Colors.primary, zIndex: 2 },
  list: { paddingBottom: Spacing.xxl },
  listWithBar: { paddingBottom: 120 },
  separator: { height: GRID_GAP },
  gridRow: { paddingHorizontal: Spacing.lg, gap: GRID_GAP },

  hero: {
    backgroundColor: Colors.primary,
    borderBottomLeftRadius: 36,
    borderBottomRightRadius: 36,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl + 4,
    gap: Spacing.lg,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  addressBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  addressTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addressTitle: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 28, color: Colors.white },
  addressLine: { fontFamily: Fonts.medium, fontSize: 15, lineHeight: 20, color: '#F6DCDA' },
  logo: { width: 72, height: 72 },
  openPill: {
    position: 'absolute',
    bottom: -6,
    alignSelf: 'center',
    backgroundColor: Colors.success,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    borderWidth: 1.5,
    borderColor: Colors.white,
  },
  closedPill: { backgroundColor: Colors.danger },
  openText: { fontFamily: Fonts.bold, fontSize: 9, lineHeight: 14, color: Colors.white, letterSpacing: 0.6 },
  closedText: { color: Colors.white },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    height: 58,
    borderWidth: 2,
    borderColor: 'transparent',
    ...Shadow.card,
  },
  // On the maroon header a yellow ring reads better than the maroon one used elsewhere
  searchFocused: { borderColor: Colors.accent, boxShadow: '0px 0px 0px 4px rgba(255, 194, 26, 0.35)' },
  searchInput: {
    flex: 1,
    height: '100%',
    fontFamily: Fonts.medium,
    fontSize: 17,
    color: Colors.text,
    backgroundColor: 'transparent',
    ...InputStyles.reset,
  },

  sectionTitle: {
    fontFamily: Fonts.bold,
    fontSize: 24,
    lineHeight: 32,
    color: Colors.text,
    marginTop: Spacing.xxl,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  categories: { paddingHorizontal: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.sm },
  bubble: { alignItems: 'center', width: BUBBLE + 8, gap: 6 },
  bubbleRing: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    padding: 3,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  bubbleRingActive: { borderColor: Colors.primary, borderWidth: 3 },
  bubbleImg: { flex: 1, borderRadius: BUBBLE / 2 },
  bubbleLogo: { borderRadius: 0 },
  bubbleLabel: { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 20, color: Colors.text },
  bubbleLabelActive: { fontFamily: Fonts.bold, color: Colors.primary },

  closedNote: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'center',
    backgroundColor: Colors.warningSoft,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  closedNoteText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: Colors.warning },

  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },
  sectionTitleInline: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 32, color: Colors.text },
  count: { fontFamily: Fonts.medium, fontSize: 15, color: Colors.textMuted },

  noResults: { alignItems: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  noResultsEmoji: { fontSize: 40 },
  noResultsText: { fontFamily: Fonts.medium, fontSize: 15, color: Colors.textMuted, textAlign: 'center' },

  cartBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Shadow.raised,
  },
  cartBarCount: { fontFamily: Fonts.bold, color: Colors.white, fontSize: 15, lineHeight: 20 },
  cartBarTotal: { fontFamily: Fonts.medium, color: '#F6DCDA', fontSize: 13 },
  cartBarCta: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  cartBarCtaText: { fontFamily: Fonts.bold, color: Colors.accent, fontSize: 17 },
});
