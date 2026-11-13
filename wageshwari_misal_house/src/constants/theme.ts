import { Platform, type TextStyle } from 'react-native';

/** Brand palette taken from the Wagheshwar Misal House logo (maroon + turmeric yellow). */
export const Colors = {
  primary: '#8E1B1B',
  primaryDark: '#6E1214',
  primarySoft: '#FBEDEC',
  primaryBorder: '#EBC3BF',
  accent: '#FFC21A',
  accentSoft: '#FFF6D6',
  spice: '#D84315',
  spiceSoft: '#FBE9E7',
  background: '#F7F3F1',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EAE7',
  text: '#2A1513',
  textMuted: '#6F625F',
  textSubtle: '#A3958F',
  border: '#ECE2DE',
  veg: '#2E7D32',
  success: '#2E7D32',
  successSoft: '#E8F5E9',
  danger: '#C62828',
  dangerSoft: '#FFEBEE',
  warning: '#B26A00',
  warningSoft: '#FFF8E1',
  info: '#1565C0',
  infoSoft: '#E3F2FD',
  overlay: 'rgba(30, 10, 8, 0.5)',
  white: '#FFFFFF',
} as const;

/**
 * Baloo 2 (loaded in the root layout) — rounded display face that also covers
 * Devanagari, so English and Marathi dish names render in the same style.
 */
export const Fonts = {
  regular: 'Baloo2_400Regular',
  medium: 'Baloo2_500Medium',
  semibold: 'Baloo2_600SemiBold',
  bold: 'Baloo2_700Bold',
  extrabold: 'Baloo2_800ExtraBold',
} as const;

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;

export const Radius = { sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, pill: 999 } as const;

/**
 * Shared text-input look. `reset` removes the browser's default focus outline,
 * which otherwise draws a second box *inside* our styled field on web.
 */
export const InputStyles = {
  // Must be `outline-style: none`: Chrome's `auto` focus ring ignores width/colour and still
  // paints a white inner ring. RN's types don't list 'none', but react-native-web passes it through.
  reset: (Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}) as TextStyle,
  idle: { borderColor: '#E4D8D3', backgroundColor: Colors.surface },
  focused: {
    borderColor: Colors.primary,
    backgroundColor: '#FFFCFB',
    boxShadow: '0px 0px 0px 4px rgba(142, 27, 27, 0.12)',
  },
  error: {
    borderColor: Colors.danger,
    boxShadow: '0px 0px 0px 4px rgba(198, 40, 40, 0.12)',
  },
} as const;

/** Cross-platform card shadow (RN new-arch + react-native-web both support boxShadow). */
export const Shadow = {
  card: { boxShadow: '0px 2px 10px rgba(80, 20, 10, 0.07)' },
  raised: { boxShadow: '0px 6px 20px rgba(80, 20, 10, 0.16)' },
  bar: { boxShadow: '0px -4px 16px rgba(80, 20, 10, 0.08)' },
} as const;
