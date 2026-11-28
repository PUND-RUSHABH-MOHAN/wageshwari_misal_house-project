"""Part 7b: 9 AM - 9 PM hourly slots, and the admin switch that stops online orders."""
import json

import pytest

import admin
import catalog
import orders
import store
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    TOMORROW,
    clock,
    env,
    ev,
    invoke,
    make_address,
    place,
)

CHEF = {"sub": "cccccccc-0000-0000-0000-000000000003", "email": "chef@example.com", "cognito:groups": "[admin]"}


def get_store():
    catalog.reset_clients()
    status, body, resp = invoke(catalog, {"routeKey": "GET /store", "requestContext": {}})
    assert status == 200
    return body, resp


def set_store(body, claims=CHEF):
    event = {
        "routeKey": "PATCH /admin/store",
        "requestContext": {"authorizer": {"jwt": {"claims": claims}}},
        "body": json.dumps(body),
    }
    return invoke(admin, event)[:2]


# ---------------------------------------------------------------- slots
def test_slots_are_hourly_9am_to_9pm():
    starts = [s[3] for s in orders.SLOTS]
    assert starts == list(range(9, 21))
    assert min(starts) == store.OPEN_HOUR and max(starts) + 1 == store.CLOSE_HOUR
    labels = list(orders.SLOTS_BY_LABEL)
    assert len(set(labels)) == 12
    assert labels[0] == "Morning 9:00 - 10:00 AM"
    assert "Morning 11:00 AM - 12:00 PM" in labels
    assert labels[-1] == "Evening 8:00 - 9:00 PM"


def test_old_slot_labels_refused(env):
    adr = make_address()
    status, out, _ = place(adr, slot_label="Early Bird 7:00 - 8:00 AM")
    assert status == 400 and out["error"]["code"] == "VALIDATION_ERROR"


def test_evening_slot_can_be_booked(env):
    adr = make_address()
    status, o, _ = place(adr, slot_label="Evening 8:00 - 9:00 PM")
    assert status == 201 and o["slot_label"] == "Evening 8:00 - 9:00 PM"


# ---------------------------------------------------------------- GET /store
def test_open_by_default(env):
    body, resp = get_store()
    assert body == {"accepting_orders": True, "message": "", "opens_at": "09:00", "closes_at": "21:00"}
    assert resp["headers"]["Cache-Control"] == "no-store"


# ---------------------------------------------------------------- the switch
def test_close_blocks_all_new_orders(env):
    status, out = set_store({"accepting_orders": False, "message": "Closed today for Diwali"})
    assert status == 200 and out["accepting_orders"] is False and out["updated_by"] == "chef@example.com"
    body, _ = get_store()
    assert body["accepting_orders"] is False and body["message"] == "Closed today for Diwali"

    adr = make_address()
    for day in (None, TOMORROW):  # today and pre-orders for tomorrow
        over = {"delivery_date": day} if day else {}
        status, out, _ = place(adr, key=f"closed-{day}", **over)
        assert status == 409 and out["error"]["code"] == "STORE_CLOSED"
        assert out["error"]["message"] == "Closed today for Diwali"


def test_close_without_message_uses_default(env):
    set_store({"accepting_orders": False})
    body, _ = get_store()
    assert body["message"] == store.DEFAULT_CLOSED_MESSAGE


def test_reopen_clears_message_and_allows_orders(env):
    set_store({"accepting_orders": False, "message": "Back at 5"})
    status, out = set_store({"accepting_orders": True})
    assert status == 200 and out["accepting_orders"] is True and out["message"] == ""
    adr = make_address()
    assert place(adr)[0] == 201


def test_existing_orders_keep_working_while_closed(env, monkeypatch):
    monkeypatch.setenv("UPI_ID", "hotel@ibl")
    monkeypatch.setenv("UPI_PAYEE_NAME", "Hotel")
    adr = make_address()
    _, cod, _ = place(adr, key="before-close-1")
    _, upi, _ = place(adr, key="before-close-2", payment_method="online")
    set_store({"accepting_orders": False})
    # a retry of a checkout that succeeded before closing still gets its order back
    status, again, _ = place(adr, key="before-close-1")
    assert status == 201 and again["id"] == cod["id"]
    # the customer can still pay a UPI order placed before closing
    pay = ev("POST /orders/{id}/payment", ALICE, {"utr": "412345678901"}, order_id=upi["id"], key=None)
    assert invoke(orders, pay)[0] == 200
    # the kitchen can still move orders
    move = {
        "routeKey": "POST /admin/orders/{id}/status",
        "requestContext": {"authorizer": {"jwt": {"claims": CHEF}}},
        "pathParameters": {"id": cod["id"]},
        "body": json.dumps({"status": "CONFIRMED"}),
    }
    assert invoke(admin, move)[0] == 200
    # ...but a brand-new order is refused
    assert place(adr, key="before-close-3")[0] == 409


def test_customer_cannot_flip_the_switch(env):
    status, out = set_store({"accepting_orders": False}, claims=ALICE)
    assert status == 403 and out["error"]["code"] == "FORBIDDEN"
    assert get_store()[0]["accepting_orders"] is True


@pytest.mark.parametrize("body", [
    {},
    {"accepting_orders": "no"},
    {"accepting_orders": 0},
    {"accepting_orders": False, "message": "x" * 121},
    {"accepting_orders": False, "message": 5},
    {"accepting_orders": False, "reason": "x"},
])
def test_switch_validation(env, body):
    status, out = set_store(body)
    assert status == 400 and out["error"]["code"] == "VALIDATION_ERROR"
