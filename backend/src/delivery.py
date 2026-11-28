"""Delivery Lambda (part 7c): the delivery boy's Deliveries tab.

Every route needs a valid login AND membership of the Cognito group `delivery` (checked here;
anyone else gets 403 FORBIDDEN). A delivery boy only ever sees orders assigned to him; any other
order id answers 404, the same as an order that doesn't exist.

Routes
  GET  /delivery/me                    my record (registers me the first time)  -> DeliveryBoy
  PATCH /delivery/me                   {on_duty: bool}                         -> DeliveryBoy
  GET  /delivery/orders                my active deliveries (full details) and
                                       today's finished ones (no phone/address) -> DeliveryOrder[]
  POST /delivery/orders/{id}/status    {status: OUT_FOR_DELIVERY ("Picked up") | DELIVERED}
                                                                                -> DeliveryOrder

Privacy: the customer's name, phone, full address and map position are sent only while the
delivery is ASSIGNED or OUT_FOR_DELIVERY. After that only the order number and area remain.
Going on duty needs a mobile number on the delivery boy's profile (customers call it).
"""

from __future__ import annotations

import json
from typing import Any

import delivery_boys
import orders
import users
from common import ApiError, _json_default, dispatch, groups_from_claims, jwt_claims, parse_body, response

NEXT = {"ASSIGNED": "OUT_FOR_DELIVERY", "OUT_FOR_DELIVERY": "DELIVERED"}


def _delivery(event: dict) -> dict:
    claims = jwt_claims(event)
    if delivery_boys.GROUP not in groups_from_claims(claims):
        raise ApiError(403, "FORBIDDEN", "This needs a delivery account.")
    return claims


def _now() -> str:
    return orders._iso(orders._now_utc())


def _plain(value: Any) -> Any:
    return json.loads(json.dumps(value, default=_json_default))


def to_delivery_order(item: dict) -> dict:
    snap = item.get("address_snapshot", {})
    out: dict[str, Any] = {
        "id": item["id"],
        "order_number": item["order_number"],
        "status": item["status"],
        "delivery_date": item["delivery_date"],
        "slot_label": item["slot_label"],
        "total": int(item["total"]),
        "payment_method": item.get("payment_method"),
        "payment_status": item.get("payment_status"),
        "area": snap.get("line2") or snap.get("city", ""),
        "items": [
            {k: line[k] for k in ("product_name", "quantity", "spice_level", "note") if k in line}
            for line in item.get("items", [])
        ],
    }
    if item["status"] in delivery_boys.ACTIVE:
        out["customer"] = {"name": snap.get("receiver_name", ""), "phone": snap.get("receiver_phone", "")}
        out["address"] = {
            **{k: snap[k] for k in ("label", "line1", "line2", "landmark", "city", "pincode") if snap.get(k)},
            "state": delivery_boys.STATE,
            "latitude": snap.get("latitude"),
            "longitude": snap.get("longitude"),
        }
        unpaid_cash = item.get("payment_method") == "cod" and item.get("payment_status") != "paid"
        out["collect_cash"] = int(item["total"]) if unpaid_cash else 0
        out["assigned_at"] = item.get("assigned_at")
    else:
        out["items"] = []  # finished: keep just the summary
        if item.get("delivered_at"):
            out["delivered_at"] = item["delivered_at"]
        if item["status"] == "CANCELLED" and item.get("cancel_reason"):
            out["cancel_reason"] = item["cancel_reason"]
    return _plain(out)


def _mine(claims: dict) -> list[dict]:
    return [i for i in delivery_boys.recent_orders() if i.get("delivery_boy_id") == claims["sub"]]


def get_me(event: dict) -> dict:
    claims = _delivery(event)
    boy = delivery_boys.register(claims, _now())
    out = delivery_boys.to_boy(boy, delivery_boys.active_counts(_mine(claims)))
    return response(200, out)


def update_me(event: dict) -> dict:
    claims = _delivery(event)
    body = parse_body(event)
    if set(body) != {"on_duty"} or not isinstance(body["on_duty"], bool):
        raise ApiError(400, "VALIDATION_ERROR", "Send {\"on_duty\": true} or {\"on_duty\": false}.")
    now = _now()
    delivery_boys.register(claims, now)
    profile = None
    if body["on_duty"]:
        profile = users.get_or_create_profile(claims["sub"], email=claims.get("email", ""))
        if not profile.get("phone"):
            raise ApiError(
                400, "PHONE_REQUIRED", "Add your mobile number in the Account tab first, so customers can call you."
            )
    boy = delivery_boys.set_on_duty(claims["sub"], body["on_duty"], now, profile=profile)
    return response(200, delivery_boys.to_boy(boy, delivery_boys.active_counts(_mine(claims))))


def list_orders(event: dict) -> dict:
    claims = _delivery(event)
    today = delivery_boys.today_ist()
    items = [
        i for i in _mine(claims) if i["status"] in delivery_boys.ACTIVE or i.get("delivery_date") == today
    ]
    items.sort(
        key=lambda i: (
            i["status"] not in delivery_boys.ACTIVE,  # active first
            i["delivery_date"],
            int(i.get("slot_start_hour", 0)),
            i.get("created_at", ""),
        )
    )
    return response(200, [to_delivery_order(i) for i in items])


def _my_order(claims: dict, order_id: str) -> dict:
    if not orders._ORDER_ID_RE.match(order_id or ""):
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    ref = users.table().get_item(Key={"PK": f"ORDERREF#{order_id}", "SK": "ORDER"}).get("Item")
    if ref is None:
        raise ApiError(404, "NOT_FOUND", "Order not found.")
    item = orders._get_order_item(ref["user_id"], order_id)
    if item.get("delivery_boy_id") != claims["sub"]:
        raise ApiError(404, "NOT_FOUND", "Order not found.")  # not his: don't reveal it exists
    return item


def change_status(event: dict) -> dict:
    claims = _delivery(event)
    body = parse_body(event)
    if set(body) != {"status"} or body["status"] not in ("OUT_FOR_DELIVERY", "DELIVERED"):
        raise ApiError(400, "VALIDATION_ERROR", "`status` must be OUT_FOR_DELIVERY or DELIVERED.")
    new = body["status"]
    order = _my_order(claims, (event.get("pathParameters") or {}).get("id", ""))
    current = order["status"]
    if current == new:
        return response(200, to_delivery_order(order))  # double tap: nothing changes
    if NEXT.get(current) != new:
        if current == "CANCELLED":
            message = "The hotel cancelled this order. Please don't deliver it."
        else:
            message = f"This order is {current.lower().replace('_', ' ')}; it can't go to {new.lower().replace('_', ' ')}."
        raise ApiError(409, "INVALID_STATUS_CHANGE", message)
    now = _now()
    sets: list[str] = []
    values: dict[str, Any] = {}
    if new == "DELIVERED":
        sets.append("delivered_at = :now")
        if order.get("payment_method") == "cod":
            sets.append("payment_status = :paid")  # the cash was collected at the door
            values[":paid"] = "paid"
    by = claims.get("email") or claims["sub"]
    try:
        updated = delivery_boys.write_order(
            order,
            status=new,
            history=[orders.history_entry(new, now, by)],
            now=now,
            sets=sets,
            values=values,
            expected_boy=claims["sub"],
        )
    except delivery_boys.OrderChanged as err:
        raise ApiError(409, "ORDER_CHANGED", "This order just changed. Pull down to refresh.") from err
    return response(200, to_delivery_order(updated))


ROUTES = {
    "GET /delivery/me": get_me,
    "PATCH /delivery/me": update_me,
    "GET /delivery/orders": list_orders,
    "POST /delivery/orders/{id}/status": change_status,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
