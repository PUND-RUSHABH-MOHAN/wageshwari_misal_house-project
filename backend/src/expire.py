"""Scheduled Lambda (EventBridge Scheduler, every 10 minutes): cancel UPI orders that were never paid.

A UPI order starts PENDING_PAYMENT with `payment_expires_at` (created + PAYMENT_WINDOW_MINUTES).
If that time has passed and the customer never sent a UTR, the order is cancelled with
cancelled_by = "system" and a reason the customer sees. Orders with a UTR are left for the kitchen
to check (the money may well have arrived).

Not behind API Gateway: the only caller is the schedule.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

import orders
import users

log = logging.getLogger()
log.setLevel(logging.INFO)

REASON = "Payment not received in time. If you did pay, please call the hotel."


def _pending_for_day(day: str) -> list[dict]:
    """PENDING_PAYMENT orders for one delivery day (index GSI1)."""
    items: list[dict] = []
    kwargs = {
        "IndexName": "GSI1",
        "KeyConditionExpression": Key("GSI1PK").eq(f"ORDERDATE#{day}"),
    }
    while True:
        page = users.table().query(**kwargs)
        items.extend(i for i in page.get("Items", []) if i.get("status") == "PENDING_PAYMENT")
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def expire_unpaid() -> list[str]:
    """Cancel overdue unpaid UPI orders; returns their order numbers."""
    now = orders._now_utc()
    now_iso = orders._iso(now)
    today = now.astimezone(orders.IST).date()
    days = [(today + timedelta(days=d)).isoformat() for d in (-1, 0, 1)]  # yesterday covers a missed run

    cancelled = []
    for day in days:
        for item in _pending_for_day(day):
            if item.get("utr") or item.get("payment_expires_at", now_iso) > now_iso:
                continue
            try:
                users.table().update_item(
                    Key={"PK": item["PK"], "SK": item["SK"]},
                    UpdateExpression=(
                        "SET #s = :cancelled, cancelled_at = :now, updated_at = :now, cancelled_by = :system, "
                        "cancel_reason = :reason, "
                        "status_history = list_append(if_not_exists(status_history, :empty), :entry)"
                    ),
                    # Re-checked at write time: the customer may have sent a UTR a moment ago.
                    ConditionExpression="#s = :pending AND attribute_not_exists(utr)",
                    ExpressionAttributeNames={"#s": "status"},
                    ExpressionAttributeValues={
                        ":cancelled": "CANCELLED",
                        ":pending": "PENDING_PAYMENT",
                        ":now": now_iso,
                        ":system": "system",
                        ":reason": REASON,
                        ":empty": [],
                        ":entry": [orders.history_entry("CANCELLED", now_iso, "system")],
                    },
                )
            except ClientError as err:
                if err.response["Error"]["Code"] == "ConditionalCheckFailedException":
                    continue
                raise
            cancelled.append(item["order_number"])
    return cancelled


def handler(event, context):  # noqa: ARG001 - Lambda signature
    cancelled = expire_unpaid()
    log.info("expired %d unpaid UPI order(s): %s", len(cancelled), ", ".join(cancelled) or "-")
    return {"cancelled": cancelled}
