import json
import math
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import boto3
import pytest
from boto3.dynamodb.conditions import Key

import addresses
import eta
import orders
from conftest import REGION, TABLE

HOTEL = (19.856833, 75.851944)
NEAR = (19.8700, 75.8600)  # ~1.7 km
IST = timezone(timedelta(hours=5, minutes=30))

ALICE = {"sub": "aaaaaaaa-0000-0000-0000-000000000001", "email": "alice@example.com"}
BOB = {"sub": "bbbbbbbb-0000-0000-0000-000000000002", "email": "bob@example.com"}

# 10:00 IST on 13 Nov 2026: inside ordering hours (9:00 AM - 8:30 PM).
TEN_AM = datetime(2026, 11, 13, 10, 0, tzinfo=IST)
TODAY, TOMORROW = "2026-11-13", "2026-11-14"
EARLY = "Morning 9:00 - 10:00 AM"  # first slot of the day
MORNING = "Morning 10:00 - 11:00 AM"


@pytest.fixture
def clock(monkeypatch):
    state = {"now": TEN_AM}
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
    assert o["status"] == "PENDING" and o["payment_status"] == "pending" and o["payment_method"] == "cod"
    assert o["user_id"] == ALICE["sub"]
    assert (o["subtotal"], o["delivery_fee"], o["tax"], o["total"]) == (21000, 3000, 1050, 25050)
    # Part 7d: always today; the slot sent by an old app build is ignored; the server sets the time.
    assert o["delivery_date"] == TODAY and "slot_label" not in o
    assert o["created_at"] == "2026-11-13T04:30:00.000Z"  # 10:00 IST
    # 1.7 km: travel 5 + 4/km = 12 min; cooking 20 min -> 10:32, rounded up to 10:35 IST
    assert (o["prep_minutes"], o["travel_minutes"]) == (20, 12)
    assert o["estimated_delivery_at"] == o["original_estimated_delivery_at"] == "2026-11-13T05:05:00.000Z"
    assert "delayed" not in o
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
    assert item["GSI1SK"].startswith("10#2026-11-13T04:30:00.000Z#")  # hour placed (IST)
    assert item["placed_at"] == "2026-11-13T04:30:00.000Z"
    assert "slot_id" not in item and "slot_label" not in item


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
    # 09:10 IST on the 14th is still 03:40 UTC; numbering follows India's date.
    env["clock"]["now"] = datetime(2026, 11, 14, 9, 10, tzinfo=IST)
    status, o, _ = place(adr, key="key-aaaa-3")
    assert status == 201, o
    assert o["order_number"] == "WMH-20261114-0001" and o["delivery_date"] == "2026-11-14"


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
    env["clock"]["now"] = TEN_AM + timedelta(hours=3)  # 09:00: the 9 AM slot is now closed
    status, again, _ = place(adr, key="retry-key-2", slot_label=EARLY)
    assert status == 201 and again["id"] == first["id"]


def test_same_key_different_body_is_conflict(env):
    adr = make_address()
    place(adr, key="retry-key-3")
    status, out, _ = place(adr, key="retry-key-3", payment_method="online", items=[{"product_id": "prd_vada_pav", "quantity": 5}])
    assert status in (400, 409)  # different dishes (or UPI off) with the same key
    status, out, _ = place(adr, key="retry-key-3", items=[{"product_id": "prd_vada_pav", "quantity": 5}])
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
    env["clock"]["now"] = TEN_AM + timedelta(hours=25)  # 07:00 on the 14th; record expired
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


def test_online_payment_refused_when_upi_not_set_up(env):
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
    {"payment_method": "card"},
    {"address_id": ""},
    {"total": 1},
])
def test_bad_request_fields(env, over):
    adr = make_address()
    status, out, _ = invoke(orders, ev("POST /orders", body={**order_body(adr), **over}))
    assert status == 400 and error_code(out) == "VALIDATION_ERROR", out


@pytest.mark.parametrize("sent", [
    {"delivery_date": "2026-11-15", "slot_label": "Evening 8:00 - 9:00 PM"},
    {"delivery_date": "13-11-2026", "slot_label": ["x"]},
    {"delivery_date": None, "slot_label": None},
])
def test_client_dates_and_slots_are_ignored(env, sent):
    """Part 7d: an order is always for today, now, whatever the app sends."""
    adr = make_address()
    status, o, _ = place(adr, **sent)
    assert status == 201, o
    assert o["delivery_date"] == TODAY and "slot_label" not in o
    assert o["estimated_delivery_at"] == "2026-11-13T05:05:00.000Z"


@pytest.mark.parametrize("hh, mm, ok", [(8, 59, False), (9, 0, True), (20, 30, True), (20, 31, False), (23, 0, False)])
def test_ordering_hours(env, hh, mm, ok):
    adr = make_address()
    env["clock"]["now"] = datetime(2026, 11, 13, hh, mm, tzinfo=IST)
    status, out, _ = place(adr, key=f"hours-{hh:02d}{mm:02d}")
    if ok:
        assert status == 201, out
    else:
        assert status == 409 and error_code(out) == "KITCHEN_CLOSED"


def test_estimate_grows_with_the_kitchen_queue(env):
    adr = make_address()
    stamps = []
    for n in range(4):
        _, o, _ = place(adr, key=f"queue-key-{n}")
        stamps.append((o["prep_minutes"], o["estimated_delivery_at"]))
    assert [p for p, _ in stamps] == [20, 22, 24, 26]  # +2 min per order already waiting
    assert stamps[3][1] == "2026-11-13T05:10:00.000Z"  # 10:00 + 26 + 12 = 10:38 -> 10:40


def test_queue_extra_is_capped_and_ignores_unpaid_and_finished(env):
    adr = make_address()
    for n in range(20):
        place(adr, key=f"cap-key-{n:02d}")
    _, o, _ = place(adr, key="cap-key-last")
    assert o["prep_minutes"] == 20 + 30  # at most +30
    # cancelled orders don't count
    t = env["table"]
    for item in t.query(IndexName="GSI1", KeyConditionExpression=Key("GSI1PK").eq(f"ORDERDATE#{TODAY}"))["Items"]:
        t.update_item(Key={"PK": item["PK"], "SK": item["SK"]}, UpdateExpression="SET #s = :c",
                      ExpressionAttributeNames={"#s": "status"}, ExpressionAttributeValues={":c": "CANCELLED"})
    assert place(adr, key="cap-key-after")[1]["prep_minutes"] == 20


def test_travel_time_follows_distance(env):
    next_door = make_address(lat=19.8570, lon=75.8521)  # a few metres from the hotel
    _, o, _ = place(next_door, key="near-key-1")
    assert o["travel_minutes"] == math.ceil(5 + 4 * o["address_snapshot"]["distance_km"]) == 6
    assert eta.travel_minutes(3.0) == 17 and eta.travel_minutes(None) == 13


def test_round_up_to_five_minutes():
    at = datetime(2026, 11, 13, 13, 31, 10, tzinfo=IST)
    assert eta.round_up(at).astimezone(IST).strftime("%H:%M") == "13:35"
    assert eta.round_up(datetime(2026, 11, 13, 13, 35, tzinfo=IST)).astimezone(IST).strftime("%H:%M") == "13:35"


def test_estimate_route(env):
    adr = make_address()
    status, est, resp = invoke(orders, ev("GET /orders/estimate", key=None) | {"queryStringParameters": {"address_id": adr}})
    assert status == 200 and resp["headers"]["Cache-Control"] == "no-store"
    assert est == {
        "prep_minutes": 20, "travel_minutes": 12, "total_minutes": 35,
        "estimated_delivery_at": "2026-11-13T05:05:00.000Z", "approximate": False, "can_order": True,
    }
    # no address given: the default address is used
    status, est, _ = invoke(orders, ev("GET /orders/estimate", key=None))
    assert status == 200 and est["travel_minutes"] == 12 and est["approximate"] is False
    # a user with no address: a typical 2 km
    status, est, _ = invoke(orders, ev("GET /orders/estimate", BOB, key=None))
    assert status == 200 and est["travel_minutes"] == 13 and est["approximate"] is True
    # someone else's address id: 404
    event = ev("GET /orders/estimate", BOB, key=None) | {"queryStringParameters": {"address_id": adr}}
    assert invoke(orders, event)[0] == 404


def test_estimate_says_when_closed(env):
    env["clock"]["now"] = datetime(2026, 11, 13, 21, 0, tzinfo=IST)
    status, est, _ = invoke(orders, ev("GET /orders/estimate", key=None))
    assert status == 200 and est["can_order"] is False and "9:00 AM" in est["closed_reason"]


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
    env["clock"]["now"] = TEN_AM + timedelta(minutes=5)
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


@pytest.mark.parametrize("status_now", ["PREPARING", "CONFIRMED", "ASSIGNED"])
def test_can_cancel_until_out_for_delivery(env, status_now):
    adr = make_address()
    _, o, _ = place(adr)
    env["table"].update_item(
        Key={"PK": f"USER#{ALICE['sub']}", "SK": f"ORDER#{o['id']}"},
        UpdateExpression="SET #s = :s", ExpressionAttributeNames={"#s": "status"},
        ExpressionAttributeValues={":s": status_now},
    )
    status, out, _ = invoke(orders, ev("POST /orders/{id}/cancel", order_id=o["id"]))
    assert status == 200 and out["status"] == "CANCELLED" and out["cancelled_at"]
    assert "refund_status" not in out  # cash: nothing to refund


@pytest.mark.parametrize("status_now", ["OUT_FOR_DELIVERY", "DELIVERED"])
def test_cannot_cancel_once_out_for_delivery(env, status_now):
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
