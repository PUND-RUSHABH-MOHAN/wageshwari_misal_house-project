import json
from datetime import datetime

import pytest

import admin
import catalog
import orders
from test_orders import (  # noqa: F401 - clock and env are pytest fixtures used by name
    ALICE,
    BOB,
    EARLY,
    IST,
    MORNING,
    TOMORROW,
    clock,
    env,
    ev,
    invoke,
    make_address,
    place,
)

CHEF = {"sub": "cccccccc-0000-0000-0000-000000000003", "email": "chef@example.com", "cognito:groups": "[admin]"}


def adm(route, body=None, order_id=None, claims=CHEF, query=None, path_id=None):
    event = {"routeKey": route, "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
    if body is not None:
        event["body"] = json.dumps(body)
    if order_id is not None or path_id is not None:
        event["pathParameters"] = {"id": order_id if order_id is not None else path_id}
    if query is not None:
        event["queryStringParameters"] = query
    return invoke(admin, event)


def move(order_id, status, reason=None, claims=CHEF):
    body = {"status": status}
    if reason is not None:
        body["reason"] = reason
    return adm("POST /admin/orders/{id}/status", body, order_id=order_id, claims=claims)


def new_order(claims=ALICE, key="adm-key-0001", **over):
    adr = make_address(claims)
    status, o, _ = place(adr, claims, key=key, **over)
    assert status == 201, o
    return o


# ---------------------------------------------------------------- access
@pytest.mark.parametrize("route", list(admin.ROUTES))
def test_customers_are_forbidden(env, route):
    status, out, _ = adm(route, body={}, path_id="x", claims=ALICE)
    assert status == 403 and out["error"]["code"] == "FORBIDDEN"


def test_needs_login(env):
    status, _, _ = invoke(admin, {"routeKey": "GET /admin/orders", "requestContext": {}})
    assert status == 401


def test_group_claim_as_list_works(env):
    claims = {**CHEF, "cognito:groups": ["admin"]}
    assert adm("GET /admin/orders", claims=claims)[0] == 200


# ---------------------------------------------------------------- order board
def test_list_orders_for_a_day_by_slot(env):
    a = make_address(ALICE)
    b = make_address(BOB)
    _, morning, _ = place(a, ALICE, key="board-key-1", slot_label=MORNING)
    _, early, _ = place(b, BOB, key="board-key-2", slot_label=EARLY)
    _, tomorrow, _ = place(a, ALICE, key="board-key-3", delivery_date=TOMORROW)
    status, board, _ = adm("GET /admin/orders")  # default = today in IST
    assert status == 200
    assert [o["id"] for o in board] == [early["id"], morning["id"]]  # Early Bird slot first
    assert board[0]["address_snapshot"]["receiver_phone"] == "9876543210"
    assert board[0]["status_history"][0]["status"] == "CONFIRMED"
    _, next_day, _ = adm("GET /admin/orders", query={"date": TOMORROW})
    assert [o["id"] for o in next_day] == [tomorrow["id"]]


def test_default_day_follows_ist(env):
    new_order(delivery_date=TOMORROW)
    # 18:40 UTC on the 13th is already 00:10 on the 14th in India
    env["clock"]["now"] = datetime(2026, 11, 14, 0, 10, tzinfo=IST)
    _, board, _ = adm("GET /admin/orders")
    assert len(board) == 1


@pytest.mark.parametrize("day", ["13-11-2026", "2026-02-30"])
def test_list_bad_date(env, day):
    assert adm("GET /admin/orders", query={"date": day})[0] == 400


# ---------------------------------------------------------------- status moves
def test_full_happy_path_and_customer_sees_it(env):
    o = new_order()
    for step in ("PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"):
        status, out, _ = move(o["id"], step)
        assert status == 200 and out["status"] == step, out
    assert out["payment_status"] == "paid"  # cash collected on delivery
    assert [h["status"] for h in out["status_history"]] == ["CONFIRMED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"]
    assert out["status_history"][-1]["by"] == "chef@example.com"
    # The customer's own view shows the new status, without the history
    _, mine, _ = invoke(orders, ev("GET /orders/{id}", order_id=o["id"]))
    assert mine["status"] == "DELIVERED" and "status_history" not in mine


@pytest.mark.parametrize("jump", ["OUT_FOR_DELIVERY", "DELIVERED", "PREPARING_X", "CONFIRMED"])
def test_cannot_skip_or_invent_steps(env, jump):
    o = new_order()
    status, out, _ = move(o["id"], jump)
    assert status in (400, 409)
    if status == 409:
        assert out["error"]["code"] == "INVALID_STATUS_CHANGE"


def test_cannot_move_twice_to_same_step(env):
    o = new_order()
    assert move(o["id"], "PREPARING")[0] == 200
    status, out, _ = move(o["id"], "PREPARING")
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"


def test_concurrent_change_is_refused(env, monkeypatch):
    """Two admins tap at the same time: both read CONFIRMED, only the first write wins."""
    o = new_order()
    stale = admin._find_order(o["id"])
    assert move(o["id"], "PREPARING")[0] == 200
    monkeypatch.setattr(admin, "_find_order", lambda _id: stale)
    status, out, _ = move(o["id"], "PREPARING")
    assert status == 409 and out["error"]["code"] == "ORDER_CHANGED"


def test_kitchen_cancel_needs_reason_and_customer_sees_it(env):
    o = new_order()
    move(o["id"], "PREPARING")
    status, out, _ = move(o["id"], "CANCELLED")
    assert status == 400 and "reason" in out["error"]["message"]
    status, out, _ = move(o["id"], "CANCELLED", reason="  Out of   misal today ")
    assert status == 200 and out["status"] == "CANCELLED"
    _, mine, _ = invoke(orders, ev("GET /orders/{id}", order_id=o["id"]))
    assert mine["cancel_reason"] == "Out of misal today" and mine["cancelled_by"] == "kitchen"


def test_cannot_cancel_delivered(env):
    o = new_order()
    for step in ("PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"):
        move(o["id"], step)
    status, out, _ = move(o["id"], "CANCELLED", reason="Changed mind")
    assert status == 409 and out["error"]["code"] == "INVALID_STATUS_CHANGE"


def test_customer_cancel_is_recorded(env):
    o = new_order()
    status, c, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 200 and c["cancelled_by"] == "customer" and "cancel_reason" not in c
    _, board, _ = adm("GET /admin/orders")
    assert [h["status"] for h in board[0]["status_history"]] == ["CONFIRMED", "CANCELLED"]


@pytest.mark.parametrize("order_id", ["ord_0000000000000abcdef", "nope"])
def test_unknown_order(env, order_id):
    assert move(order_id, "PREPARING")[0] == 404


def test_order_pointer_written(env):
    o = new_order()
    ref = env["table"].get_item(Key={"PK": f"ORDERREF#{o['id']}", "SK": "ORDER"})["Item"]
    assert ref["user_id"] == ALICE["sub"]


def test_unknown_field(env):
    o = new_order()
    assert move(o["id"], "PREPARING")[0] == 200
    status, _, _ = adm("POST /admin/orders/{id}/status", {"status": "OUT_FOR_DELIVERY", "x": 1}, order_id=o["id"])
    assert status == 400


# ---------------------------------------------------------------- menu: categories
def test_category_create_list_update(env):
    status, c, _ = adm("POST /admin/categories", {"name": "Bhaji Pav", "name_mr": "भाजी पाव"})
    assert status == 201 and c["id"] == "cat_bhaji_pav" and c["is_active"] is True
    # same name again gets a unique id
    status, c2, _ = adm("POST /admin/categories", {"name": "Bhaji Pav"})
    assert status == 201 and c2["id"].startswith("cat_bhaji_pav_") and c2["id"] != c["id"]
    status, c3, _ = adm("PATCH /admin/categories/{id}", {"is_active": False, "sort_order": 9}, path_id=c["id"])
    assert status == 200 and c3["is_active"] is False and c3["sort_order"] == 9
    _, all_cats, _ = adm("GET /admin/categories")
    assert c["id"] in {x["id"] for x in all_cats}  # hidden ones are listed for admins


@pytest.mark.parametrize("body", [{}, {"name": ""}, {"name": "x" * 41}, {"name": "A", "sort_order": -1},
                                  {"name": "A", "is_active": "yes"}, {"name": "A", "image_url": "http://x"},
                                  {"name": "A", "color": "red"}])
def test_category_validation(env, body):
    assert adm("POST /admin/categories", body)[0] == 400


def test_category_update_missing(env):
    assert adm("PATCH /admin/categories/{id}", {"name": "X"}, path_id="cat_nope")[0] == 404


# ---------------------------------------------------------------- menu: products
def test_product_create_defaults_and_public_menu(env):
    _, cat, _ = adm("POST /admin/categories", {"name": "Snacks", "image_url": "https://cdn.test/snacks.jpg"})
    status, p, _ = adm("POST /admin/products", {"category_id": cat["id"], "name": "Kanda Bhaji", "price": 4000})
    assert status == 201
    assert p["id"] == "prd_kanda_bhaji" and p["image_url"] == "https://cdn.test/snacks.jpg"
    assert p["is_available"] is True and p["is_active"] is True and p["has_spice_level"] is False
    catalog.reset_clients()
    _, public, _ = invoke(catalog, {"routeKey": "GET /products", "requestContext": {}})
    assert "prd_kanda_bhaji" in {x["id"] for x in public}
    assert all("is_active" not in x for x in public)


def test_price_change_applies_to_new_orders_only(env):
    o = new_order(key="price-key-1")
    status, p, _ = adm("PATCH /admin/products/{id}", {"price": 9900}, path_id="prd_misal_pav")
    assert status == 200 and p["price"] == 9900
    _, old, _ = invoke(orders, ev("GET /orders/{id}", order_id=o["id"]))
    assert old["items"][0]["unit_price"] == 9000
    adr = old["address_snapshot"]["id"]
    _, new, _ = place(adr, key="price-key-2")
    assert new["items"][0]["unit_price"] == 9900


def test_sold_out_and_hidden_dishes_cannot_be_ordered(env):
    adm("PATCH /admin/products/{id}", {"is_available": False}, path_id="prd_misal_pav")
    adr = make_address()
    status, out, _ = place(adr, key="so-key-1")
    assert status == 409 and "sold out" in out["error"]["message"]
    adm("PATCH /admin/products/{id}", {"is_available": True, "is_active": False}, path_id="prd_misal_pav")
    status, out, _ = place(adr, key="so-key-2")
    assert status == 409 and "no longer on the menu" in out["error"]["message"]
    catalog.reset_clients()
    _, public, _ = invoke(catalog, {"routeKey": "GET /products", "requestContext": {}})
    assert "prd_misal_pav" not in {x["id"] for x in public}
    _, all_products, _ = adm("GET /admin/products")
    hidden = next(x for x in all_products if x["id"] == "prd_misal_pav")
    assert hidden["is_active"] is False


@pytest.mark.parametrize("body", [
    {"name": "X", "price": 4000},                                  # no category
    {"category_id": "cat_nope", "name": "X", "price": 4000},       # unknown category -> 404
    {"category_id": "cat_misal", "name": "X", "price": 50},        # below ₹1
    {"category_id": "cat_misal", "name": "X", "price": 600000},    # above ₹5,000
    {"category_id": "cat_misal", "name": "X", "price": 40.5},
    {"category_id": "cat_misal", "name": "", "price": 4000},
    {"category_id": "cat_misal", "name": "X", "price": 4000, "description": "d" * 301},
])
def test_product_validation(env, body):
    if body.get("category_id") == "cat_misal":
        adm("POST /admin/categories", {"name": "Misal"})  # creates cat_misal
    status, _, _ = adm("POST /admin/products", body)
    assert status in (400, 404)


def test_product_update_rules(env):
    assert adm("PATCH /admin/products/{id}", {}, path_id="prd_misal_pav")[0] == 400
    assert adm("PATCH /admin/products/{id}", {"name": ""}, path_id="prd_misal_pav")[0] == 400
    assert adm("PATCH /admin/products/{id}", {"category_id": "cat_nope"}, path_id="prd_misal_pav")[0] == 404
    assert adm("PATCH /admin/products/{id}", {"price": 100}, path_id="prd_unknown")[0] == 404
    assert adm("PATCH /admin/products/{id}", {"price": 100}, path_id="../etc")[0] == 404


def test_new_dish_can_be_ordered(env):
    adm("POST /admin/categories", {"name": "Misal"})
    _, p, _ = adm("POST /admin/products", {
        "category_id": "cat_misal", "name": "Puneri Misal", "price": 10000, "has_spice_level": True,
    })
    adr = make_address()
    status, o, _ = place(adr, key="new-dish-1", items=[{"product_id": p["id"], "quantity": 1, "spice_level": "mild"}])
    assert status == 201 and o["items"][0]["product_name"] == "Puneri Misal"

