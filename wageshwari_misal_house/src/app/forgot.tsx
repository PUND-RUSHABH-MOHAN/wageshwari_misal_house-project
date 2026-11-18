import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { AuthLayout, FormNotice, authStyles } from '@/components/AuthLayout';
import { Button, TextField, TextLink } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { errorMessage } from '@/services/api';
import { PASSWORD_RULE, isValidEmail, isValidEmailCode, isValidPassword } from '@/utils/format';

/**
 * Step 1: POST /auth/password/forgot  -> Cognito emails a code.
 * Step 2: POST /auth/password/reset   -> code + new password.
 */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const { forgotPassword, resetPassword } = useApp();
  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    setFormError(null);
    if (!isValidEmail(email)) {
      setErrors({ email: 'Enter a valid email address' });
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      await forgotPassword(email);
      setStep('reset');
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    setFormError(null);
    const next: Record<string, string> = {};
    if (!isValidEmailCode(code)) next.code = 'Enter the 6-digit code from the email';
    if (!isValidPassword(password)) next.password = PASSWORD_RULE;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setLoading(true);
    try {
      await resetPassword(email, code, password);
      router.replace({
        pathname: '/login',
        params: { email: email.trim().toLowerCase(), notice: 'Password changed. Log in with your new password.' },
      });
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'email') {
    return (
      <AuthLayout title="Forgot password" subtitle="We'll email you a code to reset it" compactHero>
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
            textContentType="emailAddress"
            icon="mail"
            error={errors.email}
            onSubmitEditing={sendCode}
          />
        </View>
        <Button title="Send reset code" onPress={sendCode} loading={loading} style={authStyles.cta} />
        <View style={authStyles.row}>
          <TextLink title="Back to login" onPress={() => router.back()} />
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle={`If ${email.trim()} has an account, a 6-digit code is on its way. Check Spam too.`}
      compactHero>
      {formError ? <FormNotice tone="error" message={formError} /> : null}
      <View style={authStyles.fields}>
        <TextField
          label="Reset code"
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          placeholder="• • • • • •"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          icon="lock"
          error={errors.code}
        />
        <TextField
          label="New password"
          value={password}
          onChangeText={setPassword}
          placeholder="Choose a new password"
          secureToggle
          icon="lock"
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
          onSubmitEditing={reset}
        />
      </View>
      <Button title="Change password" onPress={reset} loading={loading} style={authStyles.cta} />
      <View style={authStyles.row}>
        <TextLink title="Use a different email" onPress={() => setStep('email')} />
      </View>
    </AuthLayout>
  );
}
