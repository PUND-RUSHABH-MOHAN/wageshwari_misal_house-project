import { Image } from 'expo-image';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, TextField } from '@/components/ui';
import { Colors, Fonts, Radius, Shadow, Spacing } from '@/constants/theme';
import { useApp } from '@/context/AppContext';
import { LOGIN_BG, LOGO } from '@/data/mock-data';
import { formatPhone, isValidEmail, isValidIndianMobile } from '@/utils/format';

type Mode = 'email' | 'phone';
const MOCK_DELAY_MS = 700;

export default function LoginScreen() {
  const { login } = useApp();
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrors({});
  };

  /** Simulates a network round-trip, then logs in. Navigation is handled by Stack.Protected. */
  const submit = () => {
    const next: Record<string, string> = {};
    if (mode === 'email') {
      if (!isValidEmail(email)) next.email = 'Enter a valid email address';
      if (password.length < 6) next.password = 'Password must be at least 6 characters';
    } else {
      if (!isValidIndianMobile(phone)) next.phone = 'Enter a valid 10-digit mobile number';
      else if (otpSent && !/^\d{4}$/.test(otp)) next.otp = 'Enter the 4-digit OTP';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      if (mode === 'phone' && !otpSent) {
        setOtpSent(true); // POST /auth/otp/send
        return;
      }
      login(mode === 'email' ? { method: 'email', email, password } : { method: 'phone', phone, otp });
    }, MOCK_DELAY_MS);
  };

  const ctaTitle = mode === 'phone' && !otpSent ? 'Send OTP' : 'Login / Continue';

  return (
    <View style={styles.root}>
      {/* Shop banner as a soft, blurred backdrop + maroon wash so the form stays the focus */}
      <Image source={LOGIN_BG} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={5} />
      <View style={styles.overlay} />
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Brand */}
          <View style={styles.hero}>
            <Image
              source={LOGO}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="Wagheshwar Misal House logo"
            />
            <Text style={styles.brand}>Wagheshwar Misal House</Text>
            <Text style={styles.tagline}>Authentic Puneri & Kolhapuri Misal · Delivered hot</Text>
          </View>

          {/* Form card */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Welcome 🙏</Text>
            <Text style={styles.cardSub}>Login to order your favourite misal</Text>

            <View style={styles.segment} accessibilityRole="tablist">
              {(['email', 'phone'] as const).map((m) => (
                <Pressable
                  key={m}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mode === m }}
                  onPress={() => switchMode(m)}
                  style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}>
                  <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                    {m === 'email' ? 'Email' : 'Phone (OTP)'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'email' ? (
              <View style={styles.fields}>
                <TextField
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoComplete="email"
                  icon="mail"
                  textContentType="emailAddress"
                  error={errors.email}
                />
                <TextField
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Minimum 6 characters"
                  secureToggle
                  icon="lock"
                  autoCapitalize="none"
                  textContentType="password"
                  error={errors.password}
                  onSubmitEditing={submit}
                />
              </View>
            ) : (
              <View style={styles.fields}>
                <TextField
                  label="Mobile number"
                  icon="phone"
                  prefix="+91"
                  value={phone}
                  onChangeText={(v) => {
                    setPhone(v.replace(/\D/g, '').slice(0, 10));
                    setOtpSent(false);
                    setOtp('');
                  }}
                  placeholder="98765 43210"
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  error={errors.phone}
                />
                {otpSent ? (
                  <>
                    <TextField
                      label={`OTP sent to ${formatPhone(phone)}`}
                      value={otp}
                      onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 4))}
                      placeholder="• • • •"
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      maxLength={4}
                      icon="lock"
                      error={errors.otp}
                      onSubmitEditing={submit}
                    />
                    <Text style={styles.hint}>Demo mode: any 4 digits will work.</Text>
                  </>
                ) : null}
              </View>
            )}

            <Button title={ctaTitle} onPress={submit} loading={loading} style={styles.cta} />

            <Text style={styles.terms}>
              By continuing you agree to our Terms of Service & Privacy Policy.
            </Text>
          </View>

          <Text style={styles.footer}>Serving Pune since 1998 · Open 7 AM – 2 PM</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.primaryDark, overflow: 'hidden' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(60, 6, 8, 0.48)' },
  safe: { flex: 1, backgroundColor: 'transparent' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: Spacing.xl, justifyContent: 'center', gap: Spacing.xl },
  hero: { alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.lg },
  logo: { width: 148, height: 148 },
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
  segment: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceMuted,
    borderRadius: Radius.md,
    padding: 4,
    marginTop: Spacing.sm,
  },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: Colors.surface, ...Shadow.card },
  segmentText: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.textMuted },
  segmentTextActive: { color: Colors.primary },
  fields: { gap: Spacing.md },
  hint: { fontFamily: Fonts.regular, fontSize: 12.5, color: Colors.textMuted },
  cta: { marginTop: Spacing.sm },
  terms: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textSubtle, textAlign: 'center' },
  footer: { fontFamily: Fonts.medium, fontSize: 13, color: '#F6DCDA', textAlign: 'center' },
});
