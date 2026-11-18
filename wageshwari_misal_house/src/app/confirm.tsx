import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { AuthLayout, FormNotice, authStyles } from '@/components/AuthLayout';
import { Button, TextField, TextLink } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import { isValidEmailCode } from '@/utils/format';

const RESEND_COOLDOWN_S = 30;

/**
 * POST /auth/confirm with the 6-digit emailed code. If the password is still in memory
 * (straight from sign-up / login), the user is logged in automatically.
 */
export default function ConfirmScreen() {
  const params = useLocalSearchParams<{ email?: string; destination?: string }>();
  const email = params.email ?? '';
  const { confirmSignUp, resendCode } = useApp();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const sentTo = params.destination || email;

  const submit = async () => {
    setFormError(null);
    setInfo(null);
    if (!isValidEmailCode(code)) {
      setCodeError('Enter the 6-digit code from the email');
      return;
    }
    setCodeError(undefined);
    if (loading) return;
    setLoading(true);
    try {
      const loggedIn = await confirmSignUp(email, code);
      if (!loggedIn) {
        router.replace({
          pathname: '/login',
          params: { email, notice: 'Email confirmed. Log in with your password.' },
        });
      }
      // If logged in, Stack.Protected swaps to the tabs on its own.
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setFormError(null);
    setInfo(null);
    try {
      const delivery = await resendCode(email);
      setInfo(`New code sent to ${delivery?.destination || email}.`);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (e) {
      setFormError(errorMessage(e));
    }
  };

  if (!email) {
    return (
      <AuthLayout title="Confirm your email" compactHero>
        <FormNotice tone="error" message="Missing email address. Please sign up or log in again." />
        <Button title="Back to login" onPress={() => router.replace('/login')} />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Confirm your email"
      subtitle={`We sent a 6-digit code to ${sentTo}. It can take a minute; check Spam too.`}
      compactHero>
      {formError ? <FormNotice tone="error" message={formError} /> : null}
      {info ? <FormNotice tone="success" message={info} /> : null}

      <View style={authStyles.fields}>
        <TextField
          label="Verification code"
          value={code}
          onChangeText={(v) => {
            setCode(v.replace(/\D/g, '').slice(0, 6));
            setCodeError(undefined);
          }}
          placeholder="• • • • • •"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          icon="lock"
          autoFocus
          error={codeError}
          onSubmitEditing={submit}
        />
      </View>

      <Button title="Confirm" onPress={submit} loading={loading} style={authStyles.cta} />

      <View style={authStyles.row}>
        <Text style={authStyles.rowText}>Didn&apos;t get it?</Text>
        {cooldown > 0 ? (
          <Text style={authStyles.rowText}>Resend in {cooldown}s</Text>
        ) : (
          <TextLink title="Resend code" onPress={resend} />
        )}
      </View>
      <View style={authStyles.row}>
        <TextLink title="Back to login" onPress={() => router.replace({ pathname: '/login', params: { email } })} />
      </View>
    </AuthLayout>
  );
}
