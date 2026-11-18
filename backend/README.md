# Wagheshwar Misal House — backend

AWS backend for the app in `../wageshwari_misal_house/`. Region **ap-south-1 (Mumbai)**,
one environment, managed with **Terraform**. Python 3.13 Lambdas on arm64.

Status: **Part 1 (auth) — written, tested, planned. Not applied yet.**

```
backend/
├── src/                     Lambda code (source of truth)
│   ├── common.py            errors, responses, body parsing, JWT claims, validators
│   ├── users.py             profile item in DynamoDB
│   ├── auth.py              /auth/* routes
│   └── me.py                /me routes
├── tests/                   pytest + moto (no AWS account touched)
├── scripts/
│   ├── gen_lambda_sources.py   src/*.py  ->  terraform/lambda_src_*.tf
│   └── verify-auth.ps1         end-to-end check against the deployed API
└── terraform/               all infrastructure
```

## What gets created (28 resources)

| AWS piece | Name | What it does |
|---|---|---|
| Cognito User Pool | `wmh-users` | The user directory. Stores emails and password hashes, emails the confirmation and reset codes, issues JWTs. |
| Cognito app client | `wmh-app` | How the mobile app identifies itself to the pool. Public (no secret), because anything in an APK can be extracted. |
| Cognito group | `admin` | Members get `role: "admin"` (used from Part 6). |
| DynamoDB table | `wmh-main` | One table for the whole app (`PK`/`SK`). Profiles now; addresses and orders later. On-demand billing, point-in-time recovery. |
| IAM role | `wmh-lambda` | What the Lambdas may do: write their logs; get/put/update items in `wmh-main`. Nothing else. |
| Lambda | `wmh-auth`, `wmh-me` | The handlers. Routing by `event["routeKey"]`. |
| API Gateway HTTP API | `wmh-api` | Public HTTPS front door. 10 routes, a JWT authorizer on `/me`, throttled to 50 req/s (burst 100). |
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

`token` is the Cognito **ID token**. Send it as `Authorization: Bearer <token>`.
`User` is exactly `src/types/index.ts` → `User`: `{id, name, phone, email, role, is_active}`.

Error codes the app should handle: `VALIDATION_ERROR`, `INVALID_JSON`, `WEAK_PASSWORD`,
`EMAIL_TAKEN` (409), `USER_NOT_CONFIRMED` (403 → show the code screen), `INVALID_CODE`,
`CODE_EXPIRED`, `ALREADY_CONFIRMED` (409), `INVALID_CREDENTIALS` (401),
`INVALID_REFRESH_TOKEN` (401 → log out locally), `TOO_MANY_REQUESTS` (429),
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

56 tests. moto doesn't implement `revoke_token` or `resend_confirmation_code`; those two are tested
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
If PowerShell blocks the script: `Set-ExecutionPolicy -Scope Process Bypass`.

Logs, if something fails:

```powershell
aws logs tail /aws/lambda/wmh-auth --since 15m --profile wmh --region ap-south-1
aws logs tail /aws/apigateway/wmh-api --since 15m --profile wmh --region ap-south-1
```

## Cost at this stage

Effectively ₹0 at low traffic: Cognito (first 10,000 monthly active users free), Lambda and API
Gateway free tiers, DynamoDB on-demand pay-per-request, a few cents of CloudWatch logs.
Point-in-time recovery is billed per GB stored, which is tiny here.
