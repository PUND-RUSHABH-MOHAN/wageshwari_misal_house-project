import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
import pytest

import addresses
import orders
from conftest import REGION, TABLE

HOTEL = (19.856833, 75.851944)
NEAR = (19.8700, 75.8600)  # ~1.7 km
IST = timezone(timedelta(hours=5, minutes=30))

ALICE = {"sub": "aaaaaaaa-0000-0000-0000-000000000001", "email": "alice@example.com"}
BOB = {"sub": "bbbbbbbb-0000-0000-0000-000000000002", "email": "bob@example.com"}

# 06:00 IST on 13 Nov 2026: every slot today is still open (Early Bird closes 06:30).
SIX_AM = datetime(2026, 11, 13, 6, 0, tzinfo=IST)
TODAY, TOMORROW = "2026-11-13", "2026-11-14"
MORNING = "Morning 8:00 - 9:00 AM"
EARLY = "Early Bird 7:00 - 8:00 AM"


@pytest.fixture
def clock(monkeypatch):
    state = {"now": SIX_AM}
    monkeypatch.setattr(orders, "_now_utc", lambda: state["now"].astimezone(timezone.utc))
    return state


@pytest.fixture
def env(aws, monkeypatch, clock):
    monkeypatch.setenv("SHOP_LATITUDE", str(HOTEL[0]))
    monkeypatch.setenv("SHOP_LONGITUDE", str(HOTEL[1]))
    monkeypatch.setenv("DELIVERY_RADIUS_KM", "3")
    monkeypatch.setenv("SHOP_CITY", "Jalna")
    monkeypatch.setenv("MIN_ORDER_PAISE", "10000")
    orders.users.reset_clients()
    t = boto3.resource("dynamodb", region_name=REGION).Table(TABLE)

    def prd(pid, name, price, available=True, spice=True):
        t.put_item(Item={
            "PK": "CATALOG", "SK": f"PRODUCT#{pid}", "entity": "PRODUCT", "id": pid,
            "category_id": "cat_misal", "name": name, "price": Decimal(price),
            "has_spice_level": spice, "is_available": available,
        })

    prd("prd_misal_pav", "Misal Pav", 9000)
    prd("prd_kolhapuri_misal", "Kolhapuri Misal", 11000, available=False)
    prd("prd_chaha", "Kadak Chaha", 1500, spice=False)
    prd("prd_vada_pav", "Vada Pav", 2500, spice=False)
    yield {"table": t, "clock": clock}
    orders.users.reset_clients()


def ev(route, claims=ALICE, body=None, order_id=None, key="checkout-0001"):
    event = {"routeKey": route, "headers": {}, "requestContext": {"authorizer": {"jwt": {"claims": claims}}}}
    if key is not None:
        event["headers"]["idempotency-key"] = key
    if body is not None:
        event["body"] = json.dumps(body)
    if order_id is not None:
        event["pathParameters"] = {"id": order_id}
    return event


def invoke(module, event):
    resp = module.handler(event, None)
    return resp["statusCode"], (json.loads(resp["body"]) if resp.get("body") else None), resp


def make_address(claims=ALICE, lat=NEAR[0], lon=NEAR[1]):
    status, out, _ = invoke(addresses, {
        "routeKey": "POST /addresses",
        "requestContext": {"authorizer": {"jwt": {"claims": claims}}},
        "body": json.dumps({
            "label": "Home", "receiver_name": "Alice", "receiver_phone": "9876543210",
            "line1": "Plot 7, Ekta Nagar", "pincode": "431203", "latitude": lat, "longitude": lon,
        }),
    })
    assert status == 201, out
    return out["id"]


def order_body(address_id, **over):
    b = {
        "address_id": address_id,
        "delivery_date": TODAY,
        "slot_label": MORNING,
        "payment_method": "cod",
        "items": [
            {"product_id": "prd_misal_pav", "quantity": 2, "spice_level": "teekha", "note": "  Less   onion "},
            {"product_id": "prd_chaha", "quantity": 2},
        ],
    }
    b.update(over)
    return b


def place(address_id, claims=ALICE, key="checkout-0001", **over):
    return invoke(orders, ev("POST /orders", claims, order_body(address_id, **over), key=key))


def error_code(out):
    return out["error"]["code"]


# ---------------------------------------------------------------- bill maths
def test_compute_bill_matches_app():
    assert orders.compute_bill(0) == {"subtotal": 0, "delivery_fee": 0, "tax": 0, "total": 0}
    assert orders.compute_bill(21000) == {"subtotal": 21000, "delivery_fee": 3000, "tax": 1050, "total": 25050}
    # 5% of 10010 = 500.5 -> rounds half up to 501, like Math.round in the app
    assert orders.compute_bill(10010)["tax"] == 501
    assert orders.compute_bill(10009)["tax"] == 500


def test_rupees():
    assert orders.rupees(10000) == "₹100"
    assert orders.rupees(2550) == "₹25.50"


# ---------------------------------------------------------------- place
def test_place_order_happy_path(env):
    adr = make_address()
    status, o, _ = place(adr)
    assert status == 201, o
    assert o["order_number"] == "WMH-20261113-0001"
    assert o["status"] == "CONFIRMED" and o["payment_status"] == "pending" and o["payment_method"] == "cod"
    assert o["user_id"] == ALICE["sub"]
    assert (o["subtotal"], o["delivery_fee"], o["tax"], o["total"]) == (21000, 3000, 1050, 25050)
    assert o["delivery_date"] == TODAY and o["slot_label"] == MORNING
    assert o["created_at"] == "2026-11-13T00:30:00.000Z"
    first, second = o["items"]
    assert first == {
        "id": "oit_1", "order_id": o["id"], "product_id": "prd_misal_pav", "product_name": "Misal Pav",
        "unit_price": 9000, "quantity": 2, "spice_level": "teekha", "note": "Less onion", "line_total": 18000,
    }
    assert "spice_level" not in second and "note" not in second
    snap = o["address_snapshot"]
    assert snap["id"] == adr and snap["city"] == "Jalna" and snap["is_default"] is True
    assert isinstance(snap["latitude"], float) and 1.5 < snap["distance_km"] < 2.0
    # Internal keys never leak
    assert not {"PK", "SK", "GSI1PK", "GSI1SK", "entity", "slot_id"} & set(o)


def test_stored_item_has_admin_index_fields(env):
    adr = make_address()
    _, o, _ = place(adr)
    item = env["table"].get_item(Key={"PK": f"USER#{ALICE['sub']}", "SK": f"ORDER#{o['id']}"})["Item"]
    assert item["GSI1PK"] == f"ORDERDATE#{TODAY}"
    assert item["GSI1SK"].startswith("08#2026-11-13T00:30:00.000Z#")
    assert item["slot_id"] == "slot_morning"


def test_server_ignores_client_prices_and_uses_menu(env):
    adr = make_address()
    env["table"].update_item(
        Key={"PK": "CATALOG", "SK": "PRODUCT#prd_misal_pav"},
        UpdateExpression="SET price = :p", ExpressionAttributeValues={":p": Decimal(9500)},
    )
    _, o, _ = place(adr)
    assert o["items"][0]["unit_price"] == 9500 and o["subtotal"] == 22000


def test_snapshot_survives_menu_and_address_edits(env):
    adr = make_address()
    _, o, _ = place(adr)
    env["table"].update_item(
        Key={"PK": "CATALOG", "SK": "PRODUCT#prd_misal_pav"},
        UpdateExpression="SET price = :p, #n = :n",
        ExpressionAttributeNames={"#n": "name"},
        ExpressionAttributeValues={":p": Decimal(12000), ":n": "Misal Pav (new)"},
    )
    env["table"].update_item(
        Key={"PK": f"USER#{ALICE['sub']}", "SK": f"ADDRESS#{adr}"},
        UpdateExpression="SET line1 = :l", ExpressionAttributeValues={":l": "Somewhere else 99"},
    )
    _, again, _ = invoke(orders, ev("GET /orders/{id}", order_id=o["id"]))
    assert again["items"][0]["product_name"] == "Misal Pav" and again["items"][0]["unit_price"] == 9000
    assert again["address_snapshot"]["line1"] == "Plot 7, Ekta Nagar"


def test_order_numbers_count_per_ist_day(env):
    adr = make_address()
    assert place(adr, key="key-aaaa-1")[1]["order_number"] == "WMH-20261113-0001"
    assert place(adr, key="key-aaaa-2")[1]["order_number"] == "WMH-20261113-0002"
    # 00:10 IST on the 14th is still 18:40 on the 13th in UTC; numbering follows India's date.
    env["clock"]["now"] = datetime(2026, 11, 14, 0, 10, tzinfo=IST)
    status, o, _ = place(adr, key="key-aaaa-3", delivery_date="2026-11-14")
    assert status == 201, o
    assert o["order_number"] == "WMH-20261114-0001"


# ---------------------------------------------------------------- idempotency
def test_same_key_same_body_returns_first_order(env):
    adr = make_address()
    s1, first, _ = place(adr, key="retry-key-1")
    s2, second, resp = place(adr, key="retry-key-1")
    assert s1 == s2 == 201
    assert second["id"] == first["id"] and second["order_number"] == first["order_number"]
    assert resp["headers"].get("Idempotent-Replayed") == "true"
    _, listed, _ = invoke(orders, ev("GET /orders"))
    assert len(listed) == 1


def test_replay_works_even_after_slot_closes(env):
    adr = make_address()
    _, first, _ = place(adr, key="retry-key-2", slot_label=EARLY)
    env["clock"]["now"] = SIX_AM + timedelta(hours=1)  # Early Bird is now closed
    status, again, _ = place(adr, key="retry-key-2", slot_label=EARLY)
    assert status == 201 and again["id"] == first["id"]


def test_same_key_different_body_is_conflict(env):
    adr = make_address()
    place(adr, key="retry-key-3")
    status, out, _ = place(adr, key="retry-key-3", slot_label=EARLY)
    assert status == 409 and error_code(out) == "IDEMPOTENCY_CONFLICT"


def test_key_is_per_user(env):
    a = make_address(ALICE)
    b = make_address(BOB)
    s1, o1, _ = place(a, ALICE, key="shared-key-1")
    s2, o2, _ = place(b, BOB, key="shared-key-1")
    assert s1 == s2 == 201 and o1["id"] != o2["id"]


def test_expired_key_can_be_reused(env):
    adr = make_address()
    _, first, _ = place(adr, key="retry-key-4", delivery_date=TOMORROW)
    env["clock"]["now"] = SIX_AM + timedelta(hours=25)  # 07:00 on the 14th; record expired
    status, second, _ = place(adr, key="retry-key-4", delivery_date="2026-11-15", slot_label=MORNING)
    assert status == 201 and second["id"] != first["id"]


def test_lost_race_returns_winner(env, monkeypatch):
    """Two copies of one checkout pass the first check together; the loser answers with the winner."""
    adr = make_address()
    _, winner, _ = place(adr, key="race-key-1")
    real = orders._live_idempotency_record
    calls = {"n": 0}

    def first_miss(*args):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(*args)

    monkeypatch.setattr(orders, "_live_idempotency_record", first_miss)
    status, out, _ = place(adr, key="race-key-1")
    assert status == 201 and out["id"] == winner["id"]


@pytest.mark.parametrize("key", [None, "short", "has space in it", "x" * 65])
def test_idempotency_key_required(env, key):
    adr = make_address()
    status, out, _ = invoke(orders, ev("POST /orders", body=order_body(adr), key=key))
    assert status == 400 and error_code(out) == "VALIDATION_ERROR"


def test_header_name_is_case_insensitive(env):
    adr = make_address()
    event = ev("POST /orders", body=order_body(adr), key=None)
    event["headers"]["Idempotency-Key"] = "Mixed-Case-Key"
    assert invoke(orders, event)[0] == 201


# ---------------------------------------------------------------- rules
def test_minimum_order_100_rupees(env):
    adr = make_address()
    status, out, _ = place(adr, items=[{"product_id": "prd_vada_pav", "quantity": 3}])  # ₹75
    assert status == 422 and error_code(out) == "BELOW_MINIMUM_ORDER"
    assert "₹100" in out["error"]["message"] and "₹25" in out["error"]["message"]
    # Exactly ₹100 of food is fine (delivery and GST don't count toward it)
    status, o, _ = place(adr, key="key-min-2", items=[{"product_id": "prd_vada_pav", "quantity": 4}])
    assert status == 201 and o["subtotal"] == 10000


def test_online_payment_refused_for_now(env):
    adr = make_address()
    status, out, _ = place(adr, payment_method="online")
    assert status == 400 and error_code(out) == "PAYMENT_METHOD_UNAVAILABLE"


def test_sold_out_dish(env):
    adr = make_address()
    status, out, _ = place(adr, items=[{"product_id": "prd_kolhapuri_misal", "quantity": 1}])
    assert status == 409 and error_code(out) == "PRODUCT_UNAVAILABLE"
    assert "Kolhapuri Misal" in out["error"]["message"]


def test_unknown_dish(env):
    adr = make_address()
    status, out, _ = place(adr, items=[{"product_id": "prd_pizza", "quantity": 5}])
    assert status == 409 and error_code(out) == "PRODUCT_UNAVAILABLE"


def test_spice_only_on_spicy_dishes(env):
    adr = make_address()
    status, out, _ = place(adr, items=[
        {"product_id": "prd_misal_pav", "quantity": 2},
        {"product_id": "prd_chaha", "quantity": 1, "spice_level": "teekha"},
    ])
    assert status == 400 and "spice" in out["error"]["message"]


@pytest.mark.parametrize("items", [
    [],
    "misal",
    [{"product_id": "prd_misal_pav", "quantity": 0}],
    [{"product_id": "prd_misal_pav", "quantity": 21}],
    [{"product_id": "prd_misal_pav", "quantity": 1.5}],
    [{"product_id": "prd_misal_pav", "quantity": True}],
    [{"product_id": "prd_misal_pav", "quantity": 2, "spice_level": "extra"}],
    [{"product_id": "prd_misal_pav", "quantity": 2, "note": "x" * 121}],
    [{"product_id": "prd_misal_pav", "quantity": 2, "price": 1}],
    [{"quantity": 2}],
    [{"product_id": "prd_misal_pav", "quantity": 1}] * 21,
])
def test_bad_items(env, items):
    adr = make_address()
    status, out, _ = place(adr, items=items)
    assert status == 400 and error_code(out) == "VALIDATION_ERROR", out


@pytest.mark.parametrize("over", [
    {"delivery_date": "13-11-2026"},
    {"delivery_date": "2026-02-30"},
    {"slot_label": "Dinner 8:00 - 9:00 PM"},
    {"slot_label": ["Morning"]},
    {"payment_method": "card"},
    {"address_id": ""},
    {"total": 1},
])
def test_bad_request_fields(env, over):
    adr = make_address()
    status, out, _ = invoke(orders, ev("POST /orders", body={**order_body(adr), **over}))
    assert status == 400 and error_code(out) == "VALIDATION_ERROR", out


def test_slot_cutoff_30_minutes(env):
    adr = make_address()
    env["clock"]["now"] = datetime(2026, 11, 13, 7, 29, tzinfo=IST)
    assert place(adr, key="slot-key-1")[0] == 201  # Morning (8:00) closes at 7:30
    env["clock"]["now"] = datetime(2026, 11, 13, 7, 30, tzinfo=IST)
    status, out, _ = place(adr, key="slot-key-2")
    assert status == 409 and error_code(out) == "SLOT_UNAVAILABLE"
    # The same slot tomorrow is fine
    assert place(adr, key="slot-key-3", delivery_date=TOMORROW)[0] == 201


@pytest.mark.parametrize("day", ["2026-11-12", "2026-11-15"])
def test_only_today_or_tomorrow(env, day):
    adr = make_address()
    status, out, _ = place(adr, delivery_date=day)
    assert status == 409 and error_code(out) == "SLOT_UNAVAILABLE"


def test_address_must_be_mine(env):
    bobs = make_address(BOB)
    make_address(ALICE)
    status, out, _ = place(bobs, ALICE)
    assert status == 404 and error_code(out) == "NOT_FOUND"
    assert place("adr_nothex", ALICE, key="adr-key-2")[0] == 404


def test_address_out_of_area_now(env, monkeypatch):
    adr = make_address()
    monkeypatch.setenv("DELIVERY_RADIUS_KM", "1")  # the area shrank after the address was saved
    status, out, _ = place(adr)
    assert status == 422 and error_code(out) == "OUT_OF_DELIVERY_AREA"


def test_needs_login(env):
    event = {"routeKey": "GET /orders", "requestContext": {}}
    assert invoke(orders, event)[0] == 401


# ---------------------------------------------------------------- list / get
def test_list_newest_first_and_only_mine(env):
    a = make_address(ALICE)
    b = make_address(BOB)
    _, o1, _ = place(a, key="list-key-1")
    env["clock"]["now"] = SIX_AM + timedelta(minutes=5)
    _, o2, _ = place(a, key="list-key-2")
    place(b, BOB, key="list-key-3")
    status, listed, _ = invoke(orders, ev("GET /orders"))
    assert status == 200
    assert [o["id"] for o in listed] == [o2["id"], o1["id"]]


def test_list_empty(env):
    assert invoke(orders, ev("GET /orders"))[:2] == (200, [])


def test_get_order(env):
    adr = make_address()
    _, o, _ = place(adr)
    status, got, _ = invoke(orders, ev("GET /orders/{id}", order_id=o["id"]))
    assert status == 200 and got == o


@pytest.mark.parametrize("order_id", ["ord_nope", "ord_0000000000000abcdef", ""])
def test_get_missing_order(env, order_id):
    status, out, _ = invoke(orders, ev("GET /orders/{id}", order_id=order_id))
    assert status == 404 and error_code(out) == "NOT_FOUND"


def test_cannot_see_someone_elses_order(env):
    adr = make_address(ALICE)
    _, o, _ = place(adr)
    assert invoke(orders, ev("GET /orders/{id}", BOB, order_id=o["id"]))[0] == 404
    assert invoke(orders, ev("POST /orders/{id}/cancel", BOB, order_id=o["id"]))[0] == 404


# ---------------------------------------------------------------- cancel
def test_cancel_confirmed_order(env):
    adr = make_address()
    _, o, _ = place(adr)
    status, c, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 200 and c["status"] == "CANCELLED" and c["id"] == o["id"]
    # Twice is harmless
    status, again, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 200 and again["status"] == "CANCELLED"


@pytest.mark.parametrize("status_now", ["PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"])
def test_cannot_cancel_once_kitchen_started(env, status_now):
    adr = make_address()
    _, o, _ = place(adr)
    env["table"].update_item(
        Key={"PK": f"USER#{ALICE['sub']}", "SK": f"ORDER#{o['id']}"},
        UpdateExpression="SET #s = :s", ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status_now},
    )
    status, out, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 409 and error_code(out) == "ORDER_NOT_CANCELLABLE"


def test_unknown_route(env):
    assert invoke(orders, ev("DELETE /orders/{id}", order_id="x"))[0] == 404
