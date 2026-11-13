import type { Href } from 'expo-router';

/**
 * Home tab (`src/app/(tabs)/index.tsx`).
 * Cast through `unknown` because Expo's generated route types (.expo/types/router.d.ts)
 * spell this route as '/' or '/(tabs)/index' depending on the dev server that last wrote
 * them; '/' is correct at runtime in every case.
 */
export const HOME_HREF = '/' as unknown as Href;
