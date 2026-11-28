"""Shared helpers for every Lambda: errors, responses, body parsing, JWT claims, validators.

Conventions (see wageshwari_misal_house/README.md section 5.1):
- JSON is snake_case.
- Errors are always {"error": {"code": "...", "message": "..."}}.
- The user id is the Cognito `sub` from the verified JWT. It never comes from the request body.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from decimal import Decimal
from typing import Any, Callable

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))


# ---------------------------------------------------------------------------
# Errors and responses
# ---------------------------------------------------------------------------
class ApiError(Exception):
    """Raise anywhere in a handler; `dispatch` turns it into an error response."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _json_default(value: Any) -> Any:
    # DynamoDB returns numbers as Decimal; money is integer paise, so int is right.
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Not JSON serializable: {type(value).__name__}")


def response(status: int, body: Any = None, headers: dict | None = None) -> dict:
    """HTTP API (payload v2.0) response."""
    resp: dict = {"statusCode": status, "headers": {"Content-Type": "application/json", **(headers or {})}}
    if body is not None:
        resp["body"] = json.dumps(body, default=_json_default, ensure_ascii=False)
    return resp


def error_response(err: ApiError) -> dict:
    return response(err.status, {"error": {"code": err.code, "message": err.message}})


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------
def parse_body(event: dict) -> dict:
    """Return the JSON object body, or raise 400. An empty body counts as {}."""
    raw = event.get("body")
    if raw is None or raw == "":
        return {}
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(400, "INVALID_JSON", "Request body is not valid UTF-8.") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(400, "INVALID_JSON", "Request body is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise ApiError(400, "INVALID_JSON", "Request body must be a JSON object.")
    return data


def jwt_claims(event: dict) -> dict:
    """Claims API Gateway's JWT authorizer already verified. Raises 401 if absent."""
    claims = (
        event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims")
    )
    if not claims or not claims.get("sub"):
        raise ApiError(401, "UNAUTHORIZED", "Missing or invalid token.")
    return claims


def current_user_id(event: dict) -> str:
    return jwt_claims(event)["sub"]


def groups_from_claims(claims: dict) -> list[str]:
    """`cognito:groups` arrives as a list in a decoded token, or as a string via API Gateway
    (e.g. "[admin customer]" or "admin")."""
    raw = claims.get("cognito:groups")
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(g) for g in raw]
    return [g for g in str(raw).strip("[]").replace(",", " ").split() if g]


def role_from_claims(claims: dict) -> str:
    return "admin" if "admin" in groups_from_claims(claims) else "customer"


STAFF_GROUPS = ("admin", "delivery")


def roles_from_claims(claims: dict) -> list[str]:
    """Staff groups the user is in, e.g. ["admin", "delivery"] (part 7c). Customers: []."""
    groups = set(groups_from_claims(claims))
    return [g for g in STAFF_GROUPS if g in groups]


def dispatch(routes: dict[str, Callable[[dict], dict]], event: dict) -> dict:
    """Route by HTTP API routeKey (e.g. "POST /auth/login") and map errors."""
    route_key = event.get("routeKey", "")
    handler = routes.get(route_key)
    if handler is None:
        return error_response(ApiError(404, "NOT_FOUND", f"No route for {route_key}."))
    try:
        return handler(event)
    except ApiError as err:
        if err.status >= 500:
            logger.error("ApiError %s on %s: %s", err.code, route_key, err.message)
        return error_response(err)
    except Exception:  # noqa: BLE001 - last-resort guard; never leak internals
        logger.exception("Unhandled error on %s", route_key)
        return error_response(ApiError(500, "INTERNAL", "Something went wrong."))


# ---------------------------------------------------------------------------
# Validators (each returns the cleaned value or raises 400)
# ---------------------------------------------------------------------------
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^[6-9]\d{9}$")  # 10-digit Indian mobile, no +91
_CODE_RE = re.compile(r"^\d{6}$")  # Cognito email codes are 6 digits

PASSWORD_MIN_LENGTH = 8


def require_str(body: dict, field: str, *, max_len: int = 256) -> str:
    value = body.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is required.")
    if len(value) > max_len:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is too long.")
    return value


def validate_email(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", "`email` is required.")
    email = value.strip().lower()
    if len(email) > 254 or not _EMAIL_RE.match(email):
        raise ApiError(400, "VALIDATION_ERROR", "`email` is not a valid email address.")
    return email


def validate_phone(value: Any) -> str:
    if not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", "`phone` is required.")
    phone = value.strip()
    if not _PHONE_RE.match(phone):
        raise ApiError(
            400, "VALIDATION_ERROR", "`phone` must be a 10-digit Indian mobile number, without +91."
        )
    return phone


def validate_name(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, "VALIDATION_ERROR", "`name` is required.")
    name = " ".join(value.split())
    if len(name) > 60:
        raise ApiError(400, "VALIDATION_ERROR", "`name` must be at most 60 characters.")
    return name


def validate_password(value: Any, field: str = "password") -> str:
    """Mirror of the Cognito policy (8+ chars, a lowercase letter, a number), so the app
    gets a clear message before Cognito is called. Cognito still enforces it."""
    if not isinstance(value, str) or not value:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is required.")
    if (
        len(value) < PASSWORD_MIN_LENGTH
        or len(value) > 256
        or not re.search(r"[a-z]", value)
        or not re.search(r"\d", value)
    ):
        raise ApiError(
            400,
            "WEAK_PASSWORD",
            "Password must be at least 8 characters and include a lowercase letter and a number.",
        )
    return value


def validate_code(value: Any) -> str:
    if not isinstance(value, str) or not _CODE_RE.match(value.strip()):
        raise ApiError(400, "VALIDATION_ERROR", "`code` must be the 6-digit code from the email.")
    return value.strip()


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ApiError(500, "MISCONFIGURED", f"Missing environment variable {name}.")
    return value
