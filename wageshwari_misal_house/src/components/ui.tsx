/**
 * Small design-system primitives shared across screens.
 */
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { Colors, Fonts, InputStyles, Radius, Shadow, Spacing } from '@/constants/theme';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
  right,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  right?: ReactNode;
}) {
  const isDisabled = disabled || loading;
  const fg =
    variant === 'primary'
      ? Colors.white
      : variant === 'danger'
        ? Colors.danger
        : Colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        variant === 'primary' && styles.btnPrimary,
        variant === 'outline' && styles.btnOutline,
        variant === 'danger' && styles.btnDanger,
        variant === 'ghost' && styles.btnGhost,
        isDisabled && styles.btnDisabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={fg} /> : null}
          <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
          {right}
        </>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Pill (selectable chip)
// ---------------------------------------------------------------------------
export function Pill({
  label,
  sublabel,
  selected,
  onPress,
  disabled,
  style,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pill,
        selected && styles.pillSelected,
        disabled && styles.pillDisabled,
        pressed && styles.pressed,
        style,
      ]}>
      <Text
        style={[styles.pillText, selected && styles.pillTextSelected, disabled && styles.textDisabled]}
        numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? (
        <Text
          style={[styles.pillSub, selected && styles.pillSubSelected, disabled && styles.textDisabled]}
          numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// TextField
// ---------------------------------------------------------------------------
export function TextField({
  label,
  error,
  prefix,
  icon,
  secureToggle,
  style,
  ...inputProps
}: TextInputProps & {
  label: string;
  error?: string;
  prefix?: string;
  /** Leading icon; tints maroon while the field is focused. */
  icon?: IconName;
  secureToggle?: boolean;
}) {
  const [hidden, setHidden] = useState(true);
  const [focused, setFocused] = useState(false);
  const editable = inputProps.editable !== false;

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, focused && styles.fieldLabelFocused, error ? styles.fieldLabelError : null]}>
        {label}
      </Text>
      <View
        style={[
          styles.inputWrap,
          focused && InputStyles.focused,
          error ? InputStyles.error : null,
          !editable && styles.inputDisabled,
        ]}>
        {icon ? (
          <Icon name={icon} size={20} color={error ? Colors.danger : focused ? Colors.primary : Colors.textSubtle} />
        ) : null}
        {prefix ? (
          <View style={styles.prefixWrap}>
            <Text style={styles.prefix}>{prefix}</Text>
            <View style={styles.prefixDivider} />
          </View>
        ) : null}
        <TextInput
          placeholderTextColor={Colors.textSubtle}
          {...inputProps}
          secureTextEntry={secureToggle ? hidden : inputProps.secureTextEntry}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {secureToggle ? (
          <Pressable
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            hitSlop={10}
            onPress={() => setHidden((h) => !h)}>
            <Icon name={hidden ? 'eye' : 'eyeOff'} color={focused ? Colors.primary : Colors.textMuted} size={20} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Icon name="info" size={13} color={Colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Card / Section helpers
// ---------------------------------------------------------------------------
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function TextLink({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button">
      {({ pressed }) => <Text style={[styles.link, pressed && styles.pressed]}>{title}</Text>}
    </Pressable>
  );
}

export function Tag({
  label,
  color = Colors.primary,
  bg = Colors.primarySoft,
  icon,
}: {
  label: string;
  color?: string;
  bg?: string;
  icon?: IconName;
}) {
  return (
    <View style={[styles.tag, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text style={[styles.tagText, { color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Veg badge (FSSAI-style green square with dot)
// ---------------------------------------------------------------------------
export function VegBadge({ isVeg = true, size = 14 }: { isVeg?: boolean; size?: number }) {
  const color = isVeg ? Colors.veg : Colors.danger;
  return (
    <View
      accessibilityLabel={isVeg ? 'Vegetarian' : 'Non-vegetarian'}
      style={[styles.vegBox, { width: size, height: size, borderColor: color }]}>
      <View
        style={{ width: size * 0.45, height: size * 0.45, borderRadius: size, backgroundColor: color }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Quantity stepper
// ---------------------------------------------------------------------------
export function QuantityStepper({
  quantity,
  onIncrement,
  onDecrement,
  compact,
}: {
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.stepper, compact && styles.stepperCompact]}>
      <Pressable
        accessibilityLabel="Decrease quantity"
        hitSlop={6}
        onPress={onDecrement}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}>
        <Icon name="minus" size={16} color={Colors.white} />
      </Pressable>
      <Text style={styles.stepQty}>{quantity}</Text>
      <Pressable
        accessibilityLabel="Increase quantity"
        hitSlop={6}
        onPress={onIncrement}
        style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}>
        <Icon name="plus" size={16} color={Colors.white} />
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------
export function EmptyState({
  emoji,
  title,
  message,
  actionLabel,
  onAction,
}: {
  emoji: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyArt}>
        <Text style={styles.emptyEmoji}>{emoji}</Text>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMsg}>{message}</Text>
      {actionLabel && onAction ? (
        <Button title={actionLabel} onPress={onAction} style={styles.emptyBtn} />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Loading / load-error state for server data
// ---------------------------------------------------------------------------
/**
 * Spinner while `loading`; otherwise, if `error` is set, the message and a Retry button.
 * Renders nothing when there is neither.
 */
export function LoadState({
  loading,
  error,
  onRetry,
  compact = false,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** Inline (inside a card or list section) instead of filling the screen. */
  compact?: boolean;
}) {
  if (loading) {
    return (
      <View style={compact ? styles.loadCompact : styles.load}>
        <ActivityIndicator color={Colors.primary} size={compact ? 'small' : 'large'} />
      </View>
    );
  }
  if (!error) return null;
  return (
    <View style={compact ? styles.loadCompact : styles.load}>
      <View style={styles.errorRow}>
        <Icon name="info" size={16} color={Colors.danger} />
        <Text style={styles.loadError}>{error}</Text>
      </View>
      <Button title="Retry" variant="outline" onPress={onRetry} style={styles.retryBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.75 },
  load: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md },
  loadCompact: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.md },
  loadError: { flexShrink: 1, fontFamily: Fonts.medium, fontSize: 14, color: Colors.danger, textAlign: 'center' },
  retryBtn: { minWidth: 140 },

  btn: {
    minHeight: 50,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  btnPrimary: { backgroundColor: Colors.primary },
  btnOutline: { borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.surface },
  btnDanger: { borderWidth: 1.5, borderColor: Colors.danger, backgroundColor: Colors.dangerSoft },
  btnGhost: { backgroundColor: 'transparent' },
  btnDisabled: { opacity: 0.45 },
  btnText: { fontFamily: Fonts.bold, fontSize: 17, lineHeight: 22 },

  pill: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillDisabled: { backgroundColor: Colors.surfaceMuted, borderColor: Colors.surfaceMuted },
  pillText: { fontFamily: Fonts.semibold, fontSize: 15, lineHeight: 20, color: Colors.text },
  pillTextSelected: { color: Colors.white },
  pillSub: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  pillSubSelected: { color: '#FFE0C7' },
  textDisabled: { color: Colors.textSubtle },

  field: { gap: 6 },
  fieldLabel: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.textMuted },
  fieldLabelFocused: { color: Colors.primary },
  fieldLabelError: { color: Colors.danger },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    ...InputStyles.idle,
    borderRadius: Radius.md + 2,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
    minHeight: 54,
    boxShadow: '0px 1px 2px rgba(80, 20, 10, 0.05)',
  },
  inputDisabled: { backgroundColor: Colors.surfaceMuted },
  prefixWrap: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  prefix: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },
  prefixDivider: { width: 1, height: 22, backgroundColor: Colors.border },
  input: {
    flex: 1,
    height: 50,
    paddingVertical: 0,
    // The wrapper owns the box; the bare input must not paint its own background/outline.
    backgroundColor: 'transparent',
    fontFamily: Fonts.medium,
    fontSize: 16,
    color: Colors.text,
    ...InputStyles.reset,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  errorText: { fontFamily: Fonts.medium, fontSize: 12.5, color: Colors.danger },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 19, lineHeight: 26, color: Colors.text },
  link: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.primary },

  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  tagText: { fontSize: 11, fontWeight: '700' },

  vegBox: { borderWidth: 1.5, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },

  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.sm,
    height: 36,
    ...Shadow.card,
  },
  stepperCompact: { height: 32 },
  stepBtn: { width: 34, height: '100%', alignItems: 'center', justifyContent: 'center' },
  stepQty: { minWidth: 22, textAlign: 'center', color: Colors.white, fontWeight: '800', fontSize: 15 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.md },
  emptyArt: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyEmoji: { fontSize: 56 },
  emptyTitle: { fontFamily: Fonts.bold, fontSize: 22, lineHeight: 30, color: Colors.text, textAlign: 'center' },
  emptyMsg: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  emptyBtn: { marginTop: Spacing.md, alignSelf: 'stretch', maxWidth: 320, width: '100%' },
});
