"""Admin Lambda: the kitchen's order board and menu management.

Every route needs a valid login (API Gateway's JWT authorizer) AND membership of the Cognito
group `admin` (checked here; anyone else gets 403 FORBIDDEN).

Routes
  GET   /admin/orders?date=YYYY-MM-DD   orders for a delivery day (default: today in IST),
                                         by slot then time                      -> AdminOrder[]
  POST  /admin/orders/{id}/status       {status, reason?}: next step or cancel  -> AdminOrder
  GET   /admin/categories               all categories, hidden ones too         -> Category[]
  POST  /admin/categories               new category                            -> 201 Category
  PATCH /admin/categories/{id}          rename / reorder / show / hide          -> Category
  GET   /admin/products                 all dishes, hidden ones too             -> AdminProduct[]
  POST  /admin/products                 new dish                                -> 201 AdminProduct
  PATCH /admin/products/{id}            price, names, sold out, hide, ...       -> AdminProduct
  PATCH /admin/store                    {accepting_orders, message?}: stop / restart online
                                         orders (part 7b)                       -> AdminStore

Order status rules
  - One step forward at a time: CONFIRMED -> PREPARING -> OUT_FOR_DELIVERY -> DELIVERED.
    DELIVERED also marks a cash order as paid (the rider collected the cash).
  - UPI orders start at PENDING_PAYMENT. PENDING_PAYMENT -> CONFIRMED means "Payment received":
    someone checked the hotel's UPI app (amount + order number / UTR); it marks the order paid.
    If the money never came, cancel with a reason instead.
  - The kitchen may cancel any order that isn't delivered yet; a reason (3-120 chars) is
    required and shown to the customer.
  - Each change is conditional on the status the admin saw, so two people tapping at once
    can't skip a step (the second gets 409 ORDER_CHANGED).

AdminOrder = Order (see orders.py) + status_history [{status, at, by}].
AdminProduct = Product + is_active. Hidden dishes (is_active = false) vanish from the public
menu and can't be ordered; sold-out dishes (is_available = false) stay visible but can't be ordered.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import date
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import catalog
import orders
import store
import users
from common import ApiError, _json_default, dispatch, jwt_claims, parse_body, response, role_from_claims

NEXT_STATUS = {
    "PENDING_PAYMENT": "CONFIRMED",  # UPI: payment received (checked by hand in the hotel's UPI app)
    "CONFIRMED": "PREPARING",
    "PREPARING": "OUT_FOR_DELIVERY",
    "OUT_FOR_DELIVERY": "DELIVERED",
}
KITCHEN_CANCELLABLE = ("PENDING_PAYMENT", "CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY")
MIN_PRICE_PAISE = 100  # ₹1
MAX_PRICE_PAISE = 500000  # ₹5,000
_ID_RE = re.compile(r"^[a-z]{3}_[a-z0-9_]{1,40}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _admin(event: dict) -> dict:
    claims = jwt_claims(event)
    if role_from_claims(claims) != "admin":
        raise ApiError(403, "FORBIDDEN", "This needs an admin account.")
    return claims


def _now() -> str:
    return orders._iso(orders._now_utc())


def _path_id(event: dict) -> str:
    return (event.get("pathParameters") or {}).get("id", "")


# ---------------------------------------------------------------------------
# Orders
# ---------------------------------------------------------------------------
def to_admin_order(item: dict) -> dict:
    out = orders.to_order(item)
    out["status_history"] = json.loads(json.dumps(item.get("status_history", []), default=_json_default))
    return out


def list_orders(event: dict) -> dict:
    _admin(event)
    params = event.get("queryStringParameters") or {}
    day = params.get("date") or orders._now_utc().astimezone(orders.IST).date().isoformat()
    if not _DATE_RE.match(day):
        raise ApiError(400, "VALIDATION_ERROR", "`date` must be YYYY-MM-DD.")
    try:
        date.fromisoformat(day)
    except ValueError as exc:
        raise ApiError(400, "VALIDATION_ERROR", "`date` is not a real date.") from exc

    items: list[dict] = []
    kwargs = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(f"ORDERDATE#{day}"),
        "ScanIndexForward": True,  # GSI1SK = <slot hour>#<created_at>#<id>: by slot, then time
    }
    while True:
        page = users.table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return response(200, [to_admin_order(i) for i in items])


def _find_order(order_id: str) -> dict:
    if not orders._ORDER_ID_RE.match(order_id or ""):
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    ref = users.table().get_item(Key={"PK": f"ORDERREF#{order_id}", "SK": "ORDER"}).get("Item")
    if ref is None:
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    return orders._get_order_item(ref["user_id"], order_id)


def change_status(event: dict) -> dict:
    claims = _admin(event)
    body = parse_body(event)
    unknown = sorted(set(body) - {"status", "reason"})
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")
    new = body.get("status")
    if new not in (*NEXT_STATUS.values(), "CANCELLED"):
        raise ApiError(
            400,
            "VALIDATION_ERROR",
            "`status` must be CONFIRMED, PREPARING, OUT_FOR_DELIVERY, DELIVERED or CANCELLED.",
        )
    order = _find_order(_path_id(event))
    current = order["status"]
    now = _now()
    by = claims.get("email") or claims["sub"]

    names = {"#s": "status"}
    values: dict[str, Any] = {
        ":current": current,
        ":new": new,
        ":now": now,
        ":empty": [],
        ":entry": [orders.history_entry(new, now, by)],
    }
    sets = [
        "#s = :new",
        "updated_at = :now",
        "status_history = list_append(if_not_exists(status_history, :empty), :entry)",
    ]

    if new == "CANCELLED":
        if current not in KITCHEN_CANCELLABLE:
            raise ApiError(409, "INVALID_STATUS_CHANGE", f"A {current.lower().replace('_', ' ')} order can't be cancelled.")
        reason = body.get("reason")
        reason = " ".join(reason.split()) if isinstance(reason, str) else ""
        if not 3 <= len(reason) <= 120:
            raise ApiError(400, "VALIDATION_ERROR", "Give the customer a short reason (3–120 characters).")
        values.update({":reason": reason, ":kitchen": "kitchen"})
        sets += ["cancelled_at = :now", "cancelled_by = :kitchen", "cancel_reason = :reason"]
    else:
        if NEXT_STATUS.get(current) != new:
            expected = NEXT_STATUS.get(current)
            hint = f" The next step is {expected}." if expected else ""
            raise ApiError(409, "INVALID_STATUS_CHANGE", f"This order is {current}; it can't go to {new}.{hint}")
        if new == "CONFIRMED":  # from PENDING_PAYMENT: the UPI money is in
            sets += ["payment_status = :paid", "payment_verified_at = :now", "payment_verified_by = :by"]
            values.update({":paid": "paid", ":by": by})
        if new == "DELIVERED":
            sets.append("delivered_at = :now")
            if order.get("payment_method") == "cod":
                sets.append("payment_status = :paid")
                values[":paid"] = "paid"

    try:
        updated = users.table().update_item(
            Key={"PK": order["PK"], "SK": order["SK"]},
            UpdateExpression="SET " + ", ".join(sets),
            ConditionExpression="#s = :current",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        raise ApiError(
            409, "ORDER_CHANGED", "Someone else just updated this order. Pull down to refresh and try again."
        ) from err
    return response(200, to_admin_order(updated))


# ---------------------------------------------------------------------------
# Menu: validation helpers
# ---------------------------------------------------------------------------
def _text(body: dict, field: str, *, required: bool, max_len: int) -> str | None:
    if field not in body:
        if required:
            raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is required.")
        return None
    value = body[field]
    if not isinstance(value, str):
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` must be text.")
    value = " ".join(value.split())
    if required and not value:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` is required.")
    if len(value) > max_len:
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` must be at most {max_len} characters.")
    return value


def _bool(body: dict, field: str) -> bool | None:
    if field not in body:
        return None
    if not isinstance(body[field], bool):
        raise ApiError(400, "VALIDATION_ERROR", f"`{field}` must be true or false.")
    return body[field]


def _int(body: dict, field: str, low: int, high: int, message: str) -> int | None:
    if field not in body:
        return None
    value = body[field]
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ApiError(400, "VALIDATION_ERROR", message)
    return value


def _image_url(body: dict) -> str | None:
    url = _text(body, "image_url", required=False, max_len=500)
    if url and not url.startswith("https://"):
        raise ApiError(400, "VALIDATION_ERROR", "`image_url` must start with https://.")
    return url


def _clean(body: dict, allowed: set[str], extract: dict) -> dict:
    unknown = sorted(set(body) - allowed - {"id"})  # `id` is ignored (it's in the path / server-made)
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")
    out = {}
    for field, fn in extract.items():
        value = fn(body)
        if value is not None:
            out[field] = value
    return out


def _new_id(kind: str, prefix: str, name: str) -> str:
    """`cat_misal`, `prd_kanda_bhaji` ...; a random suffix if that's taken or the name isn't ASCII."""
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:30]
    if slug and users.table().get_item(Key=_catalog_key(kind, f"{prefix}_{slug}")).get("Item") is None:
        return f"{prefix}_{slug}"
    return f"{prefix}_{slug + '_' if slug else ''}{secrets.token_hex(3)}"


def _catalog_key(kind: str, item_id: str) -> dict:
    return {"PK": "CATALOG", "SK": f"{kind}#{item_id}"}


def _get_catalog_item(kind: str, item_id: str, label: str) -> dict:
    if not _ID_RE.match(item_id or ""):
        raise ApiError(404, "NOT_FOUND", f"{label} not found.")
    item = users.table().get_item(Key=_catalog_key(kind, item_id)).get("Item")
    if item is None:
        raise ApiError(404, "NOT_FOUND", f"{label} not found.")
    return item


def _update_catalog_item(kind: str, item_id: str, fields: dict) -> dict:
    names = {"#u": "updated_at"}
    values: dict[str, Any] = {":u": _now()}
    sets = ["#u = :u"]
    for i, (field, value) in enumerate(sorted(fields.items())):
        names[f"#f{i}"] = field
        values[f":v{i}"] = value
        sets.append(f"#f{i} = :v{i}")
    return users.table().update_item(
        Key=_catalog_key(kind, item_id),
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ConditionExpression="attribute_exists(PK)",
        ReturnValues="ALL_NEW",
    )["Attributes"]


def _all(kind: str) -> list[dict]:
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("PK").eq("CATALOG") & Key("SK").begins_with(f"{kind}#")}
    while True:
        page = users.table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


# ---------------------------------------------------------------------------
# Menu: categories
# ---------------------------------------------------------------------------
CATEGORY_FIELDS = {
    "name": lambda b: _text(b, "name", required=False, max_len=40),
    "name_mr": lambda b: _text(b, "name_mr", required=False, max_len=40),
    "image_url": _image_url,
    "sort_order": lambda b: _int(b, "sort_order", 0, 999, "`sort_order` must be a whole number from 0 to 999."),
    "is_active": lambda b: _bool(b, "is_active"),
}


def list_categories(event: dict) -> dict:
    _admin(event)
    out = [catalog.to_category(i) for i in _all("CATEGORY")]
    out.sort(key=lambda c: (c["sort_order"], c["name"]))
    return response(200, out)


def create_category(event: dict) -> dict:
    _admin(event)
    body = parse_body(event)
    fields = _clean(body, set(CATEGORY_FIELDS), CATEGORY_FIELDS)
    if not fields.get("name"):
        raise ApiError(400, "VALIDATION_ERROR", "`name` is required.")
    if "sort_order" not in fields:
        existing = [int(i.get("sort_order", 0)) for i in _all("CATEGORY")]
        fields["sort_order"] = max(existing, default=0) + 1
    cat_id = _new_id("CATEGORY", "cat", fields["name"])
    now = _now()
    item = {
        **_catalog_key("CATEGORY", cat_id),
        "entity": "CATEGORY",
        "id": cat_id,
        "name_mr": "",
        "image_url": "",
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        **fields,
    }
    users.table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    return response(201, catalog.to_category(item))


def update_category(event: dict) -> dict:
    _admin(event)
    current = _get_catalog_item("CATEGORY", _path_id(event), "Category")
    fields = _clean(parse_body(event), set(CATEGORY_FIELDS), CATEGORY_FIELDS)
    if "name" in fields and not fields["name"]:
        raise ApiError(400, "VALIDATION_ERROR", "`name` can't be empty.")
    if not fields:
        raise ApiError(400, "VALIDATION_ERROR", "Nothing to update.")
    return response(200, catalog.to_category(_update_catalog_item("CATEGORY", current["id"], fields)))


# ---------------------------------------------------------------------------
# Menu: products
# ---------------------------------------------------------------------------
PRODUCT_FIELDS = {
    "category_id": lambda b: _text(b, "category_id", required=False, max_len=44),
    "name": lambda b: _text(b, "name", required=False, max_len=60),
    "name_mr": lambda b: _text(b, "name_mr", required=False, max_len=60),
    "description": lambda b: _text(b, "description", required=False, max_len=300),
    "price": lambda b: _int(
        b, "price", MIN_PRICE_PAISE, MAX_PRICE_PAISE, "`price` must be whole paise from 100 (₹1) to 500000 (₹5,000)."
    ),
    "image_url": _image_url,
    "is_veg": lambda b: _bool(b, "is_veg"),
    "has_spice_level": lambda b: _bool(b, "has_spice_level"),
    "is_available": lambda b: _bool(b, "is_available"),
    "is_active": lambda b: _bool(b, "is_active"),
}


def to_admin_product(item: dict) -> dict:
    return {**catalog.to_product(item), "is_active": bool(item.get("is_active", True))}


def _check_category(category_id: str) -> dict:
    return _get_catalog_item("CATEGORY", category_id, "Category")


def list_products(event: dict) -> dict:
    _admin(event)
    out = [to_admin_product(i) for i in _all("PRODUCT")]
    out.sort(key=lambda p: (p["category_id"], p["name"]))
    return response(200, out)


def create_product(event: dict) -> dict:
    _admin(event)
    fields = _clean(parse_body(event), set(PRODUCT_FIELDS), PRODUCT_FIELDS)
    for required in ("category_id", "name", "price"):
        if not fields.get(required):
            raise ApiError(400, "VALIDATION_ERROR", f"`{required}` is required.")
    category = _check_category(fields["category_id"])
    prd_id = _new_id("PRODUCT", "prd", fields["name"])
    now = _now()
    item = {
        **_catalog_key("PRODUCT", prd_id),
        "entity": "PRODUCT",
        "id": prd_id,
        "name_mr": "",
        "description": "",
        "image_url": category.get("image_url", ""),  # until photo upload exists (part 6b)
        "is_veg": True,
        "has_spice_level": False,
        "is_available": True,
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        **fields,
    }
    users.table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    return response(201, to_admin_product(item))


def update_product(event: dict) -> dict:
    _admin(event)
    current = _get_catalog_item("PRODUCT", _path_id(event), "Dish")
    fields = _clean(parse_body(event), set(PRODUCT_FIELDS), PRODUCT_FIELDS)
    for required in ("name", "category_id"):
        if required in fields and not fields[required]:
            raise ApiError(400, "VALIDATION_ERROR", f"`{required}` can't be empty.")
    if not fields:
        raise ApiError(400, "VALIDATION_ERROR", "Nothing to update.")
    if "category_id" in fields:
        _check_category(fields["category_id"])
    return response(200, to_admin_product(_update_catalog_item("PRODUCT", current["id"], fields)))


# ---------------------------------------------------------------------------
# Store switch (part 7b)
# ---------------------------------------------------------------------------
def to_admin_store(item: dict) -> dict:
    return {**store.to_store(item), "updated_at": item.get("updated_at"), "updated_by": item.get("updated_by")}


def update_store(event: dict) -> dict:
    claims = _admin(event)
    body = parse_body(event)
    unknown = sorted(set(body) - {"accepting_orders", "message"})
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")
    accepting = body.get("accepting_orders")
    if not isinstance(accepting, bool):
        raise ApiError(400, "VALIDATION_ERROR", "`accepting_orders` must be true or false.")
    message = _text(body, "message", required=False, max_len=store.MESSAGE_MAX) or ""
    item = store.set_accepting(accepting, message, claims.get("email") or claims["sub"], _now())
    return response(200, to_admin_store(item))


ROUTES = {
    "PATCH /admin/store": update_store,
    "GET /admin/orders": list_orders,
    "POST /admin/orders/{id}/status": change_status,
    "GET /admin/categories": list_categories,
    "POST /admin/categories": create_category,
    "PATCH /admin/categories/{id}": update_category,
    "GET /admin/products": list_products,
    "POST /admin/products": create_product,
    "PATCH /admin/products/{id}": update_product,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
