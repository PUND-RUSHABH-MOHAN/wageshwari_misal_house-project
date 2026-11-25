import pytest

import addresses
from conftest import TABLE, call

HOTEL = (19.856833, 75.851944)
NEAR = (19.8700, 75.8600)  # ~1.7 km from the hotel
FAR = (19.8459, 75.9069)  # Jalna head post office, ~5.9 km
PUNE = (18.5204, 73.8567)

ALICE = {"sub": "aaaaaaaa-0000-0000-0000-000000000001", "email": "alice@example.com"}
BOB = {"sub": "bbbbbbbb-0000-0000-0000-000000000002", "email": "bob@example.com"}


def body(**over):
    b = {
        "label": "Home",
        "receiver_name": "  Naman   K ",
        "receiver_phone": "9876543210",
        "line1": "Plot 7, Ekta Nagar",
        "line2": "Near Chandanzira",
        "landmark": "",
        "pincode": "431203",
        "latitude": NEAR[0],
        "longitude": NEAR[1],
        "is_default": False,
    }
    b.update(over)
    return b


@pytest.fixture
def env(aws, monkeypatch):
    monkeypatch.setenv("SHOP_LATITUDE", str(HOTEL[0]))
    monkeypatch.setenv("SHOP_LONGITUDE", str(HOTEL[1]))
    monkeypatch.setenv("DELIVERY_RADIUS_KM", "3")
    monkeypatch.setenv("SHOP_CITY", "Jalna")
    addresses.users.reset_clients()
    yield aws
    addresses.users.reset_clients()


def create(claims=ALICE, **over):
    return call(addresses, "POST /addresses", body(**over), claims=claims)


def path_call(route, address_id, claims=ALICE, payload=None):
    import json

    event = {
        "routeKey": route,
        "pathParameters": {"id": address_id},
        "requestContext": {"authorizer": {"jwt": {"claims": claims}}},
    }
    if payload is not None:
        event["body"] = json.dumps(payload)
    resp = addresses.handler(event, None)
    return resp["statusCode"], (json.loads(resp["body"]) if resp.get("body") else None)


def listing(claims=ALICE):
    status, out = call(addresses, "GET /addresses", claims=claims)
    assert status == 200
    return out


# ---------------------------------------------------------------- distance
def test_distance_helper():
    assert addresses.distance_km(*HOTEL, *HOTEL) == 0
    assert 1.5 < addresses.distance_km(*HOTEL, *NEAR) < 2.0
    assert 5.5 < addresses.distance_km(*HOTEL, *FAR) < 6.2


# ---------------------------------------------------------------- create
def test_create_first_address_is_default_and_city_jalna(env):
    status, a = create(is_default=False)
    assert status == 201
    assert a["is_default"] is True  # first one always becomes default
    assert a["city"] == "Jalna"
    assert a["user_id"] == ALICE["sub"]
    assert a["receiver_name"] == "Naman K"
    assert a["id"].startswith("adr_")
    assert 1.5 < a["distance_km"] < 2.0
    assert "landmark" not in a  # empty optional fields are omitted
    assert a["line2"] == "Near Chandanzira"


def test_create_at_the_hotel_is_fine(env):
    status, a = create(latitude=HOTEL[0], longitude=HOTEL[1])
    assert status == 201 and a["distance_km"] == 0


def test_create_out_of_range(env):
    status, out = create(latitude=FAR[0], longitude=FAR[1])
    assert status == 422
    assert out["error"]["code"] == "OUT_OF_DELIVERY_AREA"
    assert "5.9 km" in out["error"]["message"] and "3 km" in out["error"]["message"]
    status, out = create(latitude=PUNE[0], longitude=PUNE[1])
    assert status == 422


def test_radius_comes_from_env(env, monkeypatch):
    monkeypatch.setenv("DELIVERY_RADIUS_KM", "7")
    status, _ = create(latitude=FAR[0], longitude=FAR[1])
    assert status == 201


def test_create_requires_location(env):
    b = body()
    del b["latitude"], b["longitude"]
    status, out = call(addresses, "POST /addresses", b, claims=ALICE)
    assert status == 400 and out["error"]["code"] == "LOCATION_REQUIRED"
    status, out = create(latitude="19.8", longitude="75.8")
    assert status == 400 and out["error"]["code"] == "LOCATION_REQUIRED"


def test_city_and_user_id_in_body_are_ignored(env):
    status, a = create(city="Pune", user_id=BOB["sub"])
    assert status == 201 and a["city"] == "Jalna" and a["user_id"] == ALICE["sub"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("label", "Hostel"),
        ("receiver_name", ""),
        ("receiver_phone", "12345"),
        ("receiver_phone", "+919876543210"),
        ("line1", "abc"),
        ("pincode", "411038"),  # Pune
        ("pincode", "43120"),
        ("latitude", 123.0),
        ("is_default", "yes"),
    ],
)
def test_create_validation(env, field, value):
    status, out = create(**{field: value})
    assert status == 400, out
    assert out["error"]["code"] in ("VALIDATION_ERROR", "LOCATION_REQUIRED")


def test_unknown_field_rejected(env):
    status, out = create(colour="red")
    assert status == 400 and "colour" in out["error"]["message"]


def test_limit_of_five(env):
    for _ in range(5):
        assert create()[0] == 201
    status, out = create()
    assert status == 409 and out["error"]["code"] == "ADDRESS_LIMIT"


def test_requires_login(env):
    status, out = call(addresses, "GET /addresses")
    assert status == 401


# ---------------------------------------------------------------- default handling
def test_new_default_replaces_old_one(env):
    _, a1 = create()
    _, a2 = create(label="Work", is_default=True)
    items = listing()
    assert [a["id"] for a in items] == [a2["id"], a1["id"]]  # default first
    assert [a["is_default"] for a in items] == [True, False]


def test_exactly_one_default_always(env):
    for i in range(4):
        create(is_default=(i % 2 == 0))
    assert sum(a["is_default"] for a in listing()) == 1


def test_patch_set_default(env):
    _, a1 = create()
    _, a2 = create()
    status, out = path_call("PATCH /addresses/{id}", a2["id"], payload={"is_default": True})
    assert status == 200 and out["is_default"] is True
    assert {a["id"]: a["is_default"] for a in listing()} == {a1["id"]: False, a2["id"]: True}


def test_unsetting_the_default_is_ignored(env):
    _, a1 = create()
    status, out = path_call("PATCH /addresses/{id}", a1["id"], payload={"is_default": False, "label": "Work"})
    assert status == 200 and out["is_default"] is True and out["label"] == "Work"


def test_delete_default_promotes_oldest(env):
    _, a1 = create()
    _, a2 = create()
    _, a3 = create(is_default=True)
    assert path_call("DELETE /addresses/{id}", a3["id"])[0] == 204
    items = listing()
    assert [a["id"] for a in items] == [a1["id"], a2["id"]]
    assert items[0]["is_default"] is True


def test_delete_last_address(env):
    _, a1 = create()
    assert path_call("DELETE /addresses/{id}", a1["id"])[0] == 204
    assert listing() == []
    _, a2 = create()
    assert a2["is_default"] is True


# ---------------------------------------------------------------- patch
def test_patch_fields(env):
    _, a = create()
    status, out = path_call(
        "PATCH /addresses/{id}",
        a["id"],
        payload={"line1": "Shop 3, Highway Road", "landmark": "Opp. petrol pump", "receiver_phone": "9123456789"},
    )
    assert status == 200
    assert out["line1"] == "Shop 3, Highway Road"
    assert out["landmark"] == "Opp. petrol pump"
    assert out["receiver_phone"] == "9123456789"
    assert out["receiver_name"] == "Naman K"  # untouched


def test_patch_location_is_rechecked(env):
    _, a = create()
    status, out = path_call("PATCH /addresses/{id}", a["id"], payload={"latitude": FAR[0], "longitude": FAR[1]})
    assert status == 422 and out["error"]["code"] == "OUT_OF_DELIVERY_AREA"
    status, out = path_call("PATCH /addresses/{id}", a["id"], payload={"latitude": HOTEL[0]})
    assert status == 400


def test_patch_nothing(env):
    _, a = create()
    status, out = path_call("PATCH /addresses/{id}", a["id"], payload={})
    assert status == 400


# ---------------------------------------------------------------- isolation between users
def test_users_cannot_see_or_touch_each_other(env):
    _, alice_addr = create(ALICE)
    create(BOB)
    assert [a["id"] for a in listing(ALICE)] == [alice_addr["id"]]
    assert len(listing(BOB)) == 1

    status, _ = path_call("PATCH /addresses/{id}", alice_addr["id"], claims=BOB, payload={"label": "Work"})
    assert status == 404
    status, _ = path_call("DELETE /addresses/{id}", alice_addr["id"], claims=BOB)
    assert status == 404
    assert listing(ALICE)[0]["label"] == "Home"


@pytest.mark.parametrize("bad_id", ["", "adr_x", "../USER#x", "PROFILE", "adr_00000000000000000000"])
def test_bad_ids_are_404(env, bad_id):
    status, out = path_call("DELETE /addresses/{id}", bad_id)
    assert status == 404


def test_default_pointer_on_profile_not_breaking_me(env):
    import me

    create()
    status, user = call(me, "GET /me", claims=ALICE)
    assert status == 200 and "default_address_id" not in user


def test_stale_default_pointer_self_heals(env):
    _, a1 = create()
    # Simulate a pointer to an address that no longer exists.
    addresses.users.update_profile(ALICE["sub"], {"default_address_id": "adr_ffffffffffffffff"}, email="x")
    items = listing()
    assert items[0]["id"] == a1["id"] and items[0]["is_default"] is True


def test_table_holds_items_under_user_partition(env):
    _, a = create()
    item = env["ddb"].get_item(
        TableName=TABLE, Key={"PK": {"S": f"USER#{ALICE['sub']}"}, "SK": {"S": f"ADDRESS#{a['id']}"}}
    )["Item"]
    assert item["city"]["S"] == "Jalna" and item["latitude"]["N"] == "19.87"
