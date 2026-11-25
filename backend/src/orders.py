"""Orders Lambda: place, list, view and cancel the signed-in user's orders. Every route sits
behind the JWT authorizer; the user id is always the token's `sub`, never the request body.

Routes
  POST /orders              -> 201 Order   (needs an Idempotency-Key header)
  GET  /orders              -> Order[]     (newest first, latest 50)
  GET  /orders/{id}         -> Order
  POST /orders/{id}/cancel  -> 200 Order

Rules (the app shows the same ones; the server's answer is final)
  - Prices and names come from the menu in the table, never from the app. Each order keeps a
    frozen copy of the dish names/prices and of the delivery address.
  - Bill: subtotal + ₹30 delivery + 5% GST on the subtotal (rounded half up), integer paise.
  - Minimum order: MIN_ORDER_PAISE of food (subtotal), default ₹100.
  - Cash on delivery only until online payments arrive (part 7).
  - Delivery date: today or tomorrow in India time (IST, fixed +05:30). A slot for today
    closes 30 minutes before it starts.
  - The address must be the user's and still inside the delivery area.
  - Cancel only while CONFIRMED / PENDING_PAYMENT (before the kitchen starts).
  - Idempotency: the same Idempotency-Key with the same body returns the first order instead
    of creating a second one (records expire after 24 h via the table's TTL).

Storage (table wmh-main)
  PK = "USER#<sub>",  SK = "ORDER#<id>"         the order (ids sort by time)
  PK = "USER#<sub>",  SK = "IDEMP#<key>"        idempotency record, expires_at = TTL
  PK = "COUNTER",     SK = "ORDER#<YYYYMMDD>"   daily running number for order_number
  Orders also carry GSI1PK = "ORDERDATE#<delivery_date>" / GSI1SK for the part 6 admin index.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import addresses
import users
from common import ApiError, _json_default, dispatch, jwt_claims, parse_body, response

IST = timezone(timedelta(hours=5, minutes=30))  # India has no daylight saving

DELIVERY_FEE_PAISE = 3000
GST_RATE_BPS = 500  # 5%
MAX_LINES = 20
MAX_QUANTITY = 20
NOTE_MAX = 120
SPICE_LEVELS = ("mild", "medium", "teekha")
PAYMENT_METHODS = ("cod", "online")
CANCELLABLE = ("PENDING_PAYMENT", "CONFIRMED")
IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60
SLOT_CUTOFF_MINUTES = 30
LIST_LIMIT = 50

# Mirror of DELIVERY_SLOTS in the app (src/utils/pricing.ts); label = f"{name} {time}".
SLOTS = [
    ("slot_early", "Early Bird", "7:00 - 8:00 AM", 7),
    ("slot_morning", "Morning", "8:00 - 9:00 AM", 8),
    ("slot_breakfast", "Breakfast", "9:00 - 10:00 AM", 9),
    ("slot_brunch", "Brunch", "10:00 - 11:00 AM", 10),
    ("slot_lunch", "Lunch", "12:00 - 1:00 PM", 12),
]
SLOTS_BY_LABEL = {f"{name} {span}": (slot_id, start) for slot_id, name, span, start in SLOTS}

_ORDER_ID_RE = re.compile(r"^ord_\d{13}[0-9a-f]{6}$")
_ADDRESS_ID_RE = re.compile(r"^adr_[0-9a-f]{16}$")
_PRODUCT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _now_utc() -> datetime:
    """Patched in tests."""
    return datetime.now(timezone.utc)


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def min_order_paise() -> int:
    return int(os.environ.get("MIN_ORDER_PAISE", "10000"))


def rupees(paise: int) -> str:
    return f"₹{paise // 100}" if paise % 100 == 0 else f"₹{paise / 100:.2f}"


def compute_bill(subtotal: int) -> dict:
    """Same as computeBill() in the app. Integer maths; GST rounds half up like Math.round."""
    if subtotal <= 0:
        return {"subtotal": 0, "delivery_fee": 0, "tax": 0, "total": 0}
    tax = (subtotal * GST_RATE_BPS + 5000) // 10000
    return {
        "subtotal": subtotal,
        "delivery_fee": DELIVERY_FEE_PAISE,
        "tax": tax,
        "total": subtotal + DELIVERY_FEE_PAISE + tax,
    }


def _to_ddb(value: Any) -> Any:
    """Plain JSON-able data -> DynamoDB-safe (floats become Decimal)."""
    return json.loads(json.dumps(value, default=_json_default), parse_float=Decimal)


def _key(user_id: str, sk: str) -> dict:
    return {"PK": f"USER#{user_id}", "SK": sk}


# ---------------------------------------------------------------------------
# Request validation (shape only; business rules come after the idempotency check)
# ---------------------------------------------------------------------------
def _idempotency_key(event: dict) -> str:
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    key = (headers.get("idempotency-key") or "").strip()
    if not _IDEMPOTENCY_RE.match(key):
        raise ApiError(
            400,
            "VALIDATION_ERROR",
            "Send an `Idempotency-Key` header (8–64 letters, digits, - or _), the same for retries of one checkout.",
        )
    return key


def _clean_items(raw: Any) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        raise ApiError(400, "VALIDATION_ERROR", "`items` must list at least one dish.")
    if len(raw) > MAX_LINES:
        raise ApiError(400, "VALIDATION_ERROR", f"An order can have at most {MAX_LINES} lines.")
    items = []
    for n, line in enumerate(raw, start=1):
        where = f"items[{n - 1}]"
        if not isinstance(line, dict):
            raise ApiError(400, "VALIDATION_ERROR", f"`{where}` must be an object.")
        unknown = sorted(set(line) - {"product_id", "quantity", "spice_level", "note"})
        if unknown:
            raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s) in `{where}`: {', '.join(unknown)}.")
        product_id = line.get("product_id")
        if not isinstance(product_id, str) or not _PRODUCT_ID_RE.match(product_id):
            raise ApiError(400, "VALIDATION_ERROR", f"`{where}.product_id` is required.")
        qty = line.get("quantity")
        if isinstance(qty, bool) or not isinstance(qty, int) or not 1 <= qty <= MAX_QUANTITY:
            raise ApiError(400, "VALIDATION_ERROR", f"`{where}.quantity` must be a whole number from 1 to {MAX_QUANTITY}.")
        item: dict = {"product_id": product_id, "quantity": qty}
        spice = line.get("spice_level")
        if spice is not None:
            if spice not in SPICE_LEVELS:
                raise ApiError(400, "VALIDATION_ERROR", f"`{where}.spice_level` must be mild, medium or teekha.")
            item["spice_level"] = spice
        note = line.get("note")
        if note is not None:
            if not isinstance(note, str):
                raise ApiError(400, "VALIDATION_ERROR", f"`{where}.note` must be text.")
            note = " ".join(note.split())
            if len(note) > NOTE_MAX:
                raise ApiError(400, "VALIDATION_ERROR", f"`{where}.note` must be at most {NOTE_MAX} characters.")
            if note:
                item["note"] = note
        items.append(item)
    return items


def _clean_request(body: dict) -> dict:
    allowed = {"address_id", "delivery_date", "slot_label", "payment_method", "items"}
    unknown = sorted(set(body) - allowed)
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")
    address_id = body.get("address_id")
    if not isinstance(address_id, str) or not address_id:
        raise ApiError(400, "VALIDATION_ERROR", "`address_id` is required.")
    delivery_date = body.get("delivery_date")
    if not isinstance(delivery_date, str) or not _DATE_RE.match(delivery_date):
        raise ApiError(400, "VALIDATION_ERROR", "`delivery_date` must be YYYY-MM-DD.")
    try:
        date.fromisoformat(delivery_date)
    except ValueError as exc:
        raise ApiError(400, "VALIDATION_ERROR", "`delivery_date` is not a real date.") from exc
    slot_label = body.get("slot_label")
    if not isinstance(slot_label, str) or slot_label not in SLOTS_BY_LABEL:
        raise ApiError(400, "VALIDATION_ERROR", "`slot_label` is not one of our delivery slots.")
    payment = body.get("payment_method")
    if payment not in PAYMENT_METHODS:
        raise ApiError(400, "VALIDATION_ERROR", "`payment_method` must be cod or online.")
    if payment == "online":
        raise ApiError(
            400, "PAYMENT_METHOD_UNAVAILABLE", "Online payment is coming soon. Please choose Cash on Delivery."
        )
    return {
        "address_id": address_id,
        "delivery_date": delivery_date,
        "slot_label": slot_label,
        "payment_method": payment,
        "items": _clean_items(body.get("items")),
    }


def _request_hash(request: dict) -> str:
    return hashlib.sha256(json.dumps(request, sort_keys=True).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Business rules
# ---------------------------------------------------------------------------
def _check_slot(delivery_date: str, slot_label: str, now: datetime) -> tuple[str, int]:
    now_ist = now.astimezone(IST)
    today = now_ist.date()
    day = date.fromisoformat(delivery_date)
    if day not in (today, today + timedelta(days=1)):
        raise ApiError(409, "SLOT_UNAVAILABLE", "Delivery can be booked for today or tomorrow only.")
    slot_id, start_hour = SLOTS_BY_LABEL[slot_label]
    if day == today and now_ist.hour * 60 + now_ist.minute >= start_hour * 60 - SLOT_CUTOFF_MINUTES:
        raise ApiError(
            409, "SLOT_UNAVAILABLE", "That delivery slot has closed for today. Please pick a later slot or tomorrow."
        )
    return slot_id, start_hour


def _address_snapshot(claims: dict, address_id: str) -> dict:
    if not _ADDRESS_ID_RE.match(address_id):
        raise ApiError(404, "NOT_FOUND", "Delivery address not found.")
    item = users.table().get_item(Key=_key(claims["sub"], f"ADDRESS#{address_id}")).get("Item")
    if item is None:
        raise ApiError(404, "NOT_FOUND", "Delivery address not found.")
    addresses._check_in_range(item["latitude"], item["longitude"])  # 422 OUT_OF_DELIVERY_AREA
    return addresses.to_address(item, addresses._default_id(claims))


def _menu() -> dict[str, dict]:
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("PK").eq("CATALOG") & Key("SK").begins_with("PRODUCT#")}
    while True:
        page = users.table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return {i["id"]: i for i in items}
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _price_lines(order_id: str, lines: list[dict]) -> list[dict]:
    menu = _menu()
    priced = []
    for n, line in enumerate(lines, start=1):
        product = menu.get(line["product_id"])
        if product is None:
            raise ApiError(409, "PRODUCT_UNAVAILABLE", "A dish in your cart is no longer on the menu. Please remove it.")
        name = product.get("name", line["product_id"])
        if not product.get("is_available", True):
            raise ApiError(409, "PRODUCT_UNAVAILABLE", f"{name} is sold out right now. Please remove it to continue.")
        if "spice_level" in line and not product.get("has_spice_level", False):
            raise ApiError(400, "VALIDATION_ERROR", f"{name} doesn't come in spice levels.")
        unit_price = int(product["price"])
        priced.append(
            {
                "id": f"oit_{n}",
                "order_id": order_id,
                "product_id": line["product_id"],
                "product_name": name,
                "unit_price": unit_price,
                "quantity": line["quantity"],
                **({"spice_level": line["spice_level"]} if "spice_level" in line else {}),
                **({"note": line["note"]} if "note" in line else {}),
                "line_total": unit_price * line["quantity"],
            }
        )
    return priced


def _next_order_number(now: datetime) -> str:
    day = now.astimezone(IST).strftime("%Y%m%d")
    seq = users.table().update_item(
        Key={"PK": "COUNTER", "SK": f"ORDER#{day}"},
        UpdateExpression="ADD seq :one",
        ExpressionAttributeValues={":one": 1},
        ReturnValues="UPDATED_NEW",
    )["Attributes"]["seq"]
    return f"WMH-{day}-{int(seq):04d}"


# ---------------------------------------------------------------------------
# Storage helpers
# ---------------------------------------------------------------------------
ORDER_FIELDS = (
    "id", "order_number", "user_id", "address_snapshot", "delivery_date", "slot_label", "status",
    "subtotal", "delivery_fee", "tax", "total", "payment_method", "payment_status", "created_at", "items",
)


def to_order(item: dict) -> dict:
    """DynamoDB item -> the app's `Order` (src/types/index.ts)."""
    return json.loads(json.dumps({f: item[f] for f in ORDER_FIELDS if f in item}, default=_json_default))


def _get_order_item(user_id: str, order_id: str) -> dict:
    if not _ORDER_ID_RE.match(order_id or ""):
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    item = users.table().get_item(Key=_key(user_id, f"ORDER#{order_id}")).get("Item")
    if item is None:
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    return item


def _live_idempotency_record(user_id: str, key: str, now: datetime) -> dict | None:
    item = users.table().get_item(Key=_key(user_id, f"IDEMP#{key}"), ConsistentRead=True).get("Item")
    if item is None or int(item.get("expires_at", 0)) <= int(now.timestamp()):
        return None  # TTL deletes lazily, so an expired record may still be there
    return item


def _replay(user_id: str, record: dict, request_hash: str) -> dict:
    if record.get("request_hash") != request_hash:
        raise ApiError(
            409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different order."
        )
    order = _get_order_item(user_id, record["order_id"])
    return response(201, to_order(order), {"Idempotent-Replayed": "true"})


def _put_order_and_record(order: dict, record: dict, now: datetime) -> None:
    # The resource's client converts plain Python values itself (no {"S": ...} wrapping).
    client = users.table().meta.client
    name = users.table().name
    client.transact_write_items(
        TransactItems=[
            {
                "Put": {
                    "TableName": name,
                    "Item": order,
                    "ConditionExpression": "attribute_not_exists(PK)",
                }
            },
            {
                "Put": {
                    "TableName": name,
                    "Item": record,
                    # Only if no live record exists (an expired one may linger until TTL runs).
                    "ConditionExpression": "attribute_not_exists(PK) OR expires_at <= :now",
                    "ExpressionAttributeValues": {":now": int(now.timestamp())},
                }
            },
        ]
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def create_order(event: dict) -> dict:
    claims = jwt_claims(event)
    user_id = claims["sub"]
    key = _idempotency_key(event)
    request = _clean_request(parse_body(event))
    request_hash = _request_hash(request)
    now = _now_utc()

    record = _live_idempotency_record(user_id, key, now)
    if record is not None:
        return _replay(user_id, record, request_hash)

    slot_id, start_hour = _check_slot(request["delivery_date"], request["slot_label"], now)
    snapshot = _address_snapshot(claims, request["address_id"])

    order_id = f"ord_{int(now.timestamp() * 1000):013d}{secrets.token_hex(3)}"
    lines = _price_lines(order_id, request["items"])
    bill = compute_bill(sum(line["line_total"] for line in lines))
    minimum = min_order_paise()
    if bill["subtotal"] < minimum:
        short = minimum - bill["subtotal"]
        raise ApiError(
            422,
            "BELOW_MINIMUM_ORDER",
            f"Minimum order is {rupees(minimum)} of food. Add {rupees(short)} more to place this order.",
        )

    created_at = _iso(now)
    order = _to_ddb(
        {
            **_key(user_id, f"ORDER#{order_id}"),
            "entity": "ORDER",
            "id": order_id,
            "order_number": _next_order_number(now),
            "user_id": user_id,
            "address_snapshot": snapshot,
            "delivery_date": request["delivery_date"],
            "slot_label": request["slot_label"],
            "slot_id": slot_id,
            "slot_start_hour": start_hour,
            "status": "CONFIRMED",  # COD; online would start at PENDING_PAYMENT (part 7)
            **bill,
            "payment_method": request["payment_method"],
            "payment_status": "pending",
            "created_at": created_at,
            "updated_at": created_at,
            "items": lines,
            # For the part 6 admin index ("all orders for a delivery date, by slot").
            "GSI1PK": f"ORDERDATE#{request['delivery_date']}",
            "GSI1SK": f"{start_hour:02d}#{created_at}#{order_id}",
        }
    )
    record = {
        **_key(user_id, f"IDEMP#{key}"),
        "entity": "IDEMPOTENCY",
        "order_id": order_id,
        "request_hash": request_hash,
        "created_at": created_at,
        "expires_at": int(now.timestamp()) + IDEMPOTENCY_TTL_SECONDS,
    }
    try:
        _put_order_and_record(order, record, now)
    except ClientError as err:
        if err.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        # Lost a race with a retry of the same checkout: answer with the order that won.
        winner = _live_idempotency_record(user_id, key, now)
        if winner is None:
            raise ApiError(409, "CONFLICT", "Couldn't place the order. Please try again.") from err
        return _replay(user_id, winner, request_hash)
    return response(201, to_order(order))


def list_orders(event: dict) -> dict:
    user_id = jwt_claims(event)["sub"]
    page = users.table().query(
        KeyConditionExpression=Key("PK").eq(f"USER#{user_id}") & Key("SK").begins_with("ORDER#"),
        ScanIndexForward=False,  # ids start with a timestamp, so this is newest first
        Limit=LIST_LIMIT,
    )
    return response(200, [to_order(i) for i in page.get("Items", [])])


def get_order(event: dict) -> dict:
    user_id = jwt_claims(event)["sub"]
    order_id = (event.get("pathParameters") or {}).get("id", "")
    return response(200, to_order(_get_order_item(user_id, order_id)))


def cancel_order(event: dict) -> dict:
    user_id = jwt_claims(event)["sub"]
    order_id = (event.get("pathParameters") or {}).get("id", "")
    current = _get_order_item(user_id, order_id)
    if current["status"] == "CANCELLED":
        return response(200, to_order(current))  # cancelling twice is harmless
    now = _iso(_now_utc())
    try:
        updated = users.table().update_item(
            Key=_key(user_id, f"ORDER#{current['id']}"),
            UpdateExpression="SET #s = :cancelled, cancelled_at = :now, updated_at = :now",
            ConditionExpression="#s IN (:pending, :confirmed)",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":cancelled": "CANCELLED",
                ":now": now,
                ":pending": CANCELLABLE[0],
                ":confirmed": CANCELLABLE[1],
            },
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        raise ApiError(
            409, "ORDER_NOT_CANCELLABLE", "The kitchen has already started this order, so it can't be cancelled."
        ) from err
    return response(200, to_order(updated))


ROUTES = {
    "POST /orders": create_order,
    "GET /orders": list_orders,
    "GET /orders/{id}": get_order,
    "POST /orders/{id}/cancel": cancel_order,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
