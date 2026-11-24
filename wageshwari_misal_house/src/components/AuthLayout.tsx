/**
 * Shared frame for the signed-out screens (login, sign-up, confirm, forgot password):
 * blurred shop photo + maroon wash, logo hero, and the white form card.
 */
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { SHOP_TAGLINE } from '@/constants/shop';
import { Colors, Fonts, Radius, Spacing } from '@/constants/theme';
import { LOGIN_BG, LOGO } from '@/data/mock-data';

export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  compactHero = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Smaller logo, for the longer forms. */
  compactHero?: boolean;
}) {
  return (
    <View style={styles.root}>
      <Image source={LOGIN_BG} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={5} />
      <View style={styles.overlay} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <Image
                source={LOGO}
                style={compactHero ? styles.logoCompact : styles.logo}
                contentFit="contain"
                accessibilityLabel="Wagheshwar Misal House logo"
              />
              <Text style={styles.brand}>Wagheshwar Misal House</Text>
              {!compactHero ? (
                <Text style={styles.tagline}>Authentic Puneri & Kolhapuri Misal · Delivered hot</Text>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{title}</Text>
              {subtitle ? <Text style={styles.cardSub}>{subtitle}</Text> : null}
              {children}
            </View>

            {footer ?? <Text style={styles.footer}>{SHOP_TAGLINE}</Text>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/** Inline message box inside the card: red for errors, green for success/info. */
export function FormNotice({ tone, message }: { tone: 'error' | 'success'; message: string }) {
  const isError = tone === 'error';
  return (
    <View
      accessibilityRole="alert"
      style={[styles.notice, isError ? styles.noticeError : styles.noticeSuccess]}>
      <Icon name={isError ? 'info' : 'checkCircle'} size={16} color={isError ? Colors.danger : Colors.success} />
      <Text style={[styles.noticeText, { color: isError ? Colors.danger : Colors.success }]}>{message}</Text>
    </View>
  );
}

export const authStyles = StyleSheet.create({
  fields: { gap: Spacing.md },
  cta: { marginTop: Spacing.sm },
  hint: { fontFamily: Fonts.regular, fontSize: 12.5, color: Colors.textMuted },
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rowText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted },
  terms: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textSubtle, textAlign: 'center' },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.primaryDark, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(60, 6, 8, 0.48)' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: Spacing.xl, justifyContent: 'center', gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.lg },
  logo: { width: 148, height: 148 },
  logoCompact: { width: 96, height: 96 },
  brand: {
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    fontFamily: Fonts.extrabold,
    fontSize: 28,
    lineHeight: 36,
    color: Colors.white,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  tagline: { fontFamily: Fonts.medium, fontSize: 14, color: '#F6DCDA', textAlign: 'center', marginTop: -6 },
  card: {
    backgroundColor: Colors.background,
    borderRadius: Radius.xl + 4,
    padding: Spacing.xxl,
    gap: Spacing.md,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 220, 140, 0.55)',
    // Golden halo + dark drop shadow. CSS paints the FIRST shadow on top, so the halo is
    // listed before the dark shadow; a dark shadow alone disappears on the maroon photo.
    boxShadow: [
      '0px 0px 0px 6px rgba(255, 255, 255, 0.18)',
      '0px 0px 30px 10px rgba(255, 194, 26, 0.55)',
      '0px 30px 60px 0px rgba(0, 0, 0, 0.7)',
    ].join(', '),
  },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 24, lineHeight: 30, color: Colors.text },
  cardSub: { fontFamily: Fonts.regular, fontSize: 15, color: Colors.textMuted, marginTop: -8 },
  footer: { fontFamily: Fonts.medium, fontSize: 13, color: '#F6DCDA', textAlign: 'center' },
  notice: {
    flexDirection: 'row',
    gap: Spacing.sm,
    alignItems: 'flex-start',
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
  },
  noticeError: { backgroundColor: Colors.dangerSoft, borderColor: '#F3B9B9' },
  noticeSuccess: { backgroundColor: Colors.successSoft, borderColor: '#B7DDBE' },
  noticeText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13.5, lineHeight: 19 },
});
