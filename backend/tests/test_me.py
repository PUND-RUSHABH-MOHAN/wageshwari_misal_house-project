import me
from conftest import TABLE, call

SUB = "11111111-2222-3333-4444-555555555555"
CLAIMS = {"sub": SUB, "email": "user@example.com"}


def seed_profile(aws, **fields):
    item = {
        "PK": {"S": f"USER#{SUB}"},
        "SK": {"S": "PROFILE"},
        "user_id": {"S": SUB},
        "email": {"S": "user@example.com"},
        "name": {"S": fields.get("name", "Tushar")},
        "phone": {"S": fields.get("phone", "9876543210")},
        "is_active": {"BOOL": True},
    }
    aws["ddb"].put_item(TableName=TABLE, Item=item)


def test_get_me_requires_claims(aws):
    status, body = call(me, "GET /me")
    assert status == 401 and body["error"]["code"] == "UNAUTHORIZED"


def test_get_me_returns_user(aws):
    seed_profile(aws)
    status, body = call(me, "GET /me", claims=CLAIMS)
    assert status == 200
    assert body == {
        "id": SUB,
        "name": "Tushar",
        "phone": "9876543210",
        "email": "user@example.com",
        "role": "customer",
        "roles": [],
        "is_active": True,
    }


def test_get_me_admin_from_api_gateway_group_string(aws):
    # API Gateway passes array claims as a string like "[admin]".
    seed_profile(aws)
    status, body = call(me, "GET /me", claims={**CLAIMS, "cognito:groups": "[admin]"})
    assert status == 200 and body["role"] == "admin" and body["roles"] == ["admin"]


def test_get_me_staff_roles(aws):
    seed_profile(aws)
    status, body = call(me, "GET /me", claims={**CLAIMS, "cognito:groups": "[delivery admin]"})
    assert status == 200 and body["role"] == "admin" and body["roles"] == ["admin", "delivery"]
    _, body = call(me, "GET /me", claims={**CLAIMS, "cognito:groups": ["delivery"]})
    assert body["role"] == "customer" and body["roles"] == ["delivery"]


def test_get_me_creates_missing_profile(aws):
    status, body = call(me, "GET /me", claims=CLAIMS)
    assert status == 200
    assert body["id"] == SUB and body["name"] == "" and body["email"] == "user@example.com"


def test_patch_me_updates_name_and_phone(aws):
    seed_profile(aws)
    status, body = call(me, "PATCH /me", {"name": " Tushar  Kulange ", "phone": "9123456789"}, claims=CLAIMS)
    assert status == 200
    assert body["name"] == "Tushar Kulange" and body["phone"] == "9123456789"
    status, body = call(me, "GET /me", claims=CLAIMS)
    assert body["name"] == "Tushar Kulange"


def test_patch_me_ignores_user_id_in_body(aws):
    seed_profile(aws)
    status, body = call(me, "PATCH /me", {"user_id": "someone-else", "name": "X"}, claims=CLAIMS)
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_me_rejects_email(aws):
    status, body = call(me, "PATCH /me", {"email": "new@example.com"}, claims=CLAIMS)
    assert status == 400 and body["error"]["code"] == "EMAIL_CHANGE_NOT_SUPPORTED"


def test_patch_me_validates(aws):
    status, body = call(me, "PATCH /me", {"phone": "12345"}, claims=CLAIMS)
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_me_empty(aws):
    status, body = call(me, "PATCH /me", {}, claims=CLAIMS)
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


def test_patch_me_creates_missing_profile(aws):
    status, body = call(me, "PATCH /me", {"name": "New"}, claims=CLAIMS)
    assert status == 200 and body["name"] == "New" and body["email"] == "user@example.com"


def test_me_unknown_route(aws):
    status, body = call(me, "DELETE /me", claims=CLAIMS)
    assert status == 404
