import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import type { ColorValue } from 'react-native';

/** Semantic icon names -> SF Symbol (iOS) + Material Symbol (Android / web). */
const ICONS = {
  home: { ios: 'house.fill', md: 'home' },
  cart: { ios: 'cart.fill', md: 'shopping_cart' },
  orders: { ios: 'list.bullet.rectangle.portrait.fill', md: 'receipt_long' },
  profile: { ios: 'person.crop.circle.fill', md: 'person' },
  location: { ios: 'mappin.circle.fill', md: 'location_on' },
  plus: { ios: 'plus', md: 'add' },
  minus: { ios: 'minus', md: 'remove' },
  close: { ios: 'xmark', md: 'close' },
  check: { ios: 'checkmark', md: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', md: 'check_circle' },
  edit: { ios: 'pencil', md: 'edit' },
  note: { ios: 'square.and.pencil', md: 'edit_note' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', md: 'logout' },
  chevronDown: { ios: 'chevron.down', md: 'expand_more' },
  chevronUp: { ios: 'chevron.up', md: 'expand_less' },
  chevronRight: { ios: 'chevron.right', md: 'chevron_right' },
  clock: { ios: 'clock.fill', md: 'schedule' },
  phone: { ios: 'phone.fill', md: 'call' },
  mail: { ios: 'envelope.fill', md: 'mail' },
  flame: { ios: 'flame.fill', md: 'local_fire_department' },
  trash: { ios: 'trash', md: 'delete' },
  cash: { ios: 'banknote.fill', md: 'payments' },
  upi: { ios: 'qrcode', md: 'qr_code' },
  bag: { ios: 'bag.fill', md: 'shopping_bag' },
  store: { ios: 'storefront.fill', md: 'storefront' },
  radioOn: { ios: 'largecircle.fill.circle', md: 'radio_button_checked' },
  radioOff: { ios: 'circle', md: 'radio_button_unchecked' },
  eye: { ios: 'eye', md: 'visibility' },
  eyeOff: { ios: 'eye.slash', md: 'visibility_off' },
  info: { ios: 'info.circle.fill', md: 'info' },
  search: { ios: 'magnifyingglass', md: 'search' },
  bagOutline: { ios: 'bag', md: 'shopping_bag' },
  account: { ios: 'person', md: 'person' },
  lock: { ios: 'lock.fill', md: 'lock' },
} satisfies Record<string, { ios: SFSymbol; md: AndroidSymbol }>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 20,
  color,
}: {
  name: IconName;
  size?: number;
  color: ColorValue;
}) {
  const icon = ICONS[name];
  return (
    <SymbolView
      name={{ ios: icon.ios, android: icon.md, web: icon.md }}
      size={size}
      tintColor={color}
      style={{ width: size, height: size }}
    />
  );
}
