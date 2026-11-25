"""Addresses Lambda: the signed-in user's delivery addresses. Every route sits behind the
JWT authorizer; the user id is always the token's `sub`, never the request body.

Routes
  GET    /addresses          -> Address[]  (default first, then oldest first)
  POST   /addresses          -> 201 Address
  PATCH  /addresses/{id}     -> 200 Address
  DELETE /addresses/{id}     -> 204

Rules
  - The address must be within DELIVERY_RADIUS_KM (straight line) of the hotel. The app sends
    the phone's GPS position (latitude/longitude) captured at the address.
  - City is always the shop's city (SHOP_CITY); the request can't change it.
  - At most MAX_ADDRESSES per user.
  - Exactly one default. It is stored once, as `default_address_id` on the user's PROFILE item,
    so two defaults are impossible. The first address becomes the default; deleting the default
    promotes the oldest remaining address.

Storage: PK = "USER#<sub>", SK = "ADDRESS#<id>".
"""

from __future__ import annotations

import math
import os
import re
import secrets
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key

import users
from common import ApiError, dispatch, jwt_claims, parse_body, response

MAX_ADDRESSES = 5
LABELS = ("Home", "Work", "Other")
_PINCODE_RE = re.compile(r"^431\d{3}$")  # Jalna / Chh. Sambhajinagar postal region
_PHONE_RE = re.compile(r"^[6-9]\d{9}$")  # 10-digit Indian mobile, no +91


def _shop() -> tuple[float, float, float, str]:
    """Hotel latitude, longitude, delivery radius (km) and city, from Lambda env vars."""
    return (
        float(os.environ.get("SHOP_LATITUDE", "19.856833")),
        float(os.environ.get("SHOP_LONGITUDE", "75.851944")),
        float(os.environ.get("DELIVERY_RADIUS_KM", "3")),
        os.environ.get("SHOP_CITY", "Jalna"),
    )


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle (straight-line) distance in km (haversine)."""
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _key(user_id: str, address_id: str) -> dict:
    return {"PK": f"USER#{user_id}", "SK": f"ADDRESS#{address_id}"}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------
def _text(body: dict, field: str, *, required: bool, min_len: int = 1, max_len: int = 120) -> str | None:
    value = body.get(field)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is required.")
        return ""
    if not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` must be text.")
    text = " ".join(value.split())
    if len(text) < min_len or len(text) > max_len:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` must be {min_len}–{max_len} characters.")
    return text


def _coordinate(body: dict, field: str, low: float, high: float) -> Decimal:
    value = body.get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ApiError(
            400, "LOCATION_REQUIRED", "Use your current location so we can check you're within our delivery area."
        )
    if not low <= value <= high:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is out of range.")
    return Decimal(str(round(float(value), 6)))


def _check_in_range(lat: Decimal, lon: Decimal) -> float:
    shop_lat, shop_lon, radius, city = _shop()
    km = distance_km(shop_lat, shop_lon, float(lat), float(lon))
    if km > radius:
        raise ApiError(
            422,
            "OUT_OF_DELIVERY_AREA",
            f"This address is {km:.1f} km from the hotel. We deliver within {radius:g} km of Chandanzira, {city}.",
        )
    return km


def _clean_fields(body: dict, *, partial: bool) -> dict[str, Any]:
    """Validated, normalized fields from a POST (all required) or PATCH (any subset) body."""
    allowed = {
        "label", "receiver_name", "receiver_phone", "line1", "line2", "landmark",
        "pincode", "latitude", "longitude", "is_default",
    }
    ignored = {"id", "user_id", "city", "distance_km"}  # server-owned; silently ignored
    unknown = sorted(set(body) - allowed - ignored)
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")

    def wanted(field: str) -> bool:
        return not partial or field in body

    out: dict[str, Any] = {}
    if wanted("label"):
        if body.get("label") not in LABELS:
            raise ApiError(400, "VALIDATION_ERROR", "`label` must be Home, Work or Other.")
        out["label"] = body["label"]
    if wanted("receiver_name"):
        out["receiver_name"] = _text(body, "receiver_name", required=True, max_len=60)
    if wanted("receiver_phone"):
        phone = body.get("receiver_phone")
        if not isinstance(phone, str) or not _PHONE_RE.match(phone.strip()):
            raise ApiError(
                400, "VALIDATION_ERROR", "`receiver_phone` must be a 10-digit mobile number, without +91."
            )
        out["receiver_phone"] = phone.strip()
    if wanted("line1"):
        out["line1"] = _text(body, "line1", required=True, min_len=5)
    for optional in ("line2", "landmark"):
        if wanted(optional):
            out[optional] = _text(body, optional, required=False)
    if wanted("pincode"):
        pin = body.get("pincode")
        if not isinstance(pin, str) or not _PINCODE_RE.match(pin.strip()):
            raise ApiError(400, "VALIDATION_ERROR", "`pincode` must be a 6-digit Jalna-area pincode (431xxx).")
        out["pincode"] = pin.strip()
    # Location: both or neither on PATCH; always on POST.
    if partial and (("latitude" in body) != ("longitude" in body)):
        raise ApiError(400, "VALIDATION_ERROR", "Send `latitude` and `longitude` together.")
    if wanted("latitude"):
        out["latitude"] = _coordinate(body, "latitude", -90, 90)
        out["longitude"] = _coordinate(body, "longitude", -180, 180)
    if "is_default" in body:
        if not isinstance(body["is_default"], bool):
            raise ApiError(400, "VALIDATION_ERROR", "`is_default` must be true or false.")
        out["is_default"] = body["is_default"]
    return out


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------
def _list_items(user_id: str) -> list[dict]:
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with("ADDRESS#")}
    while True:
        page = users.table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    items.sort(key=lambda i: (i.get("created_at", ""), i["id"]))
    return items


def _get_item(user_id: str, address_id: str) -> dict:
    if not re.fullmatch(r"adr_[0-9a-f]{16}", address_id or ""):
        raise ApiError(404, "NOT_FOUND", "Address not found.")
    item = users.table().get_item(Key=_key(user_id, address_id)).get("Item")
    if item is None:
        raise ApiError(404, "NOT_FOUND", "Address not found.")
    return item


def _default_id(claims: dict) -> str:
    profile = users.get_or_create_profile(claims["sub"], email=claims.get("email", ""))
    return profile.get("default_address_id", "") or ""


def _set_default(claims: dict, address_id: str) -> None:
    users.update_profile(claims["sub"], {"default_address_id": address_id}, email=claims.get("email", ""))


def _effective_default(items: list[dict], stored: str) -> str:
    """The stored default if it still exists, else the oldest address (self-healing)."""
    ids = [i["id"] for i in items]
    if stored in ids:
        return stored
    return ids[0] if ids else ""


def to_address(item: dict, default_id: str) -> dict:
    """DynamoDB item -> the app's `Address` (src/types/index.ts)."""
    shop_lat, shop_lon, _, _ = _shop()
    lat, lon = float(item["latitude"]), float(item["longitude"])
    out = {
        "id": item["id"],
        "user_id": item["user_id"],
        "label": item["label"],
        "receiver_name": item["receiver_name"],
        "receiver_phone": item["receiver_phone"],
        "line1": item["line1"],
        "city": item["city"],
        "pincode": item["pincode"],
        "latitude": lat,
        "longitude": lon,
        "distance_km": round(distance_km(shop_lat, shop_lon, lat, lon), 2),
        "is_default": item["id"] == default_id,
    }
    for optional in ("line2", "landmark"):
        if item.get(optional):
            out[optional] = item[optional]
    return out


def _path_id(event: dict) -> str:
    return (event.get("pathParameters") or {}).get("id", "")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def list_addresses(event: dict) -> dict:
    claims = jwt_claims(event)
    items = _list_items(claims["sub"])
    default = _effective_default(items, _default_id(claims))
    out = [to_address(i, default) for i in items]
    out.sort(key=lambda a: not a["is_default"])  # stable: default first, rest stay oldest-first
    return response(200, out)


def create_address(event: dict) -> dict:
    claims = jwt_claims(event)
    user_id = claims["sub"]
    fields = _clean_fields(parse_body(event), partial=False)
    _check_in_range(fields["latitude"], fields["longitude"])

    existing = _list_items(user_id)
    if len(existing) >= MAX_ADDRESSES:
        raise ApiError(
            409, "ADDRESS_LIMIT", f"You can save up to {MAX_ADDRESSES} addresses. Remove one to add another."
        )

    make_default = fields.pop("is_default", False) or not existing
    address_id = f"adr_{secrets.token_hex(8)}"
    now = _now()
    item = {
        **_key(user_id, address_id),
        "entity": "ADDRESS",
        "id": address_id,
        "user_id": user_id,
        "city": _shop()[3],
        "created_at": now,
        "updated_at": now,
        **fields,
    }
    users.table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")

    if make_default:
        _set_default(claims, address_id)
        default = address_id
    else:
        default = _effective_default(existing + [item], _default_id(claims))
    return response(201, to_address(item, default))


def update_address(event: dict) -> dict:
    claims = jwt_claims(event)
    user_id = claims["sub"]
    current = _get_item(user_id, _path_id(event))
    fields = _clean_fields(parse_body(event), partial=True)
    if "latitude" in fields:
        _check_in_range(fields["latitude"], fields["longitude"])
    make_default = fields.pop("is_default", None)  # False on the current default is ignored
    if not fields and make_default is None:
        raise ApiError(400, "VALIDATION_ERROR", "Nothing to update.")

    item = current
    if fields:
        names = {"#u": "updated_at"}
        values: dict[str, Any] = {":u": _now()}
        sets = ["#u = :u"]
        for i, (field, value) in enumerate(sorted(fields.items())):
            names[f"#f{i}"] = field
            values[f":v{i}"] = value
            sets.append(f"#f{i} = :v{i}")
        item = users.table().update_item(
            Key=_key(user_id, current["id"]),
            UpdateExpression="SET " + ", ".join(sets),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(PK)",
            ReturnValues="ALL_NEW",
        )["Attributes"]

    if make_default:
        _set_default(claims, current["id"])
        default = current["id"]
    else:
        default = _effective_default(_list_items(user_id), _default_id(claims))
    return response(200, to_address(item, default))


def delete_address(event: dict) -> dict:
    claims = jwt_claims(event)
    user_id = claims["sub"]
    current = _get_item(user_id, _path_id(event))
    users.table().delete_item(Key=_key(user_id, current["id"]))

    remaining = _list_items(user_id)
    stored = _default_id(claims)
    if stored == current["id"] or stored not in {i["id"] for i in remaining}:
        _set_default(claims, remaining[0]["id"] if remaining else "")
    return response(204)


ROUTES = {
    "GET /addresses": list_addresses,
    "POST /addresses": create_address,
    "PATCH /addresses/{id}": update_address,
    "DELETE /addresses/{id}": delete_address,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
