import type { ConfigContext, ExpoConfig } from 'expo/config';
import { AndroidConfig, withAndroidManifest } from 'expo/config-plugins';

/**
 * Extends app.json with the Google Maps API key for Android, read from the environment so
 * the key never lives in Git:
 *   - local builds / `npx expo start`: GOOGLE_MAPS_ANDROID_API_KEY in `.env.local` (not committed)
 *   - EAS cloud builds: an EAS environment variable with the same name (README §4.3)
 *
 * The key is added straight to AndroidManifest.xml (`com.google.android.geo.API_KEY`) by a
 * manifest mod, so it is not copied into the public app config that ships in the JS bundle.
 * (It is still inside the APK, as every Android Maps key is; the Google Cloud restriction to
 * this app's package + signing certificate is what protects it.)
 *
 * Without a key the app still works; the Android map screens are hidden in standalone builds.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const androidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY?.trim() ?? '';

  const withConfig: ExpoConfig = {
    ...(config as ExpoConfig),
    plugins: [...(config.plugins ?? []), 'react-native-maps'],
    extra: {
      ...config.extra,
      /** Read by src/utils/maps.ts. Only says whether a key exists; never the key itself. */
      googleMapsConfigured: androidKey.length > 0,
    },
  };

  if (!androidKey) return withConfig;

  return withAndroidManifest(withConfig, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.google.android.geo.API_KEY', androidKey);
    return mod;
  });
};
