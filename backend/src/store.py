"""The hotel's online-ordering switch, ordering hours and cooking-time setting (parts 7b, 7d).

One row in the table: PK = "SETTINGS", SK = "STORE"
  accepting_orders  bool   False = no new orders until an admin turns it back on
  message           str    shown to customers while closed (optional)
  prep_minutes      int    base cooking time for one order (part 7d, default 20)
  updated_at / updated_by

No row yet = open, 20 minutes. Orders already placed are never touched by the switch.
Used by catalog.py (GET /store, public), orders.py (POST /orders: 409 STORE_CLOSED / KITCHEN_CLOSED),
eta.py (cooking time) and admin.py (PATCH /admin/store).

Ordering hours (part 7d, IST): orders are for today, now, and are taken from 9:00 AM until the last
order at 8:30 PM, so deliveries finish around 9 PM. There are no pre-orders any more.
"""

from __future__ import annotations

from datetime import datetime

import users
from common import ApiError

KEY = {"PK": "SETTINGS", "SK": "STORE"}

OPEN_HOUR = 9  # first orders from 9:00 AM
CLOSE_HOUR = 21  # deliveries until about 9:00 PM
LAST_ORDER = (20, 30)  # last order 8:30 PM
MESSAGE_MAX = 120
DEFAULT_CLOSED_MESSAGE = "We're not taking online orders right now. Please check back later."

DEFAULT_PREP_MINUTES = 20
PREP_MIN, PREP_MAX = 5, 90


def get_settings() -> dict:
    return users.table().get_item(Key=KEY, ConsistentRead=True).get("Item") or {}


def prep_minutes(item: dict) -> int:
    return int(item.get("prep_minutes", DEFAULT_PREP_MINUTES))


def _hhmm(hour: int, minute: int = 0) -> str:
    return f"{hour:02d}:{minute:02d}"


def to_store(item: dict) -> dict:
    """Settings row -> the app's `StoreStatus`."""
    accepting = bool(item.get("accepting_orders", True))
    return {
        "accepting_orders": accepting,
        "message": "" if accepting else (item.get("message") or DEFAULT_CLOSED_MESSAGE),
        "opens_at": _hhmm(OPEN_HOUR),
        "closes_at": _hhmm(CLOSE_HOUR),
        "last_order_at": _hhmm(*LAST_ORDER),
        "prep_minutes": prep_minutes(item),
    }


def ensure_open() -> None:
    """Raise 409 STORE_CLOSED (with the hotel's message) if online orders are switched off."""
    status = to_store(get_settings())
    if not status["accepting_orders"]:
        raise ApiError(409, "STORE_CLOSED", status["message"])


def within_hours(now_ist: datetime) -> bool:
    minutes = now_ist.hour * 60 + now_ist.minute
    return OPEN_HOUR * 60 <= minutes <= LAST_ORDER[0] * 60 + LAST_ORDER[1]


def ensure_ordering_hours(now_ist: datetime) -> None:
    """Raise 409 KITCHEN_CLOSED outside 9:00 AM - 8:30 PM (IST)."""
    if not within_hours(now_ist):
        raise ApiError(
            409,
            "KITCHEN_CLOSED",
            "We take online orders from 9:00 AM to 8:30 PM. Please order again from 9 AM.",
        )


def update(changes: dict, by: str, now: str) -> dict:
    """Change some settings (accepting_orders + message, and/or prep_minutes); keeps the rest."""
    names = {"#u": "updated_at", "#b": "updated_by", "#e": "entity"}
    values = {":u": now, ":b": by, ":e": "SETTINGS"}
    sets = ["#u = :u", "#b = :b", "#e = :e"]
    if "accepting_orders" in changes:
        accepting = changes["accepting_orders"]
        names.update({"#a": "accepting_orders", "#m": "message"})
        # re-opening clears the closed message
        values.update({":a": accepting, ":m": "" if accepting else changes.get("message", "")})
        sets += ["#a = :a", "#m = :m"]
    if "prep_minutes" in changes:
        names["#p"] = "prep_minutes"
        values[":p"] = changes["prep_minutes"]
        sets.append("#p = :p")
    return users.table().update_item(
        Key=KEY,
        UpdateExpression="SET " + ", ".join(sets),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues="ALL_NEW",
    )["Attributes"]


def set_accepting(accepting: bool, message: str, by: str, now: str) -> dict:
    return update({"accepting_orders": accepting, "message": message}, by, now)
