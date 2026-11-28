# Wagheshwar Misal House — Mobile App

A food-ordering app for **Wagheshwar Misal House**, A/P Chandanzira, Jalna – Chh. Sambhajinagar
Highway, Jalna 431203 (address in `src/constants/shop.ts`). Customers browse the menu
(Misal, Thali, Vada Pav, Chaha), pick a spice level, choose a delivery slot and
place orders (Cash on Delivery or direct UPI).

> **Current status:** connected to the AWS backend (`../backend/`). Sign-up / login, the menu,
> saved addresses, orders, UPI payments and the kitchen/admin screens all use the live API.
> Still to come: menu photo upload, phone OTP login. Section 4 explains where the backend plugs in, and
> section 5 the JSON each screen expects.

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
│       ├── kitchen.tsx       # Admins: order board, Confirm + assign (hidden for others)
│       ├── deliveries.tsx    # Delivery boys: on duty, my deliveries (hidden for others)
│       └── profile.tsx       # Profile + saved addresses
├── components/               # Reusable UI (ProductCard, ProductDetailSheet, BottomSheet, …)
├── context/AppContext.tsx    # ★ Global state + every action that will become an API call
├── data/mock-data.ts         # Bundled images: logo, login background, fallback food photos
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

> Login uses the real backend: sign up with a real email (a 6-digit code is emailed), then log in.
> Password: 8+ characters with a lowercase letter and a number.

---

## 4. API integration

### 4.1 Where are the base URL and HTTP calls?

| File | Role |
|---|---|
| `.env` | `EXPO_PUBLIC_API_BASE_URL` for `npx expo start`. Public value; committed. |
| `eas.json` | The same variable for EAS cloud builds (`preview`, `production`). |
| `src/services/api.ts` | The only place that calls `fetch`. One function per endpoint; every failure becomes an `ApiError` with the backend's `code` and `message`. |
| `src/services/session.ts` | Tokens. The refresh token (30 days) is kept in the OS keystore with `expo-secure-store`; the ID token (1 hour) only in memory, renewed automatically. |
| `src/context/AppContext.tsx` | Screens call `useApp()`. Everything server-side calls the API; only the cart lives on the phone. |

**Live (Part 2):** sign-up, email-code confirmation, login, remembered login across restarts,
silent token refresh, forgot/reset password, `GET`/`PATCH /me`, logout (revokes the refresh token).

**Live (Part 3):** the menu. `GET /categories` + `GET /products` load at app start (no login needed);
Home shows a spinner, then the menu, or "Couldn't load the menu" with **Try again**. Pull down on Home
to refresh. Photos come from CloudFront (`image_url`); the photos bundled in the app show while they
load and if they fail. A menu refresh also updates prices / sold-out state of items already in the cart.

**Live (Part 4):** saved addresses. Loaded after login (`GET /addresses`); add / edit / delete /
set default call the API and then re-read the list, so the server decides which one is default.
Adding an address needs the phone's GPS position ("Use my current location", `expo-location`); the
form previews the distance from the hotel and the server refuses anything beyond 3 km. Pincode and
area are pre-filled from the position when empty. Delete asks for confirmation.

**Part 7c (delivery boys; backend plan ready, apply pending):** accounts in the Cognito `delivery` group
(how to add one: `backend/README.md` → "Add a delivery boy") get a **Deliveries** tab:
- an **On duty** switch (resets at midnight; needs a mobile number on the Account tab),
- their assigned orders with the customer's name and **Call**, the full address with a **map** button, the
  items, and how much cash to collect,
- **Picked up** → **Delivered** buttons (with a confirmation). New assignments appear by themselves (20 s refresh).

In the **Kitchen** tab, new cash orders arrive as **Waiting for hotel** (`PENDING`). **Confirm order**
(UPI: **Payment received · Confirm**) also assigns an on-duty delivery boy automatically (fewest active
deliveries first). If nobody is on duty the app says *No delivery boy available* and offers **Assign now**;
**Assign** / **Reassign** open a list of delivery boys (on duty first, active orders, phone, **Off duty**).
Tapping Confirm twice changes nothing. Admins can still tap Picked up / Mark delivered themselves.
Customers see *Delivery boy assigned* with his name and a **Call** button until it's delivered, and can
cancel only until a delivery boy is assigned.

**Live (Part 7):** direct UPI payments, no payment gateway. At checkout pick **UPI (pay now)**; after
placing, the **Pay** screen (`src/app/pay/[id].tsx`) shows the amount, the hotel's UPI ID, a **Pay with UPI
app** button (opens GPay / PhonePe / Paytm via the server's `upi://pay` link) and the same link as a **QR code**
(`react-native-qrcode-svg` + `react-native-svg`) for paying from another phone. After paying, the customer
types the **12-digit UTR** and taps *I've paid*; the hotel checks its UPI app and taps **Payment received** on the
Kitchen tab, and the order continues as usual. Unpaid orders (no UTR) are cancelled after 30 minutes. On the
Orders tab an unpaid UPI order has a **Pay now** button. Customers can't cancel once they've sent a UTR
(refund through the hotel). Nothing confirms payments automatically: there's no gateway.

**Live (Part 6):** kitchen and menu admin, for accounts in the Cognito `admin` group (how to add one:
`backend/README.md` → "Make someone an admin"; then log out and in). Admins get:
- a **Kitchen** tab (hidden for customers): today's or tomorrow's orders grouped by delivery slot, with
  what to cook (quantities, spice, notes), the receiver's name, a call button and a map button. One button
  per order moves it on: *Start preparing → Out for delivery → Mark delivered*. **Cancel** asks for a short
  reason that the customer sees. Counts at the top; re-checks every 20 s while open; pull down to refresh.
- **Account → Kitchen tools → Manage menu**: every category and dish, hidden ones too. A switch per dish
  for in stock / sold out; tap a dish or category to edit name, Marathi name, price, description, veg,
  spice levels, visible; add dishes and categories. New dishes use the category photo for now.
Customers see the new statuses through the Orders tab's polling, and a kitchen cancellation shows its reason.

**Live (Part 5):** orders. The Orders tab loads `GET /orders` after login (pull down to refresh) and
re-checks every 20 seconds while an order is in progress and the app is open. **Place Order** sends
the cart to `POST /orders` with an `Idempotency-Key` header: if the network drops and you tap again
with the same cart, the server returns the first order instead of making a second one. The server
re-checks everything (prices from the menu, slot, address, stock) and its message is shown above the
button if it refuses; if a dish has sold out, the menu reloads and the cart marks it **Sold out**.
Cancel asks for confirmation and calls `POST /orders/:id/cancel`. Cash on delivery only for now
("UPI / Online" shows as coming soon). Minimum order ₹100 of food: below that the cart says how much
to add and the button stays disabled.
Phone + OTP login is removed from the login screen until part 8.

### 4.2 Running against the backend

```powershell
npm install
npx expo start --clear     # scan the QR with Expo Go, or press "a" for the Android emulator
```

Change the API URL in `.env` (and `eas.json` for cloud builds), then restart with `--clear`.

### 4.3 Google Maps (address pin + hotel map)

- **Address form → Pin on map**: a full-screen map with the 3 km delivery circle around the hotel.
  The pin stays in the middle and the customer moves the map under it; *Confirm* only works inside
  the circle. *Use my current location* still works as before.
- **Account → Visit us**: a small map of the hotel and the delivery area, plus **Directions**
  (a plain Google Maps link: no API key, opens the Google Maps app).

Code: `src/components/maps/*.native.tsx` (phones) with empty `*.tsx` twins for web, where
`react-native-maps` (1.29.11, the SDK 58 version) doesn't exist; `src/utils/maps.ts`; `app.config.ts`.

**The Android key is not in Git.** `app.config.ts` reads `GOOGLE_MAPS_ANDROID_API_KEY` and writes it
into `AndroidManifest.xml` only; it is not copied into the public app config. Without a key the
app still works and the map buttons are hidden in standalone Android builds. Cost: Google lists
the mobile Maps SDK with unlimited free usage; Google still requires a billing account.

One-time setup in Google Cloud (console.cloud.google.com):

1. Create a project, attach a billing account.
2. *APIs & Services → Library* → enable **Maps SDK for Android**.
3. *APIs & Services → Credentials → Create credentials → API key*. Edit the key:
   - *Application restrictions* → **Android apps** → add package `com.wagheshwar.misalhouse` with the
     **SHA-1** of the app's signing certificate. Get it with
     `npx eas-cli@latest credentials -p android` (pick the build profile, read "SHA1 Fingerprint").
     When the app goes to the Play Store (part 10), also add Google Play's app-signing SHA-1.
   - *API restrictions* → **Restrict key** → only **Maps SDK for Android**.
4. Put the key where builds can read it (never in Git, never in chat):

   ```powershell
   # local builds (file is git-ignored via .env*.local)
   Set-Content -Path .env.local -Value "GOOGLE_MAPS_ANDROID_API_KEY=<your key>"
   # EAS cloud builds (preview + production profiles read these environments)
   npx eas-cli@latest env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value "<your key>" --environment preview --environment production --visibility sensitive
   ```

**Testing maps:** the key is locked to this app, so it can't work inside Expo Go (a different
app). Expo Go may still show a map using its own setup, or a blank grey map. Test maps in a
preview build: `npx eas-cli@latest build -p android --profile preview`, then install the APK.
A blank grey map in that build means the key is missing, restricted to the wrong package/SHA-1,
or *Maps SDK for Android* isn't enabled.

### 4.4 Endpoint map (planned endpoints, as named in the code comments)

| Screen | Action in code | Endpoint | Code location |
|---|---|---|---|
| Login | send OTP | `POST /auth/otp/send` | `src/app/login.tsx` |
| Login | `login()` | `POST /auth/login` (email) · `POST /auth/otp/verify` (phone) | `AppContext.tsx` → `LOGIN` |
| Profile | `logout()` | `POST /auth/logout` | `AppContext.tsx` → `LOGOUT` |
| Home | initial data | `GET /categories`, `GET /products` | **live** (`AppContext` → `loadCatalog`) |
| Home / Cart | store open? | `GET /store` (at start, on focus, when the app comes back) | **live** (`AppContext` → `loadStore`) |
| Profile | current user | `GET /me` | **live** (restored at startup) |
| Profile | `updateUser()` | `PATCH /me` | `AppContext.tsx` → `UPDATE_USER` |
| Profile / Cart | addresses list | `GET /addresses` | **live** (`AppContext` → `loadAddresses`) |
| Profile / Cart | `saveAddress()` | `POST /addresses` (new) · `PATCH /addresses/:id` (edit) | **live** |
| Profile | `deleteAddress()` | `DELETE /addresses/:id` | **live** |
| Profile | `setDefaultAddress()` | `PATCH /addresses/:id` `{ "is_default": true }` | **live** |
| Cart | `placeOrder()` | `POST /orders` (+ `Idempotency-Key` header) | **live** |
| Orders | order history | `GET /orders` | **live** (`AppContext` → `loadOrders`) |
| Orders | live status | `GET /orders` every 20 s while an order is in progress | **live** (polling) |
| Orders | `cancelOrder()` | `POST /orders/:id/cancel` | **live** |
| Pay (UPI) | `submitPayment()` | `POST /orders/:id/payment` `{utr}` | **live** (`src/app/pay/[id].tsx`) |
| Kitchen (admins) | order board | `GET /admin/orders?date=` | **live** (`src/app/(tabs)/kitchen.tsx`) |
| Kitchen (admins) | Confirm (+ auto-assign) / next step / cancel | `POST /admin/orders/:id/status` | **live** |
| Kitchen (admins) | assign / reassign | `GET /admin/delivery-boys`, `POST /admin/orders/:id/assign` | Part 7c (`AssignSheet.tsx`) |
| Kitchen (admins) | take a delivery boy off duty | `PATCH /admin/delivery-boys/:id` `{on_duty: false}` | Part 7c (`AssignSheet.tsx`) |
| Deliveries (delivery boys) | on duty | `GET /delivery/me`, `PATCH /delivery/me` `{on_duty}` | Part 7c (`src/app/(tabs)/deliveries.tsx`) |
| Deliveries (delivery boys) | my orders / Picked up / Delivered | `GET /delivery/orders`, `POST /delivery/orders/:id/status` | Part 7c |
| Kitchen (admins) | "Taking online orders" switch | `PATCH /admin/store` `{accepting_orders, message?}` | **live** (`AppContext` → `setAcceptingOrders`) |
| Manage menu (admins) | lists | `GET /admin/categories`, `GET /admin/products` | **live** (`src/app/admin-menu.tsx`) |
| Manage menu (admins) | add / edit | `POST`/`PATCH /admin/categories`, `POST`/`PATCH /admin/products` | **live** |

The cart is **client-side only** in v1. No cart endpoint is needed.

---

## 5. Expected JSON formats

### 5.1 Conventions (important)

| Rule | Detail |
|---|---|
| Field names | `snake_case`, matching database columns 1:1 |
| **Money** | **Integer paise** (₹1 = 100 paise). `9000` = ₹90.00. Never send decimals or rupees. |
| IDs | Strings (mock data uses prefixes like `usr_`, `adr_`, `cat_`, `prd_`, `ord_`, `oit_`; any unique string works) |
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

`name` is currently limited to `"Misal" | "Thali" | "Vada Pav" | "Chaha"`. To allow
other categories, widen the `CategoryName` type in `src/types/index.ts`.

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
- Images: `image_url` (CloudFront) is loaded. While it loads, and if it fails, the photo
  bundled for that product `id` (`PRODUCT_IMAGES` in `mock-data.ts`) is shown. If neither
  exists, a 🍽️ placeholder is shown.

**`GET /store`** (public, not cached) says whether the hotel is taking online orders:

```json
{ "accepting_orders": false, "message": "Hotel is closed today.", "opens_at": "09:00", "closes_at": "21:00" }
```

- `message` is `""` while open. While closed, Home and Cart show it in a red banner and
  Place Order is disabled.
- If an order is attempted anyway, `POST /orders` answers `409 STORE_CLOSED` with the same
  message; the app then re-reads `GET /store`.

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
  "slot_label": "Morning 10:00 - 11:00 AM",
  "payment_method": "cod",
  "items": [
    { "product_id": "prd_misal_pav", "quantity": 2, "spice_level": "teekha", "note": "Less onion" },
    { "product_id": "prd_chaha", "quantity": 2 }
  ]
}
```

- Header `Idempotency-Key`: a random string (8–64 of `A-Z a-z 0-9 _ -`), the same for retries of one checkout.
- `payment_method`: `"cod"` | `"online"` (= direct UPI: the order starts `PENDING_PAYMENT` with `upi_payment`)
- `spice_level`: `"mild"` | `"medium"` | `"teekha"`. Only for products with `has_spice_level: true`.
- `note`: optional, max 120 characters
- `delivery_date`: today or tomorrow in India time; `slot_label` exactly as `slotLabel()` builds it.
- Prices are **not** sent; the server takes them from the menu. Food subtotal must be at least ₹100.

Response: the created **Order** (see 5.5). Full rules and error codes: `backend/README.md`.

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
    "line1": "Plot 12, Sai Residency",
    "line2": "Ekta Nagar, Chandanzira",
    "landmark": "Panchamukhi Nagar",
    "city": "Jalna",
    "pincode": "431203",
    "latitude": 19.8605,
    "longitude": 75.8558,
    "distance_km": 0.57,
    "is_default": true
  },
  "delivery_date": "2026-11-13",
  "slot_label": "Morning 10:00 - 11:00 AM",
  "status": "PENDING",
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

- `status` (Part 7c): `PENDING` / `PENDING_PAYMENT` → `CONFIRMED` → `ASSIGNED` → `OUT_FOR_DELIVERY` → `DELIVERED`, or `CANCELLED`
  - New COD orders start at `PENDING` (waiting for the hotel). New online orders start at `PENDING_PAYMENT`.
  - The customer can cancel only while `PENDING`, `PENDING_PAYMENT` or `CONFIRMED` (before a delivery boy is assigned).
  - `PREPARING` only appears on orders placed before Part 7c.
  - Once assigned: `"delivery_boy": {"name": "Ramu", "phone": "9123456780"}` (only `name` once delivered).
- `payment_status`: `"pending"` | `"paid"`
- `order_number` format: `WMH-YYYYMMDD-NNNN` (running number per day)
- `address_snapshot` is a **frozen copy** of the address at checkout (a JSON column), so
  later address edits don't change past orders.
- `product_name` and `unit_price` are snapshots taken at order time.

### 5.6 Profile screen

**`GET /me`** and **`PATCH /me`** use the **User** object from 5.2.
`PATCH /me` accepts any of `name`, `phone`, `email`.

**`GET /addresses`** returns `Address[]` (default first). **`POST /addresses`** and
**`PATCH /addresses/:id`** accept the body below (no `id`, `user_id`, `city` or `distance_km`)
and return the saved `Address`, which adds `id`, `user_id`, `city: "Jalna"` and `distance_km`:

```json
{
  "label": "Home",
  "receiver_name": "Tushar Kulange",
  "receiver_phone": "9876543210",
  "line1": "Plot 12, Sai Residency",
  "line2": "Ekta Nagar, Chandanzira",
  "landmark": "Panchamukhi Nagar",
  "pincode": "431203",
  "latitude": 19.8605,
  "longitude": 75.8558,
  "is_default": true
}
```

- `label`: `"Home"` | `"Work"` | `"Other"`
- `latitude` / `longitude`: the phone's GPS position at the address. Must be within **3 km** of the
  hotel (Chandanzira, 19.856833, 75.851944), else `422 OUT_OF_DELIVERY_AREA`.
- `city` is always `"Jalna"` (set by the server); `pincode` must be `431xxx`.
- At most **5** addresses per user. Exactly **one** has `is_default: true`; the server keeps it that way.

---

## 6. Business rules in the app

| Rule | Value | File |
|---|---|---|
| Delivery hours | 9:00 AM – 9:00 PM (shows OPEN / CLOSED; outside these hours orders are pre-orders) | `src/utils/pricing.ts`, `src/constants/shop.ts` |
| Delivery slots | 12 one-hour slots: Morning 9–10, 10–11, 11–12 · Afternoon 12–1 … 4–5 · Evening 5–6 … 8–9. Labels must match `SLOTS` in `backend/src/orders.py` exactly | `src/utils/pricing.ts` |
| Online orders switch | Admins can stop all new orders (today and tomorrow) from the Kitchen tab, with an optional message. Stays off until an admin turns it back on. Home and Cart show a red banner and Place Order is disabled; the server refuses with `409 STORE_CLOSED` | `kitchen.tsx`, `StopOrdersSheet.tsx`, enforced by `backend/src/store.py` |
| Same-day slot cut-off | A slot closes 30 minutes before it starts | `src/utils/pricing.ts` |
| Delivery fee / GST | ₹30 flat / 5% | `src/utils/pricing.ts` |
| Minimum order | ₹100 of food (before delivery and GST) | `src/utils/pricing.ts`, enforced by `backend/src/orders.py` |
| Time zone | Slots, "today" and kitchen hours use India time (IST) even if the phone is set to another zone | `src/utils/pricing.ts` |
| Payment | Cash on delivery, or direct UPI: pay by link/QR, send the UTR, the hotel confirms; unpaid UPI orders cancel after 30 min | `cart.tsx`, `pay/[id].tsx`, enforced by the server |
| Cancelling | Customers: only while Pending / Confirmed (before a delivery boy is assigned) and not after sending a UPI UTR. Kitchen: until delivered, with a reason | `AppContext.tsx` → `isCancellable`, enforced by the server |
| Order steps | One at a time: Pending → Confirmed (auto-assign) → Assigned → Out for delivery (delivery boy: Picked up) → Delivered | `KitchenOrderCard.tsx` → `NEXT_STEP`, `deliveries.tsx`, enforced by the server |
| Delivery boys | Only on-duty ones get orders automatically (fewest active first); on duty resets at midnight; a delivery boy sees only his own orders, with phone and address only while delivering | `backend/src/delivery_boys.py`, `delivery.py` |
| Max quantity per add | 20 | `ProductCard.tsx`, `ProductDetailSheet.tsx` |
| Cooking note | max 120 characters | `SpiceLevelSheet.tsx` |
| Service area | Within 3 km (straight line) of the hotel, Chandanzira, Jalna | `src/constants/shop.ts`, enforced by `backend/src/addresses.py` |
| Saved addresses | Max 5 per user, exactly one default | enforced by `backend/src/addresses.py` |

Menu prices come from `GET /products` (seeded from `backend/terraform/menu_seed.tf`; the seed
prices are still placeholders).

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
