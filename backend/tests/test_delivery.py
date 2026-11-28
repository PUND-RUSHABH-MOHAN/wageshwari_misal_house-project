"""Part 7c: confirm + auto-assign, manual assignment and the delivery boy's Deliveries tab."""

import json
from datetime import datetime, timedelta

import pytest

import admin
import delivery
import delivery_boys
import orders
import users
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    BOB,
    IST,
    TEN_AM,
    TODAY,
    TOMORROW,
    clock,
    env,
    ev,
    invoke,
    make_address,
    place,
)

CHEF = {"sub": "cccccccc-0000-0000-0000-000000000003", "email": "chef@example.com", "cognito:groups": "[admin]"}
RAMU = {"sub": "dddddddd-0000-0000-0000-000000000004", "email": "ramu@example.com", "cognito:groups": "[delivery]"}
SHAM = {"sub": "eeeeeeee-0000-0000-0000-000000000005", "email": "sham@example.com", "cognito:groups": ["delivery"]}
OWNER = {"sub": "ffffffff-0000-0000-0000-000000000006", "email": "owner@example.com", "cognito:groups": "[admin delivery]"}


def call(module, route, claims, body=None, path_id=None):
    event = {"routeKey": route, "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
    if body is not None:
        event["body"] = json.dumps(body)
    if path_id is not None:
        event["pathParameters"] = {"id": path_id}
    status, out, _ = invoke(module, event)
    return status, out


def confirm(order_id, claims=CHEF):
    return call(admin, "POST /admin/orders/{id}/status", claims, {"status": "CONFIRMED"}, order_id)


def admin_move(order_id, status, reason=None):
    body = {"status": status, **({"reason": reason} if reason else {})}
    return call(admin, "POST /admin/orders/{id}/status", CHEF, body, order_id)


def assign(order_id, boy, claims=CHEF):
    return call(admin, "POST /admin/orders/{id}/assign", claims, {"delivery_boy_id": boy["sub"]}, order_id)


def step(order_id, status, boy=RAMU):
    return call(delivery, "POST /delivery/orders/{id}/status", boy, {"status": status}, order_id)


def my_orders(boy=RAMU):
    status, out = call(delivery, "GET /delivery/orders", boy)
    assert status == 200, out
    return out


def on_duty(boy, name="Ramu", phone="9123456780"):
    users.update_profile(boy["sub"], {"name": name, "phone": phone}, email=boy["email"])
    status, out = call(delivery, "PATCH /delivery/me", boy, {"on_duty": True})
    assert status == 200 and out["on_duty"] is True, out
    return out


def order(claims=ALICE, key="dlv-key-0001", **over):
    adr = make_address(claims)
    status, o, _ = place(adr, claims, key=key, **over)
    assert status == 201, o
    return o


def customer_view(o, claims=ALICE):
    return invoke(orders, ev("GET /orders/{id}", claims, order_id=o["id"]))[1]


# ---------------------------------------------------------------- access
@pytest.mark.parametrize("route", list(delivery.ROUTES))
@pytest.mark.parametrize("who", [ALICE, CHEF])
def test_delivery_routes_need_the_delivery_group(env, route, who):
    status, out = call(delivery, route, who, body={}, path_id="x")
    assert status == 403 and out["error"]["code"] == "FORBIDDEN"


def test_delivery_routes_need_login(env):
    status, _, _ = invoke(delivery, {"routeKey": "GET /delivery/orders", "requestContext": {}})
    assert status == 401


@pytest.mark.parametrize("route", ["GET /admin/orders", "GET /admin/delivery-boys", "POST /admin/orders/{id}/assign"])
def test_delivery_boys_are_not_admins(env, route):
    status, out = call(admin, route, RAMU, body={}, path_id="x")
    assert status == 403


# ---------------------------------------------------------------- on duty
def test_first_visit_registers_off_duty(env):
    users.update_profile(RAMU["sub"], {"name": "Ramu", "phone": "9123456780"}, email=RAMU["email"])
    status, me = call(delivery, "GET /delivery/me", RAMU)
    assert status == 200 and me == {
        "id": RAMU["sub"], "name": "Ramu", "phone": "9123456780", "on_duty": False,
        "active_orders": 0, "last_assigned_at": None,
    }


def test_on_duty_needs_a_phone(env):
    status, out = call(delivery, "PATCH /delivery/me", RAMU, {"on_duty": True})
    assert status == 400 and out["error"]["code"] == "PHONE_REQUIRED"
    assert call(delivery, "PATCH /delivery/me", RAMU, {"on_duty": False})[0] == 200  # off is always fine


@pytest.mark.parametrize("body", [{}, {"on_duty": "yes"}, {"on_duty": True, "x": 1}])
def test_on_duty_validation(env, body):
    assert call(delivery, "PATCH /delivery/me", RAMU, body)[0] == 400


def test_on_duty_lasts_one_ist_day(env):
    on_duty(RAMU)
    env["clock"]["now"] = datetime(2026, 11, 14, 0, 5, tzinfo=IST)  # just after midnight in India
    _, me = call(delivery, "GET /delivery/me", RAMU)
    assert me["on_duty"] is False


# ---------------------------------------------------------------- confirm + auto-assign
def test_confirm_assigns_the_only_delivery_boy(env):
    on_duty(RAMU)
    o = order()
    status, out = confirm(o["id"])
    assert status == 200 and out["status"] == "ASSIGNED" and out["auto_assign"] == "assigned"
    assert out["delivery_boy"] == {"id": RAMU["sub"], "name": "Ramu", "phone": "9123456780"}
    assert out["assigned_by"] == "auto"
    assert [(h["status"], h["by"]) for h in out["status_history"]] == [
        ("PENDING", "customer"), ("CONFIRMED", "chef@example.com"), ("ASSIGNED", "auto"),
    ]
    mine = customer_view(o)
    assert mine["status"] == "ASSIGNED" and mine["delivery_boy"] == {"name": "Ramu", "phone": "9123456780"}
    assert "delivery_boy_id" not in mine and "status_history" not in mine


def test_confirm_twice_does_not_reassign(env):
    on_duty(RAMU)
    o = order()
    _, first = confirm(o["id"])
    stamp = delivery_boys.get_boy(RAMU["sub"])["last_assigned_at"]
    on_duty(SHAM, name="Sham", phone="9123456781")  # a less busy boy appears
    env["clock"]["now"] = TEN_AM + timedelta(minutes=1)
    status, again = confirm(o["id"])
    assert status == 200 and again["auto_assign"] == "unchanged"
    assert again["delivery_boy"]["id"] == RAMU["sub"] and again["status_history"] == first["status_history"]
    assert delivery_boys.get_boy(RAMU["sub"])["last_assigned_at"] == stamp


def test_lost_race_with_another_admin_is_not_a_second_assignment(env, monkeypatch):
    on_duty(RAMU)
    o = order()
    stale = admin._find_order(o["id"])
    confirm(o["id"])
    monkeypatch.setattr(admin, "_find_order", lambda _id: stale)
    status, out = confirm(o["id"])
    assert status == 200 and out["auto_assign"] == "unchanged" and out["status"] == "ASSIGNED"
    assert len([h for h in out["status_history"] if h["status"] == "ASSIGNED"]) == 1


def test_auto_assign_balances_and_breaks_ties_by_wait(env):
    on_duty(RAMU)
    on_duty(SHAM, name="Sham", phone="9123456781")
    picks = []
    for n, who in enumerate((ALICE, BOB, ALICE)):
        env["clock"]["now"] = TEN_AM + timedelta(minutes=n)
        o = order(who, key=f"bal-key-{n:04d}")
        picks.append(confirm(o["id"])[1]["delivery_boy"]["id"])
    # first two go to different boys; the third to whoever waited longest (both have 1)
    assert set(picks[:2]) == {RAMU["sub"], SHAM["sub"]}
    assert picks[2] == picks[0]


def test_off_duty_boys_are_skipped(env):
    on_duty(RAMU)
    on_duty(SHAM, name="Sham", phone="9123456781")
    call(delivery, "PATCH /delivery/me", RAMU, {"on_duty": False})
    o = order()
    assert confirm(o["id"])[1]["delivery_boy"]["id"] == SHAM["sub"]


def test_nobody_on_duty_then_manual_assign(env):
    users.update_profile(RAMU["sub"], {"name": "Ramu", "phone": "9123456780"}, email=RAMU["email"])
    call(delivery, "GET /delivery/me", RAMU)  # registered but off duty
    o = order()
    status, out = confirm(o["id"])
    assert status == 200 and out["status"] == "CONFIRMED" and out["auto_assign"] == "none_available"
    assert "delivery_boy" not in out
    status, out = assign(o["id"], RAMU)  # the admin may pick someone off duty
    assert status == 200 and out["status"] == "ASSIGNED" and out["assigned_by"] == "chef@example.com"
    assert [h["status"] for h in out["status_history"]] == ["PENDING", "CONFIRMED", "ASSIGNED"]
    assert [x["id"] for x in my_orders()] == [o["id"]]


def test_boy_switching_off_mid_assign_falls_back(env, monkeypatch):
    on_duty(RAMU)
    gone = delivery_boys.get_boy(RAMU["sub"])
    call(delivery, "PATCH /delivery/me", RAMU, {"on_duty": False})
    monkeypatch.setattr(delivery_boys, "candidates", lambda: [gone])  # stale list
    o = order()
    status, out = confirm(o["id"])
    assert status == 200 and out["status"] == "CONFIRMED" and out["auto_assign"] == "none_available"


def test_upi_confirm_marks_paid_and_assigns(env, monkeypatch):
    monkeypatch.setenv("UPI_ID", "hotel@okicici")
    monkeypatch.setenv("UPI_PAYEE_NAME", "Wagheshwar Misal House")
    on_duty(RAMU)
    o = order(payment_method="online")
    assert o["status"] == "PENDING_PAYMENT"
    _, out = confirm(o["id"])
    assert out["status"] == "ASSIGNED" and out["payment_status"] == "paid"
    assert my_orders()[0]["collect_cash"] == 0  # already paid: nothing to collect


# ---------------------------------------------------------------- manual assign rules
def test_assign_rules(env):
    users.update_profile(RAMU["sub"], {"name": "Ramu", "phone": "9123456780"}, email=RAMU["email"])
    call(delivery, "GET /delivery/me", RAMU)
    o = order()
    status, out = assign(o["id"], RAMU)
    assert status == 409 and "Confirm it first" in out["error"]["message"]
    confirm(o["id"])
    status, out = call(admin, "POST /admin/orders/{id}/assign", CHEF, {"delivery_boy_id": "nobody"}, o["id"])
    assert status == 404 and "Deliveries tab" in out["error"]["message"]
    assert call(admin, "POST /admin/orders/{id}/assign", CHEF, {}, o["id"])[0] == 400
    assert call(admin, "POST /admin/orders/{id}/assign", CHEF, {"delivery_boy_id": RAMU["sub"], "x": 1}, o["id"])[0] == 400
    assert assign(o["id"], RAMU)[0] == 200
    status, out = assign(o["id"], RAMU)  # same person again
    assert status == 200 and out["auto_assign"] == "unchanged"
    assert [h["status"] for h in out["status_history"]].count("ASSIGNED") == 1


def test_reassign_moves_the_order(env):
    on_duty(RAMU)
    on_duty(SHAM, name="Sham", phone="9123456781")
    o = order()
    _, out = confirm(o["id"])
    first = out["delivery_boy"]["id"]
    other = SHAM if first == RAMU["sub"] else RAMU
    status, out = assign(o["id"], other)
    assert status == 200 and out["delivery_boy"]["id"] == other["sub"]
    first_boy = RAMU if first == RAMU["sub"] else SHAM
    assert my_orders(first_boy) == [] and [x["id"] for x in my_orders(other)] == [o["id"]]
    assert customer_view(o)["delivery_boy"]["name"] == ("Sham" if other is SHAM else "Ramu")


def test_cannot_assign_after_pickup(env):
    on_duty(RAMU)
    on_duty(SHAM, name="Sham", phone="9123456781")
    o = order()
    _, out = confirm(o["id"])
    boy = RAMU if out["delivery_boy"]["id"] == RAMU["sub"] else SHAM
    other = SHAM if boy is RAMU else RAMU
    assert step(o["id"], "OUT_FOR_DELIVERY", boy)[0] == 200
    status, out = assign(o["id"], other)
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"


# ---------------------------------------------------------------- the delivery boy's tab
def test_delivery_flow_end_to_end(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    [job] = my_orders()
    assert job["status"] == "ASSIGNED" and job["order_number"] == o["order_number"]
    assert job["customer"] == {"name": "Alice", "phone": "9876543210"}
    assert job["address"]["line1"] == "Plot 7, Ekta Nagar" and job["address"]["pincode"] == "431203"
    assert job["address"]["state"] == "Maharashtra" and job["address"]["city"] == "Jalna"
    assert job["address"]["latitude"] and job["address"]["longitude"]
    assert job["items"] == [
        {"product_name": "Misal Pav", "quantity": 2, "spice_level": "teekha", "note": "Less onion"},
        {"product_name": "Kadak Chaha", "quantity": 2},
    ]
    assert job["collect_cash"] == o["total"] and job["payment_method"] == "cod"
    assert call(delivery, "GET /delivery/me", RAMU)[1]["active_orders"] == 1

    status, out = step(o["id"], "DELIVERED")  # can't skip "Picked up"
    assert status == 409
    status, out = step(o["id"], "OUT_FOR_DELIVERY")
    assert status == 200 and out["status"] == "OUT_FOR_DELIVERY"
    assert step(o["id"], "OUT_FOR_DELIVERY")[0] == 200  # double tap is harmless
    assert customer_view(o)["status"] == "OUT_FOR_DELIVERY"

    status, out = step(o["id"], "DELIVERED")
    assert status == 200 and out["status"] == "DELIVERED" and out["delivered_at"]
    assert "customer" not in out and "address" not in out and out["items"] == []  # privacy once done
    mine = customer_view(o)
    assert mine["payment_status"] == "paid" and mine["delivered_at"]
    assert mine["delivery_boy"] == {"name": "Ramu"}  # no phone once delivered
    _, board = call(admin, "GET /admin/orders", CHEF)
    assert [h["status"] for h in board[0]["status_history"]] == [
        "PENDING", "CONFIRMED", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED",
    ]
    assert board[0]["status_history"][-1]["by"] == "ramu@example.com"
    assert call(delivery, "GET /delivery/me", RAMU)[1]["active_orders"] == 0
    [done] = my_orders()  # today's finished deliveries stay listed, without details
    assert done["status"] == "DELIVERED" and "customer" not in done


def test_boy_cannot_see_or_move_other_orders(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    users.update_profile(SHAM["sub"], {"name": "Sham", "phone": "9123456781"}, email=SHAM["email"])
    assert my_orders(SHAM) == []
    status, out = step(o["id"], "OUT_FOR_DELIVERY", SHAM)
    assert status == 404 and out["error"]["code"] == "NOT_FOUND"
    unassigned = order(BOB, key="dlv-key-0002")
    assert step(unassigned["id"], "OUT_FOR_DELIVERY")[0] == 404
    assert step("ord_0000000000000abcdef", "OUT_FOR_DELIVERY")[0] == 404


@pytest.mark.parametrize("body", [{}, {"status": "CANCELLED"}, {"status": "ASSIGNED"}, {"status": "DELIVERED", "x": 1}])
def test_boy_status_validation(env, body):
    assert call(delivery, "POST /delivery/orders/{id}/status", RAMU, body, "ord_0000000000000abcdef")[0] == 400


def test_kitchen_cancel_after_assignment(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    assert admin_move(o["id"], "CANCELLED", reason="Customer called to cancel")[0] == 200
    [job] = my_orders()
    assert job["status"] == "CANCELLED" and job["cancel_reason"] == "Customer called to cancel"
    assert "customer" not in job
    status, out = step(o["id"], "OUT_FOR_DELIVERY")
    assert status == 409 and "don't deliver" in out["error"]["message"]


def test_admin_fallback_steps(env):
    on_duty(OWNER, name="Owner", phone="9123456782")
    o = order()
    _, out = confirm(o["id"], OWNER)
    assert out["delivery_boy"]["id"] == OWNER["sub"]
    assert admin_move(o["id"], "OUT_FOR_DELIVERY")[1]["status"] == "OUT_FOR_DELIVERY"
    _, out = admin_move(o["id"], "DELIVERED")
    assert out["status"] == "DELIVERED" and out["payment_status"] == "paid"


def test_yesterdays_finished_orders_drop_off_the_list(env):
    on_duty(RAMU)
    o = order()
    confirm(o["id"])
    step(o["id"], "OUT_FOR_DELIVERY")
    step(o["id"], "DELIVERED")
    assert [x["delivery_date"] for x in my_orders()] == [TODAY]
    env["clock"]["now"] = TEN_AM + timedelta(days=1)
    on_duty(RAMU)
    assert my_orders() == []  # yesterday's delivered order isn't "today's finished"
    assert TOMORROW  # (imported for readability)


# ---------------------------------------------------------------- admin: delivery boy list
def test_admin_lists_delivery_boys_and_can_take_one_off_duty(env):
    on_duty(RAMU)
    users.update_profile(SHAM["sub"], {"name": "Sham", "phone": "9123456781"}, email=SHAM["email"])
    call(delivery, "GET /delivery/me", SHAM)
    o = order()
    confirm(o["id"])
    status, boys = call(admin, "GET /admin/delivery-boys", CHEF)
    assert status == 200
    assert [(b["name"], b["on_duty"], b["active_orders"]) for b in boys] == [("Ramu", True, 1), ("Sham", False, 0)]
    status, out = call(admin, "PATCH /admin/delivery-boys/{id}", CHEF, {"on_duty": False}, RAMU["sub"])
    assert status == 200 and out["on_duty"] is False and out["active_orders"] == 1
    assert call(admin, "PATCH /admin/delivery-boys/{id}", CHEF, {"on_duty": True}, RAMU["sub"])[0] == 400
    assert call(admin, "PATCH /admin/delivery-boys/{id}", CHEF, {"on_duty": False}, "nobody")[0] == 404
    assert my_orders()[0]["id"] == o["id"]  # off duty keeps the orders he already has
