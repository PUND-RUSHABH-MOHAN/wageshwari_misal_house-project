"""Delivery boys (part 7c): who can deliver, who is on duty, and writing assignments.

Used by admin.py (confirm + auto-assign, manual assign, the list of delivery boys) and
delivery.py (the delivery boy's own Deliveries tab).

Who is a delivery boy: a member of the Cognito group `delivery` (the owner adds people by hand,
like `admin`). The first time they open the Deliveries tab, a record is created here.

Storage (table wmh-main)
  PK = "DELIVERY", SK = "BOY#<cognito sub>"
     id, name, phone, email   copied from the person's profile (Account tab)
     on_duty, on_duty_date    "on duty" only counts on the IST day it was switched on, so
                              nobody stays on duty overnight by mistake
     last_assigned_at         tie-break for auto-assign
  An assigned order carries delivery_boy_id / _name / _phone, assigned_at, assigned_by.

Auto-assign picks, among delivery boys on duty today, the one with the fewest active deliveries
(ASSIGNED or OUT_FOR_DELIVERY); if tied, the one who waited longest since his last order.
The order change and the delivery boy's `last_assigned_at` are one transaction, conditional on
the order's status (and, for auto-assign, on the delivery boy still being on duty).
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import orders
import users
from common import ApiError

PK = "DELIVERY"
GROUP = "delivery"
ACTIVE = ("ASSIGNED", "OUT_FOR_DELIVERY")
STATE = "Maharashtra"  # addresses don't store a state: the hotel only delivers around Jalna
_MISSING = object()


class OrderChanged(Exception):
    """The order isn't in the status (or with the delivery boy) the caller saw."""


class BoyUnavailable(Exception):
    """The delivery boy went off duty (or was removed) in the meantime."""


def boy_key(boy_id: str) -> dict:
    return {"PK": PK, "SK": f"BOY#{boy_id}"}


def today_ist() -> str:
    return orders._now_utc().astimezone(orders.IST).date().isoformat()


def is_on_duty(item: dict) -> bool:
    return bool(item.get("on_duty")) and item.get("on_duty_date") == today_ist()


def get_boy(boy_id: str) -> dict | None:
    if not boy_id or not isinstance(boy_id, str) or len(boy_id) > 64:
        return None
    return users.table().get_item(Key=boy_key(boy_id), ConsistentRead=True).get("Item")


def all_boys() -> list[dict]:
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("PK").eq(PK) & Key("SK").begins_with("BOY#")}
    while True:
        page = users.table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def recent_orders() -> list[dict]:
    """Orders for yesterday, today and tomorrow (IST): every order that can still be active."""
    today = orders._now_utc().astimezone(orders.IST).date()
    items: list[dict] = []
    for offset in (-1, 0, 1):
        day = (today + timedelta(days=offset)).isoformat()
        kwargs = {"IndexName": "GSI1", "KeyConditionExpression": Key("GSI1PK").eq(f"ORDERDATE#{day}")}
        while True:
            page = users.table().query(**kwargs)
            items.extend(page.get("Items", []))
            if "LastEvaluatedKey" not in page:
                break
            kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return items


def active_counts(items: list[dict] | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in recent_orders() if items is None else items:
        boy = item.get("delivery_boy_id")
        if boy and item.get("status") in ACTIVE:
            counts[boy] = counts.get(boy, 0) + 1
    return counts


def to_boy(item: dict, counts: dict[str, int]) -> dict:
    """What admins see in the delivery boy list (and the delivery boy sees about himself)."""
    return {
        "id": item["id"],
        "name": item.get("name") or item.get("email", ""),
        "phone": item.get("phone", ""),
        "on_duty": is_on_duty(item),
        "active_orders": counts.get(item["id"], 0),
        "last_assigned_at": item.get("last_assigned_at"),
    }


def candidates() -> list[dict]:
    """On-duty delivery boys, best first (fewest active deliveries, then longest wait)."""
    counts = active_counts()
    on_duty = [b for b in all_boys() if is_on_duty(b)]
    return sorted(on_duty, key=lambda b: (counts.get(b["id"], 0), b.get("last_assigned_at") or "", b["id"]))


def register(claims: dict, now: str) -> dict:
    """Get the caller's delivery-boy record, creating it (from their profile) the first time."""
    boy_id = claims["sub"]
    item = get_boy(boy_id)
    if item is not None:
        return item
    profile = users.get_or_create_profile(boy_id, email=claims.get("email", ""))
    item = {
        **boy_key(boy_id),
        "entity": "DELIVERY_BOY",
        "id": boy_id,
        "name": profile.get("name", ""),
        "phone": profile.get("phone", ""),
        "email": profile.get("email", ""),
        "on_duty": False,
        "created_at": now,
        "updated_at": now,
    }
    try:
        users.table().put_item(Item=item, ConditionExpression="attribute_not_exists(PK)")
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        return get_boy(boy_id) or item
    return item


def set_on_duty(boy_id: str, on_duty: bool, now: str, *, profile: dict | None = None) -> dict:
    """Switch on / off duty. Switching on refreshes name and phone from the profile."""
    names = {"#d": "on_duty"}
    values: dict[str, Any] = {":d": on_duty, ":day": today_ist(), ":now": now}
    sets = ["#d = :d", "on_duty_date = :day", "updated_at = :now"]
    if profile is not None:
        values.update({":name": profile.get("name", ""), ":phone": profile.get("phone", "")})
        sets += ["#n = :name", "phone = :phone"]
        names["#n"] = "name"
    try:
        return users.table().update_item(
            Key=boy_key(boy_id),
            UpdateExpression="SET " + ", ".join(sets),
            ConditionExpression="attribute_exists(PK)",
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ReturnValues="ALL_NEW",
        )["Attributes"]
    except ClientError as err:
        if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
            raise
        raise ApiError(404, "NOT_FOUND", "Delivery boy not found.") from err


def write_order(
    order: dict,
    *,
    status: str,
    history: list[dict],
    now: str,
    sets: list[str] | None = None,
    values: dict[str, Any] | None = None,
    boy: dict | None = None,
    by: str = "",
    require_on_duty: bool = False,
    expected_boy: Any = _MISSING,
) -> dict:
    """Move `order` from the status it had when read to `status`, appending `history`.

    With `boy`, the order is assigned to him and his `last_assigned_at` is stamped in the same
    transaction. `expected_boy` (an id, or None for "nobody yet") adds a condition on who the
    order is assigned to. Raises OrderChanged / BoyUnavailable; returns the updated order item.
    """
    names = {"#s": "status"}
    vals: dict[str, Any] = {
        ":current": order["status"],
        ":new": status,
        ":now": now,
        ":empty": [],
        ":entries": history,
        **(values or {}),
    }
    parts = [
        "#s = :new",
        "updated_at = :now",
        "status_history = list_append(if_not_exists(status_history, :empty), :entries)",
        *(sets or []),
    ]
    condition = "#s = :current"
    if expected_boy is None:
        condition += " AND attribute_not_exists(delivery_boy_id)"
    elif expected_boy is not _MISSING:
        condition += " AND delivery_boy_id = :expected_boy"
        vals[":expected_boy"] = expected_boy
    if boy is not None:
        parts += [
            "delivery_boy_id = :boy_id",
            "delivery_boy_name = :boy_name",
            "delivery_boy_phone = :boy_phone",
            "assigned_at = :now",
            "assigned_by = :assigned_by",
        ]
        vals.update({
            ":boy_id": boy["id"],
            ":boy_name": boy.get("name") or boy.get("email", ""),
            ":boy_phone": boy.get("phone", ""),
            ":assigned_by": by,
        })
    key = {"PK": order["PK"], "SK": order["SK"]}
    update = {
        "Key": key,
        "UpdateExpression": "SET " + ", ".join(parts),
        "ConditionExpression": condition,
        "ExpressionAttributeNames": names,
        "ExpressionAttributeValues": vals,
    }
    table = users.table()
    if boy is None:
        try:
            return table.update_item(**update, ReturnValues="ALL_NEW")["Attributes"]
        except ClientError as err:
            if err.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
            raise OrderChanged from err

    boy_condition = "attribute_exists(PK)"
    boy_values: dict[str, Any] = {":now": now}
    if require_on_duty:
        boy_condition += " AND on_duty = :yes AND on_duty_date = :day"
        boy_values.update({":yes": True, ":day": today_ist()})
    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {"Update": {"TableName": table.name, **update}},
                {
                    "Update": {
                        "TableName": table.name,
                        "Key": boy_key(boy["id"]),
                        "UpdateExpression": "SET last_assigned_at = :now",
                        "ConditionExpression": boy_condition,
                        "ExpressionAttributeValues": boy_values,
                    }
                },
            ]
        )
    except ClientError as err:
        if err.response["Error"]["Code"] != "TransactionCanceledException":
            raise
        reasons = [r.get("Code") for r in err.response.get("CancellationReasons", [])]
        if len(reasons) > 1 and reasons[0] != "ConditionalCheckFailed" and reasons[1] == "ConditionalCheckFailed":
            raise BoyUnavailable from err
        raise OrderChanged from err
    return table.get_item(Key=key, ConsistentRead=True)["Item"]
