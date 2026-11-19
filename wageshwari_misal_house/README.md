# Wagheshwar Misal House — Mobile App

A food-ordering app for **Wagheshwar Misal House**, Pune. Customers browse the menu
(Misal, Thali, Vada Pav, Chaha), pick a spice level, choose a delivery slot and
place orders (Cash on Delivery / Online).

> **Current status:** every screen reads from and writes to the backend; there is no
> mock data left. Auth and profile are live. Menu, addresses and orders call endpoints
> that are **not deployed yet**. Until they are, those screens show an error with a
> Retry button. See **`BACKEND_INTEGRATION_REPORT.md`** for what the backend still needs.

---

## 1. Tech stack and versions

| Area | Technology | Version |
|---|---|---|
| Framework | [Expo](https://expo.dev) (managed workflow, Continuous Native Generation) | SDK **58** (`expo` 58.0.23) |
| UI runtime | React Native | **0.88.1** |
| UI library | React | **19.3.0** |
| Language | TypeScript (strict mode) | **6.0.3** |
| Navigation | Expo Router (file-based routing, typed routes) | 58.0.30 |
| State management | React Context + `useReducer` (no Redux) | — |
| Images | `expo-image` | 58.0.18 |
| Icons | `expo-symbols` (SF Symbols on iOS, Material Symbols on Android/web) | 58.0.4 |
| Fonts | Baloo 2 (`@expo-google-fonts/baloo-2`), which covers English and Marathi (Devanagari) | 0.4.2 |
| Animations | `react-native-reanimated` / `react-native-worklets` | 4.7.1 / 0.13.0 |
| Web support | `react-native-web` | 0.21.4 |
| Compiler | React Compiler (enabled in `app.json` → `experiments.reactCompiler`) | — |
| Linting | ESLint 9 + `eslint-config-expo` | 9.39.5 |
| Builds | EAS Build (cloud), see section 6 | — |

**Platforms:** Android, iOS, Web. **Package manager:** npm (`package-lock.json`).
**Android package ID:** `com.wagheshwar.misalhouse`.

Exact versions of every dependency are pinned in `package.json` / `package-lock.json`.

---

## 2. Project structure

```
src/
├── app/                      # Screens (Expo Router — every file is a route)
│   ├── _layout.tsx           # Root layout: fonts, AppProvider, login guard
│   ├── login.tsx             # Login (email + password, or phone + OTP)
│   └── (tabs)/
│       ├── _layout.tsx       # Bottom tab bar
│       ├── index.tsx         # Home: categories, search, product grid
│       ├── cart.tsx          # Cart, bill, delivery slot, payment, place order
│       ├── orders.tsx        # Order history + live status
│       └── profile.tsx       # Profile + saved addresses
├── components/               # Reusable UI (ProductCard, ProductDetailSheet, BottomSheet, …)
├── context/AppContext.tsx    # ★ Global state; screens call useApp(), actions call the API
├── services/api.ts           # ★ Every HTTP call (one function per endpoint)
├── services/session.ts       # Tokens: secure storage + silent refresh
├── constants/images.ts       # Logo + bundled fallback food photos
├── types/index.ts            # ★ Data models = the JSON contract with the backend
├── utils/pricing.ts          # Bill calculation, delivery fee, GST, delivery slots, kitchen hours
├── utils/format.ts           # Currency (paise → ₹), dates, spice labels, validators
└── constants/theme.ts        # Brand colours, fonts, spacing
assets/images/                # Logo, app icons, food photos
```

---

## 3. Getting started

```bash
npm install
npx expo start          # dev server (press a = Android, w = web)
npx expo start -c       # same, with Metro cache cleared (use after replacing images)
npx tsc --noEmit        # type-check
npx expo lint           # lint
```

> Login uses the real backend: sign up with a real email address and confirm the
> emailed 6-digit code.

---

## 4. API integration

### 4.1 Where are the base URL and HTTP calls?

| File | Role |
|---|---|
| `.env` | `EXPO_PUBLIC_API_BASE_URL` for `npx expo start`. Public value; committed. |
| `eas.json` | The same variable for EAS cloud builds (`preview`, `production`). |
| `src/services/api.ts` | The only place that calls `fetch`. One function per endpoint; every failure becomes an `ApiError` with the backend's `code` and `message`. |
| `src/services/session.ts` | Tokens. The refresh token (30 days) is kept in the OS keystore with `expo-secure-store`; the ID token (1 hour) only in memory, renewed automatically. |
| `src/context/AppContext.tsx` | Screens call `useApp()`. Every action calls the API; each collection has a `*Load` status (`idle`/`loading`/`ready`/`error`) for spinners and Retry. |

**Live (Part 2):** sign-up, email-code confirmation, login, remembered login across restarts,
silent token refresh, forgot/reset password, `GET`/`PATCH /me`, logout (revokes the refresh token).

**Wired, waiting for the backend:** `GET /categories`, `GET /products` (part 3), `/addresses`
(part 4), `/orders` (part 5). Loaded after login; orders are re-fetched every 20 s while one is
in progress and the app is in the foreground. Pull down on Home or Orders to reload.

**Client-only:** the cart (sent with `POST /orders`), the bill preview, delivery slots and
kitchen hours (`src/utils/pricing.ts`). The server's order response is the final bill.
Phone + OTP login is removed from the login screen until part 8.

### 4.2 Running against the backend

```powershell
npm install
npx expo start --clear     # scan the QR with Expo Go, or press "a" for the Android emulator
```

Change the API URL in `.env` (and `eas.json` for cloud builds), then restart with `--clear`.

### 4.3 Endpoint map

| Screen | Action in code | Endpoint | Code location |
|---|---|---|---|
| Login | send OTP | `POST /auth/otp/send` | `src/app/login.tsx` |
| Login | `login()` | `POST /auth/login` (email) · `POST /auth/otp/verify` (phone) | `AppContext.tsx` → `LOGIN` |
| Profile | `logout()` | `POST /auth/logout` | `AppContext.tsx` → `LOGOUT` |
| Home | `refreshCatalog()` | `GET /categories`, `GET /products` | `api.ts` → `catalogApi` |
| Profile | current user | `GET /me` | `api.ts` → `meApi.get` |
| Profile | `updateUser()` | `PATCH /me` | `api.ts` → `meApi.patch` |
| Profile / Cart | `refreshAddresses()` | `GET /addresses` | `api.ts` → `addressApi.list` |
| Profile / Cart | `saveAddress()` | `POST /addresses` (new) · `PATCH /addresses/:id` (edit) | `api.ts` → `addressApi` |
| Profile | `deleteAddress()` | `DELETE /addresses/:id` | `api.ts` → `addressApi.remove` |
| Profile | `setDefaultAddress()` | `PATCH /addresses/:id` `{ "is_default": true }` | `api.ts` → `addressApi.update` |
| Cart | `placeOrder()` | `POST /orders` (+ `Idempotency-Key` header) | `api.ts` → `orderApi.create` |
| Orders | `refreshOrders()` / polling | `GET /orders` | `api.ts` → `orderApi.list` |
| Orders | `cancelOrder()` | `POST /orders/:id/cancel` | `api.ts` → `orderApi.cancel` |

The cart is **client-side only** in v1. No cart endpoint is needed.

---

## 5. Expected JSON formats

### 5.1 Conventions (important)

| Rule | Detail |
|---|---|
| Field names | `snake_case`, matching database columns 1:1 |
| **Money** | **Integer paise** (₹1 = 100 paise). `9000` = ₹90.00. Never send decimals or rupees. |
| IDs | Strings (the app's fallback images expect prefixes like `usr_`, `adr_`, `cat_`, `prd_`, `ord_`, `oit_`; any unique string works) |
| Dates | `delivery_date`: `"YYYY-MM-DD"`. `created_at`: ISO 8601 timestamp |
| Optional fields | May be omitted or `null` (`line2`, `landmark`, `spice_level`, `note`) |
| Response body | The app expects the plain object/array shown below. If the backend wraps responses (e.g. `{ "data": … }`), unwrap them in `src/services/api.ts`. |

Source of truth: **`src/types/index.ts`**.

### 5.2 Login screen

The login request bodies come from the `LoginInput` type:

```jsonc
// POST /auth/login
{ "email": "customer@example.com", "password": "secret123" }

// POST /auth/otp/send
{ "phone": "9876543210" }

// POST /auth/otp/verify
{ "phone": "9876543210", "otp": "1234" }
```

Response: the logged-in **User**. The app has no session token yet. The format
below is a **suggestion** for the backend team:

```json
{
  "token": "<access token>",
  "user": {
    "id": "usr_01",
    "name": "Tushar Kulange",
    "phone": "9876543210",
    "email": "tushar@example.com",
    "role": "customer",
    "is_active": true
  }
}
```

- `role`: `"customer"` | `"admin"`
- Phone: 10-digit Indian mobile number, without `+91`
- OTP: 4 digits

### 5.3 Home screen

**`GET /categories`** returns `Category[]`. The app shows only `is_active: true`,
sorted by `sort_order`.

```json
[
  {
    "id": "cat_misal",
    "name": "Misal",
    "name_mr": "मिसळ",
    "image_url": "https://cdn.wagheshwarmisal.in/categories/misal.jpg",
    "sort_order": 1,
    "is_active": true
  }
]
```

`name` is any string; categories are managed on the server.

**`GET /products`** returns `Product[]`:

```json
[
  {
    "id": "prd_misal_pav",
    "category_id": "cat_misal",
    "name": "Misal Pav",
    "name_mr": "मिसळ पाव",
    "description": "Spicy matki usal with tarri, farsan, onion, lemon and 2 soft pav.",
    "price": 9000,
    "image_url": "https://cdn.wagheshwarmisal.in/products/misal-pav.jpg",
    "is_veg": true,
    "has_spice_level": true,
    "is_available": true
  }
]
```

- `has_spice_level: true` shows the Mild / Medium / Teekha picker.
- `is_available: false` shows "Sold out" and disables adding.
- Images: `image_url` is loaded first. If it is missing or fails, the app falls back to a
  bundled photo for that `id` (`PRODUCT_FALLBACK_IMAGES` in `src/constants/images.ts`),
  then to a 🍽️ placeholder.

### 5.4 Cart screen → place order

The bill is calculated in the app (`src/utils/pricing.ts`). The backend should use
the same rules and treat its own result as final:

| Item | Rule |
|---|---|
| `subtotal` | Σ `price × quantity` |
| `delivery_fee` | Flat **₹30** (`3000`), or 0 if the cart is empty |
| `tax` | **5% GST** on subtotal, rounded to the nearest paise |
| `total` | `subtotal + delivery_fee + tax` |

**`POST /orders`** request. The first four fields are the app's `PlaceOrderInput`
type. The `items` array is built from the cart, and the backend needs it because the
cart lives on the device:

```json
{
  "address_id": "adr_01",
  "delivery_date": "2026-11-13",
  "slot_label": "Morning 8:00 - 9:00 AM",
  "payment_method": "cod",
  "items": [
    { "product_id": "prd_misal_pav", "quantity": 2, "spice_level": "teekha", "note": "Less onion" },
    { "product_id": "prd_chaha", "quantity": 2 }
  ]
}
```

- `payment_method`: `"cod"` | `"online"`
- `spice_level`: `"mild"` | `"medium"` | `"teekha"`. Only for products with `has_spice_level: true`.
- `note`: optional, max 120 characters

Response: the created **Order** (see 5.5).

### 5.5 Orders screen

**`GET /orders`** returns `Order[]`, newest first. **`GET /orders/:id`** and
**`POST /orders/:id/cancel`** return a single `Order`:

```json
{
  "id": "ord_01",
  "order_number": "WMH-20261113-0001",
  "user_id": "usr_01",
  "address_snapshot": {
    "id": "adr_01",
    "user_id": "usr_01",
    "label": "Home",
    "receiver_name": "Tushar Kulange",
    "receiver_phone": "9876543210",
    "line1": "Flat 12, Sai Residency",
    "line2": "Kothrud",
    "landmark": "Karishma Society",
    "city": "Pune",
    "pincode": "411038",
    "is_default": true
  },
  "delivery_date": "2026-11-13",
  "slot_label": "Morning 8:00 - 9:00 AM",
  "status": "CONFIRMED",
  "subtotal": 21000,
  "delivery_fee": 3000,
  "tax": 1050,
  "total": 25050,
  "payment_method": "cod",
  "payment_status": "pending",
  "created_at": "2026-11-12T18:30:00.000Z",
  "items": [
    {
      "id": "oit_01",
      "order_id": "ord_01",
      "product_id": "prd_misal_pav",
      "product_name": "Misal Pav",
      "unit_price": 9000,
      "quantity": 2,
      "spice_level": "teekha",
      "note": "Less onion",
      "line_total": 18000
    },
    {
      "id": "oit_02",
      "order_id": "ord_01",
      "product_id": "prd_chaha",
      "product_name": "Kadak Chaha",
      "unit_price": 1500,
      "quantity": 2,
      "line_total": 3000
    }
  ]
}
```

- `status`: `PENDING_PAYMENT` → `CONFIRMED` → `PREPARING` → `OUT_FOR_DELIVERY` → `DELIVERED`, or `CANCELLED`
  - New COD orders start at `CONFIRMED`. New online orders start at `PENDING_PAYMENT`.
  - The customer can cancel only while `PENDING_PAYMENT` or `CONFIRMED`.
- `payment_status`: `"pending"` | `"paid"`
- `order_number` format: `WMH-YYYYMMDD-NNNN` (running number per day)
- `address_snapshot` is a **frozen copy** of the address at checkout (a JSON column), so
  later address edits don't change past orders.
- `product_name` and `unit_price` are snapshots taken at order time.

### 5.6 Profile screen

**`GET /me`** and **`PATCH /me`** use the **User** object from 5.2.
`PATCH /me` accepts any of `name`, `phone`, `email`.

**`GET /addresses`** returns `Address[]`. **`POST /addresses`** and
**`PATCH /addresses/:id`** accept the body below (no `id`, `user_id` or `city`)
and return the saved `Address`:

```json
{
  "label": "Home",
  "receiver_name": "Tushar Kulange",
  "receiver_phone": "9876543210",
  "line1": "Flat 12, Sai Residency",
  "line2": "Kothrud",
  "landmark": "Karishma Society",
  "pincode": "411038",
  "is_default": true
}
```

- `label`: `"Home"` | `"Work"` | `"Other"`
- `city` is always `"Pune"` (the only service city). The server sets it.
- Exactly **one** address per user should have `is_default: true`.

---

## 6. Business rules in the app

| Rule | Value | File |
|---|---|---|
| Kitchen hours | 7:00 AM – 2:00 PM (shows OPEN / CLOSED; orders are still allowed as pre-orders) | `src/utils/pricing.ts` |
| Delivery slots | Early Bird 7–8, Morning 8–9, Breakfast 9–10, Brunch 10–11, Lunch 12–1 | `src/utils/pricing.ts` |
| Same-day slot cut-off | A slot closes 30 minutes before it starts | `src/utils/pricing.ts` |
| Delivery fee / GST | ₹30 flat / 5% | `src/utils/pricing.ts` |
| Max quantity per add | 20 | `ProductCard.tsx`, `ProductDetailSheet.tsx` |
| Cooking note | max 120 characters | `SpiceLevelSheet.tsx` |
| Service area | Pune only | `src/types/index.ts` (`ServiceCity`) |

Menu prices come from `GET /products`.

---

## 7. Building the Android APK

Builds run on Expo's cloud service (EAS). The profiles are in `eas.json`:

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                   # first time only
npx eas-cli@latest build -p android --profile preview      # installable .apk
npx eas-cli@latest build -p android --profile production   # .aab for the Play Store
```

For each new release, raise `version` and `android.versionCode` in `app.json`.
The `android/` and `ios/` folders are generated by Expo (Continuous Native
Generation). Don't edit them by hand. Change `app.json` instead.
