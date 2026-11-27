"""Part 7: direct UPI payments (no gateway), the kitchen's "Payment received", and auto-expiry."""
import json
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest

import admin
import expire
import orders
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    BOB,
    SIX_AM,
    TOMORROW,
    clock,
    env,
    ev,
    invoke,
    make_address,
    place,
)

CHEF = {"sub": "cccccccc-0000-0000-0000-000000000003", "email": "chef@example.com", "cognito:groups": "[admin]"}
UTR = "412345678901"


@pytest.fixture
def upi(env, monkeypatch):
    monkeypatch.setenv("UPI_ID", "Hotel.Test@IBL")  # stored/shown lower-case
    monkeypatch.setenv("UPI_PAYEE_NAME", "Wagheshwar Misal House")
    monkeypatch.setenv("PAYMENT_WINDOW_MINUTES", "30")
    return env


def upi_order(claims=ALICE, key="upi-key-0001", **over):
    adr = make_address(claims)
    status, o, _ = place(adr, claims, key=key, payment_method="online", delivery_date=TOMORROW, **over)
    assert status == 201, o
    return o


def pay(order_id, utr=UTR, claims=ALICE):
    event = ev("POST /orders/{id}/payment", claims, {"utr": utr}, order_id=order_id, key=None)
    return invoke(orders, event)[:2]


def kitchen(order_id, status, reason=None):
    body = {"status": status, **({"reason": reason} if reason else {})}
    event = {
        "routeKey": "POST /admin/orders/{id}/status",
        "requestContext": {"authorizer": {"jwt": {"claims": CHEF}}},
        "pathParameters": {"id": order_id},
        "body": json.dumps(body),
    }
    return invoke(admin, event)[:2]


def get(order_id, claims=ALICE):
    return invoke(orders, ev("GET /orders/{id}", claims, order_id=order_id))[1]


# ---------------------------------------------------------------- placing
def test_upi_order_waits_for_payment_with_link(upi):
    o = upi_order()
    assert o["status"] == "PENDING_PAYMENT" and o["payment_status"] == "pending" and o["payment_method"] == "online"
    assert o["payment_expires_at"] == "2026-11-13T01:00:00.000Z"  # 06:00 IST + 30 min
    p = o["upi_payment"]
    assert p["upi_id"] == "hotel.test@ibl" and p["amount"] == "250.50" and p["note"] == f"Order {o['order_number']}"
    url = urlparse(p["uri"])
    assert url.scheme == "upi" and url.netloc == "pay"
    q = parse_qs(url.query)
    assert q == {
        "pa": ["hotel.test@ibl"], "pn": ["Wagheshwar Misal House"], "am": ["250.50"], "cu": ["INR"],
        "tn": [f"Order {o['order_number']}"], "tr": [o["order_number"]],
    }


def test_cod_unchanged(upi):
    adr = make_address()
    _, o, _ = place(adr)
    assert o["status"] == "CONFIRMED" and "upi_payment" not in o and "payment_expires_at" not in o


def test_upi_off_when_no_upi_id(env):
    adr = make_address()
    status, out, _ = place(adr, payment_method="online")
    assert status == 400 and out["error"]["code"] == "PAYMENT_METHOD_UNAVAILABLE"


def test_amount_text():
    assert orders.amount_text(25050) == "250.50" and orders.amount_text(10000) == "100.00"
    assert orders.amount_text(3105) == "31.05"


# ---------------------------------------------------------------- "I've paid" (UTR)
def test_submit_utr(upi):
    o = upi_order()
    status, out = pay(o["id"], "4123 4567 8901")  # spaces are fine
    assert status == 200 and out["utr"] == UTR and out["payment_status"] == "submitted"
    assert out["status"] == "PENDING_PAYMENT"
    assert pay(o["id"])[0] == 200  # same UTR again: harmless


@pytest.mark.parametrize("utr", ["", "12345", "1234567890123", "41234567890A", None, 412345678901])
def test_bad_utr(upi, utr):
    o = upi_order()
    status, out = pay(o["id"], utr)
    assert status == 400 and out["error"]["code"] == "VALIDATION_ERROR"


def test_utr_cannot_be_reused(upi):
    a = upi_order(ALICE, key="upi-key-a")
    b = upi_order(BOB, key="upi-key-b")
    assert pay(a["id"])[0] == 200
    status, out = pay(b["id"], claims=BOB)
    assert status == 409 and out["error"]["code"] == "UTR_ALREADY_USED"


def test_correcting_a_utr_frees_the_old_one(upi):
    a = upi_order(ALICE, key="upi-key-c")
    b = upi_order(BOB, key="upi-key-d")
    pay(a["id"], "111111111111")
    status, out = pay(a["id"], UTR)  # typo fixed
    assert status == 200 and out["utr"] == UTR
    assert pay(b["id"], "111111111111", claims=BOB)[0] == 200


def test_cash_order_is_not_payable(upi):
    adr = make_address()
    _, o, _ = place(adr)
    status, out = pay(o["id"])
    assert status == 409 and out["error"]["code"] == "ORDER_NOT_PAYABLE"


def test_someone_elses_order(upi):
    o = upi_order()
    assert pay(o["id"], claims=BOB)[0] == 404


# ---------------------------------------------------------------- customer cancel
def test_customer_can_cancel_before_paying(upi):
    o = upi_order()
    status, c, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 200 and c["status"] == "CANCELLED" and "upi_payment" not in c
    status, out = pay(o["id"])
    assert status == 409 and "cancelled" in out["error"]["message"]


def test_customer_cannot_cancel_after_sending_utr(upi):
    o = upi_order()
    pay(o["id"])
    status, out, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 409 and out["error"]["code"] == "ORDER_NOT_CANCELLABLE"
    assert "refund" in out["error"]["message"]


# ---------------------------------------------------------------- kitchen
def test_kitchen_confirms_payment_then_cooks(upi):
    o = upi_order()
    pay(o["id"])
    status, out = kitchen(o["id"], "PREPARING")  # can't cook before the money is checked
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"
    status, out = kitchen(o["id"], "CONFIRMED")
    assert status == 200 and out["status"] == "CONFIRMED" and out["payment_status"] == "paid"
    assert "upi_payment" not in out and out["utr"] == UTR
    assert [h["status"] for h in out["status_history"]] == ["PENDING_PAYMENT", "CONFIRMED"]
    mine = get(o["id"])
    assert mine["payment_status"] == "paid" and "upi_payment" not in mine
    status, out = pay(o["id"], "999999999999")
    assert status == 409 and out["error"]["code"] == "ORDER_NOT_PAYABLE"
    for step in ("PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"):
        assert kitchen(o["id"], step)[0] == 200


def test_kitchen_can_confirm_without_utr(upi):
    """The money showed up in the hotel's UPI app but the customer never typed the UTR."""
    o = upi_order()
    status, out = kitchen(o["id"], "CONFIRMED")
    assert status == 200 and out["payment_status"] == "paid"


def test_kitchen_not_received(upi):
    o = upi_order()
    pay(o["id"])
    status, out = kitchen(o["id"], "CANCELLED", reason="Payment not received")
    assert status == 200 and out["status"] == "CANCELLED"
    assert get(o["id"])["cancel_reason"] == "Payment not received"


def test_cod_cannot_be_payment_confirmed_twice(upi):
    adr = make_address()
    _, o, _ = place(adr)
    status, out = kitchen(o["id"], "CONFIRMED")
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"


# ---------------------------------------------------------------- auto-expiry
def test_expire_cancels_only_overdue_unpaid(upi):
    unpaid = upi_order(ALICE, key="exp-key-1")
    with_utr = upi_order(ALICE, key="exp-key-2", slot_label="Afternoon 12:00 - 1:00 PM")
    pay(with_utr["id"])
    adr = make_address(BOB)
    _, cod, _ = place(adr, BOB, key="exp-key-3", delivery_date=TOMORROW)

    upi["clock"]["now"] = SIX_AM + timedelta(minutes=29)
    assert expire.expire_unpaid() == []  # not overdue yet

    upi["clock"]["now"] = SIX_AM + timedelta(minutes=31)
    late = upi_order(BOB, key="exp-key-4")  # placed just now: still has 30 minutes
    assert expire.handler({}, None) == {"cancelled": [unpaid["order_number"]]}

    gone = get(unpaid["id"])
    assert gone["status"] == "CANCELLED" and gone["cancelled_by"] == "system" and "call the hotel" in gone["cancel_reason"]
    assert get(with_utr["id"])["status"] == "PENDING_PAYMENT"
    assert get(cod["id"], BOB)["status"] == "CONFIRMED"
    assert get(late["id"], BOB)["status"] == "PENDING_PAYMENT"
    assert expire.expire_unpaid() == []  # nothing left to do; running again is harmless


def test_expire_skips_order_paid_meanwhile(upi, monkeypatch):
    """The customer sends the UTR between the scan and the write: the conditional write skips it."""
    o = upi_order()
    upi["clock"]["now"] = SIX_AM + timedelta(minutes=40)
    real = expire._pending_for_day

    def stale(day):
        items = real(day)
        if items:
            pay(o["id"])  # arrives after the scan
        return items

    monkeypatch.setattr(expire, "_pending_for_day", stale)
    assert expire.expire_unpaid() == []
    assert get(o["id"])["status"] == "PENDING_PAYMENT"
