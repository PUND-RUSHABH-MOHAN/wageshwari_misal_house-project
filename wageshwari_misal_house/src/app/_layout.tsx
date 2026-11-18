import {
  Baloo2_400Regular,
  Baloo2_500Medium,
  Baloo2_600SemiBold,
  Baloo2_700Bold,
  Baloo2_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/baloo-2';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { AppProvider, useApp } from '@/context/AppContext';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { currentUser, authReady } = useApp();
  const isLoggedIn = currentUser !== null;

  // Keep the native splash up until the saved session has been checked, so a logged-in
  // user never sees the login screen flash.
  useEffect(() => {
    if (authReady) SplashScreen.hideAsync();
  }, [authReady]);

  if (!authReady) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      {/* Protected routes: expo-router redirects automatically when the guard flips. */}
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
        <Stack.Screen name="confirm" />
        <Stack.Screen name="forgot" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Baloo2_400Regular,
    Baloo2_500Medium,
    Baloo2_600SemiBold,
    Baloo2_700Bold,
    Baloo2_800ExtraBold,
  });
  const ready = fontsLoaded || fontError !== null;

  // Keep the native splash up until fonts are ready (falls back to system font on error).
  // RootNavigator hides it once the session check is done too.
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <RootNavigator />
      </AppProvider>
    </SafeAreaProvider>
  );
}
