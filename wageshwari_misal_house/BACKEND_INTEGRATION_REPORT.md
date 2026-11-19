# Backend integration report

**Date:** 2026-11-18 · **App branch:** `feature/dynamic-endpoints` · **Backend checked:** `main` @ `83b676a`
and the deployed API `https://cyfnnlsjga.execute-api.ap-south-1.amazonaws.com`

The app no longer has any mock data. Every screen now calls the backend. Auth and `/me` work
today. **The menu, addresses and orders endpoints don't exist in the backend yet.** The deployed
API returns `404 {"message":"Not Found"}` for `/categories`, `/products`, `/addresses` and
`/orders`. Until they are deployed, the app shows *"This feature isn't available on the server
yet"* with a Retry button on those screens, and **nobody can place an order**.

This report lists what the app now calls, in the exact shape it expects, plus a few changes
needed in the existing backend.

---

## 1. Status at a glance

| Area | App | Backend | Blocking? |
|---|---|---|---|
| Auth (`/auth/*`) | ✅ wired | ✅ deployed | – |
| Profile (`GET`/`PATCH /me`) | ✅ wired | ✅ deployed (add `created_at`, §3.1) | No |
| Menu (`GET /categories`, `GET /products`) | ✅ wired | ❌ missing (Part 3) | **Yes**: home screen is empty |
| Addresses (`/addresses`) | ✅ wired | ❌ missing (Part 4) | **Yes**: checkout needs an address |
| Orders (`/orders`) | ✅ wired | ❌ missing (Part 5) | **Yes**: can't order |
| IAM for the new tables/queries | – | ❌ only Get/Put/Update allowed (§3.2) | Yes, for Parts 4–5 |
| CORS | – | ❌ not configured (§3.3) | Only for the **web** build |
| Online payment (UPI) | UI only | ❌ no gateway (§4.1) | Online orders stay unpaid |
| Moving orders through the kitchen statuses | Polls every 20 s | ❌ nothing changes status (§4.2) | Orders stay `CONFIRMED` |

---

## 2. Endpoints the app now calls

Conventions are unchanged from the app README §5.1: snake_case, **money in integer paise**,
string ids, errors as `{"error": {"code", "message"}}`. Every request carries
`Authorization: Bearer <id token>`, so these routes can sit behind the existing JWT authorizer.
The user id always comes from the token's `sub`, never from the body.

**List responses:** the app accepts a plain array **or** `{"items": [...]}`. Use the second form
if you want to add `next_cursor` pagination later; the app ignores extra keys.

### 2.1 Menu (Part 3)

| Route | Response |
|---|---|
| `GET /categories` | `Category[]` |
| `GET /products` | `Product[]` |

```jsonc
// Category
{ "id": "cat_misal", "name": "Misal", "name_mr": "मिसळ", "image_url": "https://…/misal.jpg",
  "sort_order": 1, "is_active": true }

// Product
{ "id": "prd_misal_pav", "category_id": "cat_misal", "name": "Misal Pav", "name_mr": "मिसळ पाव",
  "description": "…", "price": 9000, "image_url": "https://…", "is_veg": true,
  "has_spice_level": true, "is_available": true }
```

- The app hides categories with `is_active: false` and sorts by `sort_order`. Products in an
  inactive category are hidden. `is_available: false` shows "Sold out".
- **Seed ids:** please seed with `cat_misal`, `cat_thali`, `cat_vadapav`, `cat_chaha` and
  `prd_misal_pav`, `prd_special_thali`, `prd_misal_thali`, `prd_kolhapuri_misal`, `prd_vada_pav`,
  `prd_chaha`. The app ships food photos for those ids and uses them when `image_url` is missing
  or fails to load. Any other ids still work, but show a 🍽️ placeholder until real images exist.
- **Prices:** the old mock prices were placeholders (Misal Pav ₹90, Special Thali ₹180, Misal
  Thali ₹150, Kolhapuri ₹110, Vada Pav ₹25, Chaha ₹15). Real prices must come from the owner.
- **Images:** `cdn.wagheshwarmisal.in` (used in the old mock data) doesn't exist. An S3 bucket +
  CloudFront, or public S3 URLs, would do.

### 2.2 Addresses (Part 4)

| Route | Body | Response |
|---|---|---|
| `GET /addresses` | – | `Address[]` |
| `POST /addresses` | `AddressBody` | `201 Address` |
| `PATCH /addresses/{id}` | partial `AddressBody` | `200 Address` |
| `DELETE /addresses/{id}` | – | `204` |

```jsonc
// AddressBody (what the app sends)
{ "label": "Home", "receiver_name": "Asha Patil", "receiver_phone": "9876543210",
  "line1": "Flat 12, Sai Residency", "line2": "Kothrud", "landmark": null,
  "pincode": "411038", "is_default": true }

// Address (what the app expects back) = AddressBody + server-owned fields
{ "id": "…", "user_id": "<cognito sub>", "city": "Pune", …AddressBody }
```

Rules the app relies on:

- **`line2` and `landmark` are sent as `null` when empty**, including on PATCH. `null` must
  *clear* the field, so a user can delete a landmark.
- `city` is always `"Pune"` and set by the server. The app never sends it.
- **Exactly one default per user.** When an address is saved with `is_default: true`, unset the
  others in the same request (a DynamoDB transaction). The first address a user adds is sent with
  `is_default: true`.
- **Deleting the default:** promote another address (e.g. the newest) to default. The app
  re-fetches `GET /addresses` after every delete, so it will pick that up.
- Set default = `PATCH /addresses/{id}` with just `{"is_default": true}`.
- Accessing another user's address returns `404 NOT_FOUND`, not 403.
- Validation, mirroring the app: `label` ∈ `Home|Work|Other`; `receiver_phone` `^[6-9]\d{9}$`
  (already `validate_phone` in `common.py`); `pincode` `^41[0-2]\d{3}$`; `line1` 5+ chars;
  `receiver_name` required. Suggest a cap of ~10 addresses per user.

### 2.3 Orders (Part 5)

| Route | Body | Response |
|---|---|---|
| `GET /orders` | – | `Order[]`, newest first |
| `GET /orders/{id}` | – | `Order` (not called yet; useful for push notifications later) |
| `POST /orders` | see below + header `Idempotency-Key` | `201 Order` |
| `POST /orders/{id}/cancel` | – | `200 Order` |

```jsonc
// POST /orders
{
  "address_id": "…",
  "delivery_date": "2026-11-19",            // YYYY-MM-DD
  "slot_label": "Morning 8:00 - 9:00 AM",
  "payment_method": "cod",                  // "cod" | "online"
  "items": [
    { "product_id": "prd_misal_pav", "quantity": 2, "spice_level": "teekha", "note": "Less onion" },
    { "product_id": "prd_chaha", "quantity": 2 }
  ]
}
```

The full `Order` shape is in the app README §5.5 and `src/types/index.ts`. The server must:

1. **Price from the database, never from the app.** The app sends no prices. Snapshot
   `product_name` and `unit_price` into each item, and copy the address into `address_snapshot`.
2. **Use the same bill rules as the app's preview** (`src/utils/pricing.ts`):
   `subtotal = Σ unit_price × quantity`; `delivery_fee = 3000`; `tax = round(subtotal × 5%)`;
   `total = subtotal + delivery_fee + tax`. If these ever differ, the app shows one total in the cart
   and another on the order. See §5.1 for a way to keep them in sync.
3. **Validate:** the address belongs to the user; every product exists and `is_available`;
   `quantity` 1–20; `spice_level` ∈ `mild|medium|teekha`, only for products with
   `has_spice_level`; `note` ≤ 120 chars; `delivery_date` is today or tomorrow; the slot exists
   and, for today, starts more than 30 minutes from now. **Do the date and time checks in
   `Asia/Kolkata`.** Lambda runs in UTC.
4. **Starting status:** COD → `CONFIRMED`; online → `PENDING_PAYMENT`. `payment_status: "pending"`.
5. **`order_number`:** `WMH-YYYYMMDD-NNNN`, sequence per IST day. An atomic counter item
   (`PK=COUNTER`, `SK=ORDER#20261119`, `ADD seq :1`) is simplest.
6. **Idempotency:** the app sends `Idempotency-Key`. It is the same on every retry of one checkout
   and changes when the cart changes. Store key → order id (with a TTL of about 24 h). If the key
   is seen again, return the original order with `201` instead of creating a second one. This
   protects against a double order when the network times out after the server already saved it.
7. **Cancel:** only while `PENDING_PAYMENT` or `CONFIRMED`. Otherwise
   `409 ORDER_NOT_CANCELLABLE`. The app then re-fetches orders to show the real status.

**Error codes the app expects** (it shows `message` as-is, so make it user-friendly):

| Code | Status | When | What the app does |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | bad body | shows message |
| `NOT_FOUND` | 404 | address/order not the user's or missing | shows message |
| `PRODUCT_UNAVAILABLE` | 409 | item sold out or removed | shows message **and reloads the menu**, so the cart marks the item "Sold out" |
| `SLOT_UNAVAILABLE` | 409 | slot closed / bad date | shows message |
| `ORDER_NOT_CANCELLABLE` | 409 | cancel too late | shows message, reloads orders |

The app reloads the menu after any 400/409/422 from `POST /orders`, so these exact codes aren't
required, but a clear `message` is.

---

## 3. Changes needed in the existing backend

### 3.1 Add `created_at` to `User` (small)
`users.to_user()` drops `created_at`, but the profile item already stores it. The profile screen
used to show a hard-coded "Member since 2024". It now shows the year from `created_at` and hides
the line when the field is missing. Add `"created_at": item.get("created_at")` to `to_user()`.

### 3.2 IAM: the Lambda role can't list or delete yet
`terraform/iam.tf` allows only `GetItem`, `PutItem` and `UpdateItem`. Parts 4–5 need:

- `dynamodb:Query`: list a user's addresses and orders (`PK = USER#sub`, `begins_with(SK, …)`)
- `dynamodb:DeleteItem`: `DELETE /addresses/{id}`
- `dynamodb:TransactWriteItems` (and `ConditionCheckItem`): single-default swap, order + counter
  + idempotency record in one write
- `dynamodb:BatchGetItem` (optional): read all ordered products in one call
- If you add a GSI (e.g. for the admin "all orders by date" view in Part 6), also add
  `"${aws_dynamodb_table.main.arn}/index/*"` to `resources`.

### 3.3 CORS (only if the web build matters)
`aws_apigatewayv2_api.http` has no `cors_configuration`, so every call from the **web** build
(`npx expo start --web`) is blocked by the browser. Android and iOS are unaffected. If the web
build should work:

```hcl
cors_configuration {
  allow_origins = ["http://localhost:8081"]   # plus the production web origin
  allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
  allow_headers = ["authorization", "content-type", "idempotency-key"]
  max_age       = 3600
}
```

### 3.4 New routes in `apigw.tf`
All need `auth = true`: `GET /categories`, `GET /products`, `GET|POST /addresses`,
`PATCH|DELETE /addresses/{id}`, `GET|POST /orders`, `GET /orders/{id}`,
`POST /orders/{id}/cancel`. The menu routes could be public instead; the app sends a token
either way, and API Gateway ignores it on public routes.

---

## 4. Product gaps (need a decision, not only code)

### 4.1 Online / UPI payment has no gateway
The app offers "UPI / Online", but there is no payment integration (e.g. Razorpay, Cashfree).
Those orders will sit in `PENDING_PAYMENT` forever. The app shows *"Waiting for UPI payment
confirmation…"*. Options: build the gateway flow (order → gateway order id → app SDK → webhook
sets `paid` + `CONFIRMED`), or hide the Online option until then. Hiding it is a one-line change
in the app (`PAYMENT_OPTIONS` in `src/app/(tabs)/cart.tsx`).

### 4.2 Nothing moves orders past `CONFIRMED`
The old mock "kitchen" that advanced statuses is gone. The app now polls `GET /orders` every 20 s
while any order is in progress. Statuses will only change once the kitchen/admin side exists
(Part 6), or as a stopgap, a protected `PATCH /admin/orders/{id}` for the `admin` Cognito group.
Push notifications (Expo push tokens) would be nicer than polling later.

---

## 5. Still hard-coded in the app (suggested, not blocking)

These are business settings that live in `src/utils/pricing.ts`. The server will have its own
copy for validation (§2.3), so the two can drift.

### 5.1 Optional `GET /config`
```json
{
  "delivery_fee": 3000,
  "gst_rate_bps": 500,
  "kitchen_open_hour": 7,
  "kitchen_close_hour": 14,
  "same_day_cutoff_minutes": 30,
  "slots": [
    { "id": "slot_early", "name": "Early Bird", "time": "7:00 - 8:00 AM", "start_hour": 7 }
  ]
}
```
If you build this, the app can load it with the menu and drop its own copy. Tell me the final
shape and I'll wire it in. An alternative for the bill only is `POST /orders/quote` (same body as
`POST /orders`, returns the bill without saving).

### 5.2 Order body sends `slot_label`, not a slot id
The app sends the display string (`"Morning 8:00 - 9:00 AM"`), as the README contract says.
Validating a free-text label is fragile. If you'd rather receive `slot_id` (`"slot_morning"`),
say so; it's a small change on both sides. The response can keep `slot_label`.

---

## 6. How to test against the app

1. Deploy the new routes and set `EXPO_PUBLIC_API_BASE_URL` in `.env` (already points at the current API).
2. `npx expo start --clear`, then log in with a confirmed account.
3. Home loads the menu; Profile → "+ Add new" creates an address; Cart → place a COD order;
   Orders shows it and the Cancel button works while `CONFIRMED`.
4. Pull down on Home or Orders to re-fetch after changing data in DynamoDB.

Where the app calls each endpoint: `src/services/api.ts` (`catalogApi`, `addressApi`, `orderApi`),
used from `src/context/AppContext.tsx`.
