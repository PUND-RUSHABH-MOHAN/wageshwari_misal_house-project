"""Parts 7b/7d: ordering hours, the cooking-time setting and the switch that stops online orders."""
import json
from datetime import datetime

import pytest

import admin
import catalog
import orders
import store
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    IST,
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


# ---------------------------------------------------------------- hours
def test_ordering_hours_9am_to_830pm():
    assert store.within_hours(datetime(2026, 11, 13, 9, 0, tzinfo=IST))
    assert store.within_hours(datetime(2026, 11, 13, 20, 30, tzinfo=IST))
    assert not store.within_hours(datetime(2026, 11, 13, 8, 59, tzinfo=IST))
    assert not store.within_hours(datetime(2026, 11, 13, 20, 31, tzinfo=IST))


# ---------------------------------------------------------------- cooking time
def test_cooking_time_setting_changes_new_estimates(env):
    adr = make_address()
    status, out = set_store({"prep_minutes": 35})
    assert status == 200 and out["prep_minutes"] == 35 and out["accepting_orders"] is True
    _, o, _ = place(adr)
    assert o["prep_minutes"] == 35
    assert get_store()[0]["prep_minutes"] == 35


def test_cooking_time_keeps_the_switch(env):
    set_store({"accepting_orders": False, "message": "Rain"})
    status, out = set_store({"prep_minutes": 25})
    assert status == 200 and out["accepting_orders"] is False and out["message"] == "Rain"
    status, out = set_store({"accepting_orders": True})
    assert out["prep_minutes"] == 25  # re-opening keeps the cooking time


@pytest.mark.parametrize("minutes", [4, 91, "20", 20.5, True])
def test_cooking_time_validation(env, minutes):
    status, out = set_store({"prep_minutes": minutes})
    assert status == 400 and out["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------- GET /store
def test_open_by_default(env):
    body, resp = get_store()
    assert body == {
        "accepting_orders": True, "message": "", "opens_at": "09:00", "closes_at": "21:00",
        "last_order_at": "20:30", "prep_minutes": 20,
    }
    assert resp["headers"]["Cache-Control"] == "no-store"


# ---------------------------------------------------------------- the switch
def test_close_blocks_all_new_orders(env):
    status, out = set_store({"accepting_orders": False, "message": "Closed today for Diwali"})
    assert status == 200 and out["accepting_orders"] is False and out["updated_by"] == "chef@example.com"
    body, _ = get_store()
    assert body["accepting_orders"] is False and body["message"] == "Closed today for Diwali"

    adr = make_address()
    status, out, _ = place(adr, key="closed-1")
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
