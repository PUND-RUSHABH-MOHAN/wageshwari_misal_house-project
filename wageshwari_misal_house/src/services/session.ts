/**
 * Session tokens.
 *
 * - The refresh token (valid 30 days) is the long-lived secret: it lives in the OS keystore
 *   via expo-secure-store (Android Keystore / iOS Keychain), so the user stays logged in
 *   across app restarts.
 * - The ID token (valid 1 hour) lives only in memory. It is renewed silently a minute
 *   before it expires, or once after the API answers 401.
 * - If the refresh token itself is rejected (expired, or revoked by logout on this device),
 *   the session is cleared and `onSessionExpired` fires so the app returns to login.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { ApiError, authApi, isApiError, type LoginResponse, type RefreshResponse } from '@/services/api';

const REFRESH_KEY = 'wmh.refresh_token';
/** Renew this long before the ID token actually expires. */
const EARLY_REFRESH_MS = 60_000;

// SecureStore has no web implementation; on web the session lasts until the tab closes.
const memoryStore = new Map<string, string>();
const storage = {
  get: (key: string) =>
    Platform.OS === 'web' ? Promise.resolve(memoryStore.get(key) ?? null) : SecureStore.getItemAsync(key),
  set: (key: string, value: string) =>
    Platform.OS === 'web'
      ? Promise.resolve(void memoryStore.set(key, value))
      : SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
  remove: (key: string) =>
    Platform.OS === 'web' ? Promise.resolve(void memoryStore.delete(key)) : SecureStore.deleteItemAsync(key),
};

let idToken: string | null = null;
let idTokenExpiresAt = 0;
let refreshToken: string | null = null;
let inFlightRefresh: Promise<string> | null = null;
let onSessionExpired: (() => void) | null = null;

/** Called when the refresh token is rejected; the app should show the login screen. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

function setIdToken(token: string, expiresInSeconds: number): void {
  idToken = token;
  idTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
}

/** Store tokens from a successful login. */
export async function startSession(login: LoginResponse): Promise<void> {
  setIdToken(login.token, login.expires_in);
  refreshToken = login.refresh_token;
  await storage.set(REFRESH_KEY, login.refresh_token);
}

/** Forget everything locally. Returns the refresh token that was in use (for revoking). */
export async function clearSession(): Promise<string | null> {
  const previous = refreshToken;
  idToken = null;
  idTokenExpiresAt = 0;
  refreshToken = null;
  inFlightRefresh = null;
  try {
    await storage.remove(REFRESH_KEY);
  } catch {
    // Nothing useful to do; the token is gone from memory either way.
  }
  return previous;
}

function isSessionDead(e: unknown): boolean {
  return isApiError(e) && (e.status === 401 || e.code === 'INVALID_REFRESH_TOKEN');
}

/** Exchange the refresh token for a new ID token. Concurrent callers share one request. */
function refreshIdToken(): Promise<string> {
  if (inFlightRefresh) return inFlightRefresh;
  const token = refreshToken;
  if (!token) return Promise.reject(new ApiError(401, 'NOT_LOGGED_IN', 'Please log in.'));

  inFlightRefresh = authApi
    .refresh(token)
    .then(async (res: RefreshResponse) => {
      setIdToken(res.token, res.expires_in);
      if (res.refresh_token) {
        refreshToken = res.refresh_token;
        await storage.set(REFRESH_KEY, res.refresh_token);
      }
      return res.token;
    })
    .catch(async (e: unknown) => {
      if (isSessionDead(e)) {
        await clearSession();
        onSessionExpired?.();
      }
      throw e;
    })
    .finally(() => {
      inFlightRefresh = null;
    });
  return inFlightRefresh;
}

async function validIdToken(): Promise<string> {
  if (idToken && Date.now() < idTokenExpiresAt - EARLY_REFRESH_MS) return idToken;
  return refreshIdToken();
}

/**
 * Run an authenticated API call with a fresh ID token. If the API still answers 401
 * (e.g. the clock is off), refresh once and retry.
 */
export async function withAuth<T>(call: (token: string) => Promise<T>): Promise<T> {
  const token = await validIdToken();
  try {
    return await call(token);
  } catch (e) {
    if (isApiError(e) && e.status === 401 && refreshToken) {
      return call(await refreshIdToken());
    }
    throw e;
  }
}

/**
 * On app start: is there a stored refresh token, and does it still work?
 * - 'restored'  -> tokens are live; fetch the user next.
 * - 'none'      -> no stored session (or it was rejected and has been cleared).
 * Network errors are thrown, and the stored token is kept for the next launch.
 */
export async function restoreSession(): Promise<'restored' | 'none'> {
  const stored = await storage.get(REFRESH_KEY).catch(() => null);
  if (!stored) return 'none';
  refreshToken = stored;
  try {
    await refreshIdToken();
    return 'restored';
  } catch (e) {
    if (isSessionDead(e)) return 'none';
    refreshToken = null; // keep it in storage, but don't use it until the next launch
    throw e;
  }
}
