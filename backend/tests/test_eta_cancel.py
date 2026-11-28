"""Part 7d: the delivery estimate through the order's life, delays, and cancelling until out for delivery."""

from datetime import timedelta

import pytest

import admin
import orders
from test_delivery import CHEF, RAMU, call, confirm, my_orders, on_duty, order, step
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    BOB,
    IST,
    TEN_AM,
    clock,
    env,
    ev,
    invoke,
)


def cancel(o, claims=ALICE):
    return invoke(orders, ev("POST /orders/{id}/cancel", claims, order_id=o["id"]))[:2]


def mine(o, claims=ALICE):
    return invoke(orders, ev("GET /orders/{id}", claims, order_id=o["id"]))[1]


def delay(o, minutes, reason=None):
    body = {"delay_minutes": minutes, **({"reason": reason} if reason else {})}
    return call(admin, "PATCH /admin/orders/{id}/eta", CHEF, body, o["id"])


def refund(o, status, reference=None):
    body = {"status": status, **({"reference": reference} if reference else {})}
    return call(admin, "POST /admin/orders/{id}/refund", CHEF, body, o["id"])


def hhmm(iso):
    return orders.eta.parse(iso).astimezone(IST).strftime("%H:%M")


# ---------------------------------------------------------------- estimate updates
def test_late_confirm_pushes_the_estimate(env):
    o = order()  # 10:00, estimate 10:35
    env["clock"]["now"] = TEN_AM + timedelta(minutes=25)  # kitchen only confirms at 10:25
    _, out = confirm(o["id"])
    assert hhmm(out["estimated_delivery_at"]) == "11:00"  # 10:25 + 20 + 12 = 10:57 -> 11:00
    assert hhmm(out["original_estimated_delivery_at"]) == "10:35"
    seen = mine(o)
    assert seen["delay_minutes"] == 25 and seen["delayed"] is True


def test_quick_confirm_keeps_the_estimate(env):
    o = order()
    env["clock"]["now"] = TEN_AM + timedelta(minutes=2)
    _, out = confirm(o["id"])
    assert out["estimated_delivery_at"] == o["estimated_delivery_at"]
    assert "delayed" not in mine(o)


def test_pickup_sets_now_plus_travel(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    env["clock"]["now"] = TEN_AM + timedelta(minutes=12)
    status, job = step(o["id"], "OUT_FOR_DELIVERY")
    assert status == 200 and hhmm(job["estimated_delivery_at"]) == "10:25"  # 10:12 + 12 -> 10:24 -> 10:25
    assert "delayed" not in mine(o)  # earlier than promised is fine


def test_delivery_boy_and_admin_see_the_estimate(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    assert my_orders()[0]["estimated_delivery_at"] == o["estimated_delivery_at"]
    _, board = call(admin, "GET /admin/orders", CHEF)
    assert board[0]["estimated_delivery_at"] == o["estimated_delivery_at"]


# ---------------------------------------------------------------- admin delay
def test_admin_delay_and_customer_notice(env):
    o = order()
    status, out = delay(o, 15, "  Heavy  rush ")
    assert status == 200 and hhmm(out["estimated_delivery_at"]) == "10:50"
    assert out["delay_reason"] == "Heavy rush" and out["eta_updated_by"] == "chef@example.com"
    seen = mine(o)
    assert seen["delayed"] is True and seen["delay_minutes"] == 15 and seen["delay_reason"] == "Heavy rush"
    _, out = delay(o, 5)
    assert hhmm(out["estimated_delivery_at"]) == "10:55" and out["delay_reason"] == ""


def test_small_delay_has_no_notice(env):
    o = order()
    delay(o, 5)
    seen = mine(o)
    assert seen["delay_minutes"] == 5 and seen["delayed"] is False


def test_delay_counts_from_now_when_the_estimate_has_passed(env):
    o = order()
    env["clock"]["now"] = TEN_AM + timedelta(hours=1)  # 11:00, estimate was 10:35
    _, out = delay(o, 10)
    assert hhmm(out["estimated_delivery_at"]) == "11:10"


@pytest.mark.parametrize("body", [{}, {"delay_minutes": 4}, {"delay_minutes": 121}, {"delay_minutes": "10"},
                                  {"delay_minutes": 10, "reason": "x" * 121}, {"delay_minutes": 10, "eta": "x"}])
def test_delay_validation(env, body):
    o = order()
    assert call(admin, "PATCH /admin/orders/{id}/eta", CHEF, body, o["id"])[0] == 400


def test_no_delay_for_finished_orders_or_customers(env):
    o = order()
    assert call(admin, "PATCH /admin/orders/{id}/eta", ALICE, {"delay_minutes": 10}, o["id"])[0] == 403
    cancel(o)
    status, out = delay(o, 10)
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"


# ---------------------------------------------------------------- cancelling
def test_customer_can_cancel_after_assignment_and_the_delivery_boy_sees_it(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    status, out = cancel(o)
    assert status == 200 and out["status"] == "CANCELLED" and out["cancelled_by"] == "customer"
    assert out["cancelled_at"]
    [job] = my_orders()
    assert job["status"] == "CANCELLED" and job["cancelled_by"] == "customer" and "customer" not in job
    status, out = step(o["id"], "OUT_FOR_DELIVERY")
    assert status == 409 and "The customer cancelled" in out["error"]["message"]
    _, board = call(admin, "GET /admin/orders", CHEF)
    assert board[0]["status"] == "CANCELLED" and board[0]["cancelled_at"]
    status, out = call(admin, "POST /admin/orders/{id}/assign", CHEF, {"delivery_boy_id": RAMU["sub"]}, o["id"])
    assert status == 409  # cancelled orders can't be assigned again


def test_cannot_cancel_once_picked_up(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    step(o["id"], "OUT_FOR_DELIVERY")
    status, out = cancel(o)
    assert status == 409 and out["error"]["code"] == "ORDER_NOT_CANCELLABLE" and "on the way" in out["error"]["message"]


def test_pickup_wins_a_race_with_cancel(env, monkeypatch):
    """The customer's app read ASSIGNED; the delivery boy taps Picked up first."""
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    stale = orders._get_order_item(ALICE["sub"], o["id"])
    step(o["id"], "OUT_FOR_DELIVERY")
    real = orders._get_order_item
    calls = {"n": 0}

    def first_stale(user_id, order_id):
        calls["n"] += 1
        return stale if calls["n"] == 1 else real(user_id, order_id)

    monkeypatch.setattr(orders, "_get_order_item", first_stale)
    status, out = cancel(o)
    assert status == 409 and out["error"]["code"] == "ORDER_NOT_CANCELLABLE"
    monkeypatch.setattr(orders, "_get_order_item", real)
    assert mine(o)["status"] == "OUT_FOR_DELIVERY"


def test_cancel_wins_a_race_with_pickup(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    cancel(o)
    status, out = step(o["id"], "OUT_FOR_DELIVERY")
    assert status == 409


def test_cancel_twice_and_someone_elses_order(env):
    o = order()
    assert cancel(o)[0] == 200
    status, out = cancel(o)
    assert status == 200 and out["status"] == "CANCELLED"
    assert [h["status"] for h in orders._get_order_item(ALICE["sub"], o["id"])["status_history"]].count("CANCELLED") == 1
    other = order(BOB, key="dlv-key-bob1")
    assert cancel(other, ALICE)[0] == 404


# ---------------------------------------------------------------- refunds (UPI, by hand)
@pytest.fixture
def upi(env, monkeypatch):
    monkeypatch.setenv("UPI_ID", "hotel.test@ibl")
    monkeypatch.setenv("UPI_PAYEE_NAME", "Wagheshwar Misal House")
    return env


def paid_upi_order(utr="412345678901"):
    o = order(payment_method="online", key="upi-ref-0001")
    invoke(orders, ev("POST /orders/{id}/payment", ALICE, {"utr": utr}, order_id=o["id"], key=None))
    confirm(o["id"])  # payment received
    return o


def test_paid_upi_cancel_needs_a_refund_then_marked(upi):
    o = paid_upi_order()
    status, out = cancel(o)
    assert status == 200 and out["refund_status"] == "pending" and out["payment_status"] == "paid"
    status, out = refund(o, "refunded", "UPI 512345678901")
    assert status == 200 and out["refund_status"] == "refunded" and out["refund_reference"] == "UPI 512345678901"
    assert out["refunded_by"] == "chef@example.com"
    assert mine(o)["refund_status"] == "refunded"
    status, out = refund(o, "refunded")
    assert status == 409 and out["error"]["code"] == "NO_REFUND_PENDING"  # can't mark twice


def test_kitchen_cancel_of_paid_upi_needs_a_refund(upi):
    o = paid_upi_order()
    _, out = admin_cancel(o)
    assert out["refund_status"] == "pending"
    status, out = refund(o, "not_needed")
    assert status == 200 and out["refund_status"] == "not_needed"


def admin_cancel(o):
    return call(admin, "POST /admin/orders/{id}/status", CHEF, {"status": "CANCELLED", "reason": "Out of stock"}, o["id"])


def test_refund_rules(upi):
    cod = order(key="cod-ref-0001")
    cancel(cod)
    status, out = refund(cod, "refunded")
    assert status == 409 and out["error"]["code"] == "NO_REFUND_PENDING"  # cash: nothing to refund
    o = paid_upi_order()
    cancel(o)
    assert refund(o, "maybe")[0] == 400
    assert call(admin, "POST /admin/orders/{id}/refund", CHEF, {"status": "refunded", "x": 1}, o["id"])[0] == 400
    assert call(admin, "POST /admin/orders/{id}/refund", ALICE, {"status": "refunded"}, o["id"])[0] == 403
