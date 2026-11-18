import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { AuthLayout, FormNotice, authStyles } from '@/components/AuthLayout';
import { Button, TextField, TextLink } from '@/components/ui';
import { useApp } from '@/context/AppContext';
import { errorMessage, isApiError } from '@/services/api';
import { PASSWORD_RULE, isValidEmail, isValidIndianMobile, isValidPassword } from '@/utils/format';

/** POST /auth/register, then on to the confirm-code screen. */
export default function SignUpScreen() {
  const { register, resendCode, rememberPendingLogin } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [loading, setLoading] = useState(false);

  const goConfirm = (destination?: string | null) =>
    router.push({
      pathname: '/confirm',
      params: { email: email.trim().toLowerCase(), destination: destination ?? '' },
    });

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Enter your name';
    else if (name.trim().length > 60) next.name = 'Name must be at most 60 characters';
    if (!isValidEmail(email)) next.email = 'Enter a valid email address';
    if (!isValidIndianMobile(phone)) next.phone = 'Enter a valid 10-digit mobile number starting with 6–9';
    if (!isValidPassword(password)) next.password = PASSWORD_RULE;
    setErrors(next);
    setFormError(null);
    setEmailTaken(false);
    if (Object.keys(next).length > 0 || loading) return;

    setLoading(true);
    try {
      const delivery = await register({ name, email, phone, password });
      goConfirm(delivery?.destination);
    } catch (e) {
      setFormError(errorMessage(e));
      if (isApiError(e) && e.code === 'EMAIL_TAKEN') setEmailTaken(true);
    } finally {
      setLoading(false);
    }
  };

  /** Registered earlier but never confirmed: send a new code. */
  const confirmExisting = async () => {
    setLoading(true);
    try {
      rememberPendingLogin(email, password);
      const delivery = await resendCode(email);
      goConfirm(delivery?.destination);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Create account" subtitle="We'll email you a code to confirm it's you" compactHero>
      {formError ? <FormNotice tone="error" message={formError} /> : null}
      {emailTaken ? (
        <View style={authStyles.row}>
          <TextLink title="Send me a new code" onPress={confirmExisting} />
          <Text style={authStyles.rowText}>·</Text>
          <TextLink
            title="Log in instead"
            onPress={() => router.replace({ pathname: '/login', params: { email: email.trim() } })}
          />
        </View>
      ) : null}

      <View style={authStyles.fields}>
        <TextField
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="Tushar Kulange"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          icon="account"
          error={errors.name}
        />
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
        />
        <TextField
          label="Mobile number"
          icon="phone"
          prefix="+91"
          value={phone}
          onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
          placeholder="98765 43210"
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          error={errors.phone}
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Choose a password"
          secureToggle
          icon="lock"
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
          onSubmitEditing={submit}
        />
        {!errors.password ? <Text style={authStyles.hint}>{PASSWORD_RULE}.</Text> : null}
      </View>

      <Button title="Create account" onPress={submit} loading={loading} style={authStyles.cta} />

      <View style={authStyles.row}>
        <Text style={authStyles.rowText}>Already have an account?</Text>
        <TextLink title="Log in" onPress={() => router.back()} />
      </View>
    </AuthLayout>
  );
}
