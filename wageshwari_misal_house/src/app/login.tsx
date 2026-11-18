import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthLayout, FormNotice, authStyles } from '@/components/AuthLayout';
import { Button, TextField, TextLink } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { errorMessage, isApiError } from '@/services/api';
import { isValidEmail } from '@/utils/format';

/** POST /auth/login. Navigation to the tabs happens automatically via Stack.Protected. */
export default function LoginScreen() {
  const params = useLocalSearchParams<{ email?: string; notice?: string }>();
  const { login, resendCode, rememberPendingLogin, restoreError } = useApp();
  const [email, setEmail] = useState(params.email ?? '');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(restoreError);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!isValidEmail(email)) next.email = 'Enter a valid email address';
    if (!password) next.password = 'Enter your password';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0 || loading) return;

    setLoading(true);
    try {
      await login(email, password);
    } catch (e) {
      if (isApiError(e) && e.code === 'USER_NOT_CONFIRMED') {
        // Signed up but never entered the code: send a fresh one and go confirm.
        rememberPendingLogin(email, password);
        const delivery = await resendCode(email).catch(() => null);
        router.push({
          pathname: '/confirm',
          params: { email: email.trim().toLowerCase(), destination: delivery?.destination ?? '' },
        });
      } else {
        setFormError(errorMessage(e));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Welcome 🙏" subtitle="Login to order your favourite misal">
      {params.notice ? <FormNotice tone="success" message={params.notice} /> : null}
      {formError ? <FormNotice tone="error" message={formError} /> : null}

      <View style={authStyles.fields}>
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
          placeholder="Your password"
          secureToggle
          icon="lock"
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          error={errors.password}
          onSubmitEditing={submit}
        />
      </View>

      <View style={[authStyles.row, { justifyContent: 'flex-end' }]}>
        <TextLink
          title="Forgot password?"
          onPress={() => router.push({ pathname: '/forgot', params: { email: email.trim() } })}
        />
      </View>

      <Button title="Login" onPress={submit} loading={loading} style={authStyles.cta} />

      <View style={authStyles.row}>
        <Text style={authStyles.rowText}>New here?</Text>
        <TextLink title="Create an account" onPress={() => router.push('/signup')} />
      </View>

      <Text style={authStyles.terms}>
        By continuing you agree to our Terms of Service & Privacy Policy.
      </Text>
    </AuthLayout>
  );
}
