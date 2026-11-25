# Wagheshwar Misal House — backend

AWS backend for the app in `../wageshwari_misal_house/`. Region **ap-south-1 (Mumbai)**,
one environment, managed with **Terraform**. Python 3.13 Lambdas on arm64.

Status:
- **Part 1, auth**: deployed 2026-11-18.
- **Part 3, menu + photos**: deployed 2026-11-24. API `https://cyfnnlsjga.execute-api.ap-south-1.amazonaws.com`, photos `https://d2n5hm5b49hk3p.cloudfront.net`.
- **Part 4, saved addresses**: 3 km GPS delivery area around the hotel (19.856833, 75.851944).
- **Part 5, orders**: place / list / view / cancel. Cash on delivery only, ₹100 minimum, India-time slots.

```
backend/
├── src/                     Lambda code (source of truth)
│   ├── common.py            errors, responses, body parsing, JWT claims, validators
│   ├── users.py             profile item in DynamoDB
│   ├── auth.py              /auth/* routes
│   ├── me.py                /me routes
│   ├── catalog.py           /categories, /products (the menu)
│   ├── addresses.py         /addresses (saved delivery addresses, 3 km check)
│   └── orders.py            /orders (place, list, view, cancel)
├── tests/                   pytest + moto (no AWS account touched)
├── scripts/
│   ├── gen_lambda_sources.py   src/*.py  ->  terraform/lambda_src_*.tf
│   ├── verify-auth.ps1         end-to-end check of auth against the deployed API
│   ├── verify-catalog.ps1      check of the menu API + CloudFront photos
│   ├── verify-addresses.ps1    check of the addresses API with a real account
│   └── verify-orders.ps1       places one real order for tomorrow, then cancels it
└── terraform/               all infrastructure (menu_seed.tf = the starting menu)
```

## What gets created (71 resources)

| AWS piece | Name | What it does |
|---|---|---|
| Cognito User Pool | `wmh-users` | The user directory. Stores emails and password hashes, emails the confirmation and reset codes, issues JWTs. |
| Cognito app client | `wmh-app` | How the mobile app identifies itself to the pool. Public (no secret), because anything in an APK can be extracted. |
| Cognito group | `admin` | Members get `role: "admin"` (used from Part 6). |
| DynamoDB table | `wmh-main` | One table for the whole app (`PK`/`SK`). Profiles (`USER#<sub>`/`PROFILE`), addresses (`ADDRESS#…`), orders (`ORDER#…`), the menu (`CATALOG`/`CATEGORY#…`, `PRODUCT#…`), the daily order counter (`COUNTER`/`ORDER#<date>`) and "no double orders" records (`IDEMP#…`). On-demand billing, point-in-time recovery, **TTL** on `expires_at` (DynamoDB deletes those records itself, free, some hours after they expire). |
| Menu rows | 4 categories, 6 products | Written once by `menu_seed.tf`; Terraform ignores later edits so admin changes (Part 6) stick. |
| IAM role | `wmh-lambda` | What the Lambdas may do: write their logs; get/put/update/query/delete items in `wmh-main`. Nothing else. |
| Lambda | `wmh-auth`, `wmh-me`, `wmh-catalog`, `wmh-addresses`, `wmh-orders` | The handlers. Routing by `event["routeKey"]`. All get the hotel's location and delivery radius as env vars (`SHOP_LATITUDE`, `SHOP_LONGITUDE`, `DELIVERY_RADIUS_KM`, `SHOP_CITY`) from `variables.tf`; `wmh-orders` also gets `MIN_ORDER_PAISE`. |
| API Gateway HTTP API | `wmh-api` | Public HTTPS front door. 20 routes, a JWT authorizer on `/me`, `/addresses` and `/orders`, throttled to 50 req/s (burst 100). |
| S3 bucket | `wmh-media-630287363216` | Menu photos under `menu/`. Fully private: all public access blocked. |
| CloudFront | `d2n5hm5b49hk3p.cloudfront.net` | CDN in front of the bucket (price class 200, includes India). The only reader of the bucket, via Origin Access Control. |
| CloudWatch log groups | `/aws/lambda/wmh-*`, `/aws/apigateway/wmh-api` | 14-day retention. Access logs never include headers or bodies. |

## Endpoints

Base URL: the `api_base_url` Terraform output. Errors are always
`{"error": {"code": "...", "message": "..."}}`.

| Route | Auth | Body | Success |
|---|---|---|---|
| `POST /auth/register` | – | `{name, email, password, phone}` | `201 {user_confirmed: false, code_delivery: {medium, destination}}` |
| `POST /auth/confirm` | – | `{email, code}` | `200 {confirmed: true}` |
| `POST /auth/resend-code` | – | `{email}` | `200 {code_delivery}` |
| `POST /auth/login` | – | `{email, password}` | `200 {token, refresh_token, expires_in, user}` |
| `POST /auth/refresh` | – | `{refresh_token}` | `200 {token, expires_in}` |
| `POST /auth/logout` | – | `{refresh_token}` | `204` |
| `POST /auth/password/forgot` | – | `{email}` | `200 {message}` (same answer whether or not the account exists) |
| `POST /auth/password/reset` | – | `{email, code, new_password}` | `200 {password_reset: true}` |
| `GET /me` | JWT | – | `200 User` |
| `PATCH /me` | JWT | `{name?, phone?}` | `200 User` |
| `GET /categories` | – | – | `200 Category[]`: active only, by `sort_order` |
| `GET /products` | – | – | `200 Product[]`: sold-out ones included (`is_available: false`) |
| `GET /addresses` | JWT | – | `200 Address[]`: default first, then oldest first |
| `POST /addresses` | JWT | `{label, receiver_name, receiver_phone, line1, line2?, landmark?, pincode, latitude, longitude, is_default?}` | `201 Address` |
| `PATCH /addresses/{id}` | JWT | any of the POST fields (`latitude` + `longitude` together) | `200 Address` |
| `DELETE /addresses/{id}` | JWT | – | `204` |
| `POST /orders` | JWT + `Idempotency-Key` header | `{address_id, delivery_date, slot_label, payment_method, items: [{product_id, quantity, spice_level?, note?}]}` | `201 Order` |
| `GET /orders` | JWT | – | `200 Order[]`: newest first, latest 50 |
| `GET /orders/{id}` | JWT | – | `200 Order` |
| `POST /orders/{id}/cancel` | JWT | – | `200 Order` (already cancelled → same answer) |

Menu responses carry `Cache-Control: public, max-age=60`, so menu edits show up within a minute.

`token` is the Cognito **ID token**. Send it as `Authorization: Bearer <token>`.
`User` is exactly `src/types/index.ts` → `User`: `{id, name, phone, email, role, is_active}`.

Address rules (all enforced by the server):
- **Delivery area**: the GPS position must be within **3 km** (straight line) of the hotel,
  19.856833, 75.851944 (Chandanzira). Otherwise `422 OUT_OF_DELIVERY_AREA`; no position →
  `400 LOCATION_REQUIRED`. Change the radius or the hotel position in `terraform/variables.tf`.
- `city` is always `"Jalna"`; pincode must be `431xxx`; at most **5** addresses (`409 ADDRESS_LIMIT`).
- **Exactly one default**, stored once as `default_address_id` on the user's profile item. The first
  address becomes default; deleting the default promotes the oldest remaining one; sending
  `is_default: false` for the current default is ignored (pick another default instead).
- `Address` responses add `distance_km` (from the hotel) and omit empty `line2` / `landmark`.
- Another user's address id answers `404`, same as one that doesn't exist.

Order rules (all enforced by the server; the app shows the same ones):
- **Prices come from the menu in the table.** The app sends only product ids and quantities. Each
  order stores a frozen copy of the dish names/prices (`items`) and of the address (`address_snapshot`).
- **Bill**: subtotal + ₹30 delivery + 5% GST on the subtotal, rounded half up, integer paise.
- **Minimum order ₹100 of food** (subtotal, before delivery and GST) → else `422 BELOW_MINIMUM_ORDER`.
  Change `min_order_paise` in `terraform/variables.tf` (and `MIN_ORDER_PAISE` in the app's `pricing.ts`).
- **Cash on delivery only** until Part 7: `payment_method: "online"` → `400 PAYMENT_METHOD_UNAVAILABLE`.
  COD orders start `CONFIRMED`, `payment_status: "pending"`.
- **Dates in India time** (IST, fixed +05:30): today or tomorrow only; a slot for today closes 30 minutes
  before it starts → `409 SLOT_UNAVAILABLE`. `slot_label` must be one of the app's five labels exactly.
- **Items**: 1–20 lines, quantity 1–20, `spice_level` only on dishes with spice levels, `note` ≤ 120 chars.
  Unknown or sold-out dish → `409 PRODUCT_UNAVAILABLE` (the app reloads the menu).
- **Address** must be yours (`404`) and still inside the delivery area (`422 OUT_OF_DELIVERY_AREA`).
- **Order number** `WMH-YYYYMMDD-NNNN` from an atomic per-day counter (IST date of placing). A failed
  request after the counter step can leave a gap in the numbers; numbers are never reused.
- **No double orders**: the same `Idempotency-Key` + same body within 24 h returns the first order
  (`Idempotent-Replayed: true` header); same key + different body → `409 IDEMPOTENCY_CONFLICT`. The order
  and the key record are written in one DynamoDB transaction, so two simultaneous retries can't both win.
- **Cancel** only while `PENDING_PAYMENT` or `CONFIRMED` → else `409 ORDER_NOT_CANCELLABLE`.
- Stored but not returned: `GSI1PK = ORDERDATE#<delivery_date>`, `GSI1SK = <slot hour>#<created_at>#<id>`,
  ready for the Part 6 kitchen index ("all orders for a day, by slot") without a data migration.

Error codes the app should handle: `VALIDATION_ERROR`, `INVALID_JSON`, `WEAK_PASSWORD`,
`EMAIL_TAKEN` (409), `USER_NOT_CONFIRMED` (403 → show the code screen), `INVALID_CODE`,
`CODE_EXPIRED`, `ALREADY_CONFIRMED` (409), `INVALID_CREDENTIALS` (401),
`INVALID_REFRESH_TOKEN` (401 → log out locally), `TOO_MANY_REQUESTS` (429),
`OUT_OF_DELIVERY_AREA` (422), `LOCATION_REQUIRED`, `ADDRESS_LIMIT` (409),
`BELOW_MINIMUM_ORDER` (422), `PAYMENT_METHOD_UNAVAILABLE`, `SLOT_UNAVAILABLE` (409),
`PRODUCT_UNAVAILABLE` (409), `IDEMPOTENCY_CONFLICT` (409), `ORDER_NOT_CANCELLABLE` (409), `CONFLICT` (409),
`EMAIL_DELIVERY_FAILED` (502), `EMAIL_CHANGE_NOT_SUPPORTED`, `CHALLENGE_REQUIRED`,
`UNAUTHORIZED`, `NOT_FOUND`, `INTERNAL`.

### Different from the original plan / README

- **`POST /auth/resend-code` added.** With real email confirmation, users need a way to get a new code.
- **`POST /auth/logout` is public**, not behind the JWT authorizer. Revoking needs the refresh token itself
  (that's the secret), and a public route still works after the 1-hour ID token has expired.
- **`PATCH /me` rejects `email`** with `EMAIL_CHANGE_NOT_SUPPORTED`. Email is the sign-in identity; changing it
  needs a verify-the-new-address flow. The app README (§5.6) lists `email` as patchable; that's not built yet.
- **Handlers were rewritten**, not reused. The Part 1 SAM code was never pushed and couldn't be read.

## Decisions (defaults agreed 2026-11-18)

| Decision | Choice | Consequence |
|---|---|---|
| Sign-in identity | Email is the Cognito username, case-insensitive | Fixed when the pool is created; changing it later means a new pool. |
| Password policy | 8+ chars, a lowercase letter and a number | No uppercase/symbol requirement. |
| Phone | Stored only in DynamoDB, not in Cognito | Cognito's `phone_number` stays free for OTP login (Part 8). |
| Confirmation | Real email code; no auto-confirm | Each test signup needs a real inbox (use Gmail `+aliases`). |
| Email sender | Cognito built-in | ~50 emails/day, from `no-reply@verificationemail.com`. Move to SES before launch (Part 10). |
| Deletion protection | On for the user pool and the table | `terraform destroy` fails until switched off by hand. |
| Logout | Revoke this device's refresh token only | Other devices stay signed in. |
| Token lifetimes | ID 60 min, refresh 30 days | The app refreshes silently; users re-log in after 30 idle days. |
| Names | `wmh-*`, no environment suffix | One environment. |
| State | S3 `tfstate-630287363216-ap-south-1`, S3-native locking | No DynamoDB lock table needed (Terraform ≥ 1.10). |

## How the Terraform is run

Terraform runs in a remote workspace reached through the AWS MCP server (`init`, `validate`,
`plan`, `apply` the saved plan). That workspace only accepts `.tf`/`.tfvars` files and rejects
uploads over ~8 KB. So the Python code is embedded in `.tf` files:

- `scripts/gen_lambda_sources.py` splits each `src/*.py` into ≤3 KB heredoc chunks
  (`terraform/lambda_src_*.tf`), and `terraform/lambda_sources.tf` joins them back.
- `lambda.tf` zips the joined strings with `archive_file` (this replaces `sam build`).
- The `lambda_source_sha256` output proves the deployed code is byte-identical to `src/`.
- `tests/test_lambda_sources.py` fails if you edit a handler and forget to regenerate.

**After changing any handler:**

```powershell
python backend\scripts\gen_lambda_sources.py
python -m pytest backend\tests -q
```

The same `terraform/` folder also works from your own machine:

```powershell
cd backend\terraform
$env:AWS_PROFILE = "wmh"
terraform init
terraform plan -out tfplan
terraform apply tfplan
terraform output
```

## Tests

```powershell
cd backend
python -m pip install -r requirements-dev.txt
python -m pytest -q
```

161 tests. moto doesn't implement `revoke_token` or `resend_confirmation_code`; those two are tested
with mocks, and `verify-auth.ps1` checks them for real.

## Verify after deploy

```powershell
cd backend\terraform
terraform output api_base_url      # or read it from the apply output

cd ..\..
.\backend\scripts\verify-auth.ps1 -ApiBaseUrl <api_base_url> -Email you+wmh1@gmail.com
```

It registers a real user (asks you for a password), waits for you to paste the emailed code,
then checks confirm, login, `/me`, refresh, logout and revocation — 17 checks, PASS/FAIL each.

The menu needs no login:

```powershell
.\backend\scripts\verify-catalog.ps1
```

It checks both menu routes against the contract, that every photo loads from CloudFront as
`image/jpeg`, and that the bucket refuses direct access.

Addresses need a confirmed account; the script deletes everything it creates:

```powershell
.\backend\scripts\verify-addresses.ps1 -Email you+wmh1@gmail.com
```
Orders need a confirmed account. The script places **one real order** (tomorrow, Morning, cash) and
cancels it, so one cancelled order stays in that account's history:

```powershell
.\backend\scripts\verify-orders.ps1 -Email you+wmh1@gmail.com
```

If PowerShell blocks a script: `Set-ExecutionPolicy -Scope Process Bypass`.

Logs, if something fails:

```powershell
aws logs tail /aws/lambda/wmh-auth --since 15m --profile wmh --region ap-south-1
aws logs tail /aws/lambda/wmh-catalog --since 15m --profile wmh --region ap-south-1
aws logs tail /aws/lambda/wmh-addresses --since 15m --profile wmh --region ap-south-1
aws logs tail /aws/lambda/wmh-orders --since 15m --profile wmh --region ap-south-1
aws logs tail /aws/apigateway/wmh-api --since 15m --profile wmh --region ap-south-1
```

## Cost at this stage

Effectively ₹0 at low traffic: Cognito (first 10,000 monthly active users free), Lambda and API
Gateway free tiers, DynamoDB on-demand pay-per-request, a few cents of CloudWatch logs.
Point-in-time recovery is billed per GB stored, which is tiny here. CloudFront's free tier
covers 1 TB of transfer a month; the photos in S3 cost paise.

## Changing the menu (until the admin screen in Part 6)

The starting menu is in `terraform/menu_seed.tf`, but Terraform only writes it **once**: editing that file
does not change existing rows. Until Part 6, change a dish in the AWS console: DynamoDB → Tables →
`wmh-main` → Explore items → filter `PK = CATALOG` → edit the row (prices are integer paise, `9000` = ₹90;
set `is_available` to `false` for "Sold out"). The app picks it up within a minute (pull down on Home to refresh).
