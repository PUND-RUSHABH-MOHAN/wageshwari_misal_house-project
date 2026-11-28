"""Estimated delivery time (part 7d). Always calculated here, never taken from the app.

  estimate = now + cooking time + travel time, rounded up to the next 5 minutes (IST)
  cooking  = the hotel's base cooking time (store.prep_minutes, default 20, editable in the Kitchen tab)
             + 2 minutes for each order already waiting in the kitchen today, at most +30
  travel   = 5 minutes (pick-up / hand-over) + 4 minutes per km from the hotel to the address pin
             (straight-line distance; about 17 minutes at 3 km)

Updated (orders.py / admin.py / delivery.py):
  - at Confirm: never earlier than confirm time + cooking + travel (UPI payments can take a while)
  - at Picked up: pick-up time + travel
  - by the admin: + delay minutes, with a reason
Customers see "Delayed" once the estimate is DELAY_NOTICE_MINUTES or more later than first promised.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone

from boto3.dynamodb.conditions import Key

import store
import users

IST = timezone(timedelta(hours=5, minutes=30))

PER_QUEUED_ORDER_MINUTES = 2
MAX_QUEUE_MINUTES = 30
TRAVEL_BASE_MINUTES = 5
TRAVEL_MINUTES_PER_KM = 4
ROUND_TO_MINUTES = 5
DELAY_NOTICE_MINUTES = 10
DEFAULT_DISTANCE_KM = 2.0  # no address yet (dish details screen): a typical distance

# Orders still waiting for (or in) the kitchen: they make the next one slower.
KITCHEN_QUEUE = ("PENDING", "PENDING_PAYMENT", "CONFIRMED", "PREPARING", "ASSIGNED")


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def round_up(moment: datetime) -> datetime:
    """Up to the next whole 5 minutes (seconds dropped): 13:31:10 -> 13:35, 13:35:00 -> 13:35."""
    moment = moment.replace(microsecond=0)
    step = ROUND_TO_MINUTES * 60
    seconds = int(moment.timestamp())
    return datetime.fromtimestamp(math.ceil(seconds / step) * step, tz=timezone.utc)


def kitchen_queue(day: str, exclude_id: str | None = None) -> int:
    """How many of today's orders are still waiting for or in the kitchen."""
    count = 0
    kwargs = {"IndexName": "GSI1", "KeyConditionExpression": Key("GSI1PK").eq(f"ORDERDATE#{day}")}
    while True:
        page = users.table().query(**kwargs)
        for item in page.get("Items", []):
            if item.get("status") in KITCHEN_QUEUE and item.get("id") != exclude_id:
                # an unpaid UPI order that nobody has paid for yet doesn't load the kitchen
                if item.get("status") == "PENDING_PAYMENT" and item.get("payment_status") == "pending":
                    continue
                count += 1
        if "LastEvaluatedKey" not in page:
            return count
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def cooking_minutes(queue: int, settings: dict | None = None) -> int:
    base = store.prep_minutes(settings if settings is not None else store.get_settings())
    return base + min(queue * PER_QUEUED_ORDER_MINUTES, MAX_QUEUE_MINUTES)


def travel_minutes(distance_km: float | None) -> int:
    distance = DEFAULT_DISTANCE_KM if distance_km is None else max(0.0, float(distance_km))
    return math.ceil(TRAVEL_BASE_MINUTES + TRAVEL_MINUTES_PER_KM * distance)


def estimate(now: datetime, distance_km: float | None, *, exclude_id: str | None = None) -> dict:
    """{prep_minutes, travel_minutes, total_minutes, estimated_delivery_at, queue}."""
    day = now.astimezone(IST).date().isoformat()
    queue = kitchen_queue(day, exclude_id)
    prep = cooking_minutes(queue)
    travel = travel_minutes(distance_km)
    at = round_up(now + timedelta(minutes=prep + travel))
    return {
        "prep_minutes": prep,
        "travel_minutes": travel,
        "total_minutes": math.ceil((at - now).total_seconds() / 60),
        "estimated_delivery_at": iso(at),
        "queue": queue,
    }


def later_of(current: str | None, candidate: datetime) -> str:
    """The later of the stored estimate and `candidate` (estimates only move earlier at pick-up)."""
    stored = parse(current)
    return iso(candidate if stored is None or candidate > stored else stored)


def after_pickup(now: datetime, travel: int) -> str:
    return iso(round_up(now + timedelta(minutes=travel)))


def delay_minutes(item: dict) -> int:
    """How much later the current estimate is than the first one (0 if not later)."""
    first, current = parse(item.get("original_estimated_delivery_at")), parse(item.get("estimated_delivery_at"))
    if first is None or current is None:
        return 0
    return max(0, math.ceil((current - first).total_seconds() / 60))


def travel_for(item: dict) -> int:
    """The order's travel minutes (orders from before part 7d: from the address distance)."""
    if item.get("travel_minutes") is not None:
        return int(item["travel_minutes"])
    return travel_minutes((item.get("address_snapshot") or {}).get("distance_km"))


def at_confirm(item: dict, now: datetime) -> str:
    """Estimate when the kitchen confirms: never earlier than now + cooking + travel."""
    day = now.astimezone(IST).date().isoformat()
    queue = kitchen_queue(day, exclude_id=item.get("id"))
    candidate = round_up(now + timedelta(minutes=cooking_minutes(queue) + travel_for(item)))
    return later_of(item.get("estimated_delivery_at"), candidate)
