from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError

import auth
from conftest import TABLE, call

EMAIL = "Naman.Test+wmh1@Gmail.com"
EMAIL_NORM = "naman.test+wmh1@gmail.com"
PASSWORD = "misal2026"
REG = {"name": "  Naman   K ", "email": EMAIL, "password": PASSWORD, "phone": "9876543210"}


def _client_error(code):
    return ClientError({"Error": {"Code": code, "Message": code}}, "op")


def register_and_confirm(aws, body=REG):
    status, _ = call(auth, "POST /auth/register", body)
    assert status == 201
    aws["idp"].admin_confirm_sign_up(UserPoolId=aws["pool_id"], Username=body["email"].strip().lower())


def login(email=EMAIL, password=PASSWORD):
    return call(auth, "POST /auth/login", {"email": email, "password": password})


# ---------------------------------------------------------------- register
def test_register_creates_unconfirmed_user_and_profile(aws):
    status, body = call(auth, "POST /auth/register", REG)
    assert status == 201
    assert body["user_confirmed"] is False

    user = aws["idp"].admin_get_user(UserPoolId=aws["pool_id"], Username=EMAIL_NORM)
    assert user["UserStatus"] == "UNCONFIRMED"
    sub = next(a["Value"] for a in user["UserAttributes"] if a["Name"] == "sub")

    item = aws["ddb"].get_item(TableName=TABLE, Key={"PK": {"S": f"USER#{sub}"}, "SK": {"S": "PROFILE"}})["Item"]
    assert item["name"]["S"] == "Naman K"  # whitespace collapsed
    assert item["phone"]["S"] == "9876543210"
    assert item["email"]["S"] == EMAIL_NORM  # lower-cased
    assert "password" not in item


@pytest.mark.parametrize(
    "field,value,code",
    [
        ("email", "not-an-email", "VALIDATION_ERROR"),
        ("phone", "+919876543210", "VALIDATION_ERROR"),
        ("phone", "1234567890", "VALIDATION_ERROR"),
        ("name", "   ", "VALIDATION_ERROR"),
        ("password", "short1", "WEAK_PASSWORD"),
        ("password", "nonumbers", "WEAK_PASSWORD"),
        ("password", "NOLOWER123", "WEAK_PASSWORD"),
    ],
)
def test_register_validation(aws, field, value, code):
    status, body = call(auth, "POST /auth/register", {**REG, field: value})
    assert status == 400
    assert body["error"]["code"] == code


def test_register_accepts_password_without_upper_or_symbol(aws):
    status, _ = call(auth, "POST /auth/register", {**REG, "password": "abcdefg1"})
    assert status == 201


def test_register_duplicate_email(aws):
    call(auth, "POST /auth/register", REG)
    status, body = call(auth, "POST /auth/register", {**REG, "email": EMAIL_NORM})
    assert status == 409
    assert body["error"]["code"] == "EMAIL_TAKEN"


def test_register_bad_json(aws):
    status, body = call(auth, "POST /auth/register", raw_body="{nope")
    assert status == 400
    assert body["error"]["code"] == "INVALID_JSON"


def test_register_array_body(aws):
    status, body = call(auth, "POST /auth/register", raw_body="[1,2]")
    assert status == 400
    assert body["error"]["code"] == "INVALID_JSON"


# ---------------------------------------------------------------- confirm / resend
def test_confirm_validates_code_format(aws):
    status, body = call(auth, "POST /auth/confirm", {"email": EMAIL, "code": "12ab"})
    assert status == 400
    assert body["error"]["code"] == "VALIDATION_ERROR"


def test_confirm_success(aws):
    call(auth, "POST /auth/register", REG)
    with patch.object(auth.cognito(), "confirm_sign_up", return_value={}) as m:
        status, body = call(auth, "POST /auth/confirm", {"email": EMAIL, "code": "123456"})
    assert status == 200 and body == {"confirmed": True}
    assert m.call_args.kwargs["Username"] == EMAIL_NORM


@pytest.mark.parametrize(
    "cognito_code,status,api_code",
    [
        ("CodeMismatchException", 400, "INVALID_CODE"),
        ("ExpiredCodeException", 400, "CODE_EXPIRED"),
        ("NotAuthorizedException", 409, "ALREADY_CONFIRMED"),
        ("LimitExceededException", 429, "TOO_MANY_REQUESTS"),
        ("SomethingNewException", 500, "AUTH_SERVICE_ERROR"),
    ],
)
def test_confirm_error_mapping(aws, cognito_code, status, api_code):
    with patch.object(auth.cognito(), "confirm_sign_up", side_effect=_client_error(cognito_code)):
        got_status, body = call(auth, "POST /auth/confirm", {"email": EMAIL, "code": "123456"})
    assert (got_status, body["error"]["code"]) == (status, api_code)


def test_resend_code_unknown_email_does_not_leak(aws):
    with patch.object(auth.cognito(), "resend_confirmation_code", side_effect=_client_error("UserNotFoundException")):
        status, body = call(auth, "POST /auth/resend-code", {"email": "nobody@example.com"})
    assert status == 200 and body == {"code_delivery": None}


def test_resend_code_already_confirmed(aws):
    with patch.object(auth.cognito(), "resend_confirmation_code", side_effect=_client_error("InvalidParameterException")):
        status, body = call(auth, "POST /auth/resend-code", {"email": EMAIL})
    assert status == 409 and body["error"]["code"] == "ALREADY_CONFIRMED"


def test_resend_code_success(aws):
    # moto doesn't implement resend_confirmation_code; check our mapping + args.
    delivery = {"CodeDeliveryDetails": {"DeliveryMedium": "EMAIL", "Destination": "n***@g***"}}
    with patch.object(auth.cognito(), "resend_confirmation_code", return_value=delivery) as m:
        status, body = call(auth, "POST /auth/resend-code", {"email": EMAIL})
    assert status == 200
    assert body == {"code_delivery": {"medium": "EMAIL", "destination": "n***@g***"}}
    assert m.call_args.kwargs["Username"] == EMAIL_NORM


# ---------------------------------------------------------------- login
def test_login_unconfirmed_user_is_rejected(aws):
    call(auth, "POST /auth/register", REG)
    with patch.object(auth.cognito(), "initiate_auth", side_effect=_client_error("UserNotConfirmedException")):
        status, body = login()
    assert status == 403 and body["error"]["code"] == "USER_NOT_CONFIRMED"


def test_login_success_returns_contract_shape(aws):
    register_and_confirm(aws)
    status, body = login()
    assert status == 200
    assert set(body) == {"token", "refresh_token", "expires_in", "user"}
    assert body["token"].count(".") == 2
    assert isinstance(body["expires_in"], int)
    user = body["user"]
    assert set(user) == {"id", "name", "phone", "email", "role", "is_active"}
    assert user["name"] == "Naman K"
    assert user["phone"] == "9876543210"
    assert user["email"] == EMAIL_NORM
    assert user["role"] == "customer"
    assert user["is_active"] is True


def test_login_admin_role_from_group(aws):
    register_and_confirm(aws)
    aws["idp"].admin_add_user_to_group(UserPoolId=aws["pool_id"], Username=EMAIL_NORM, GroupName="admin")
    status, body = login()
    assert status == 200 and body["user"]["role"] == "admin"


def test_login_wrong_password(aws):
    register_and_confirm(aws)
    status, body = login(password="wrongpass1")
    assert status == 401 and body["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_unknown_user_same_error(aws):
    status, body = login(email="ghost@example.com")
    assert status == 401 and body["error"]["code"] == "INVALID_CREDENTIALS"


def test_login_creates_missing_profile(aws):
    # A user created outside the API (console) has no profile row yet.
    aws["idp"].admin_create_user(
        UserPoolId=aws["pool_id"],
        Username="console@example.com",
        UserAttributes=[{"Name": "email", "Value": "console@example.com"}, {"Name": "email_verified", "Value": "true"}],
        MessageAction="SUPPRESS",
    )
    aws["idp"].admin_set_user_password(
        UserPoolId=aws["pool_id"], Username="console@example.com", Password="console123", Permanent=True
    )
    status, body = login("console@example.com", "console123")
    assert status == 200
    assert body["user"]["email"] == "console@example.com"
    assert body["user"]["name"] == ""


def test_login_challenge(aws):
    with patch.object(auth.cognito(), "initiate_auth", return_value={"ChallengeName": "NEW_PASSWORD_REQUIRED"}):
        status, body = login()
    assert status == 403 and body["error"]["code"] == "CHALLENGE_REQUIRED"


def test_login_missing_password(aws):
    status, body = call(auth, "POST /auth/login", {"email": EMAIL})
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------- refresh / logout
def test_refresh_returns_new_id_token(aws):
    register_and_confirm(aws)
    _, session = login()
    status, body = call(auth, "POST /auth/refresh", {"refresh_token": session["refresh_token"]})
    assert status == 200
    assert body["token"].count(".") == 2
    assert isinstance(body["expires_in"], int)


def test_refresh_invalid_token(aws):
    status, body = call(auth, "POST /auth/refresh", {"refresh_token": "garbage"})
    assert status == 401 and body["error"]["code"] == "INVALID_REFRESH_TOKEN"


def test_logout_revokes_refresh_token(aws):
    # moto doesn't implement revoke_token; that refresh fails afterwards is checked live.
    with patch.object(auth.cognito(), "revoke_token", return_value={}) as m:
        status, body = call(auth, "POST /auth/logout", {"refresh_token": "rt-123"})
    assert status == 204 and body is None
    assert m.call_args.kwargs == {"Token": "rt-123", "ClientId": aws["client_id"]}


def test_logout_throttled_is_reported(aws):
    with patch.object(auth.cognito(), "revoke_token", side_effect=_client_error("TooManyRequestsException")):
        status, body = call(auth, "POST /auth/logout", {"refresh_token": "rt-123"})
    assert status == 429


def test_logout_is_idempotent(aws):
    with patch.object(auth.cognito(), "revoke_token", side_effect=_client_error("UnsupportedTokenTypeException")):
        status, _ = call(auth, "POST /auth/logout", {"refresh_token": "already-dead"})
    assert status == 204


def test_logout_requires_token(aws):
    status, body = call(auth, "POST /auth/logout", {})
    assert status == 400 and body["error"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------- password reset
def test_forgot_password_never_reveals_account(aws):
    status_known, body_known = (None, None)
    register_and_confirm(aws)
    status_known, body_known = call(auth, "POST /auth/password/forgot", {"email": EMAIL})
    with patch.object(auth.cognito(), "forgot_password", side_effect=_client_error("UserNotFoundException")):
        status_unknown, body_unknown = call(auth, "POST /auth/password/forgot", {"email": "ghost@example.com"})
    assert status_known == status_unknown == 200
    assert body_known == body_unknown


def test_forgot_password_throttled(aws):
    with patch.object(auth.cognito(), "forgot_password", side_effect=_client_error("LimitExceededException")):
        status, body = call(auth, "POST /auth/password/forgot", {"email": EMAIL})
    assert status == 429 and body["error"]["code"] == "TOO_MANY_REQUESTS"


def test_reset_password_weak(aws):
    status, body = call(
        auth, "POST /auth/password/reset", {"email": EMAIL, "code": "123456", "new_password": "weak"}
    )
    assert status == 400 and body["error"]["code"] == "WEAK_PASSWORD"


def test_reset_password_success(aws):
    with patch.object(auth.cognito(), "confirm_forgot_password", return_value={}) as m:
        status, body = call(
            auth, "POST /auth/password/reset", {"email": EMAIL, "code": "123456", "new_password": "newmisal1"}
        )
    assert status == 200 and body == {"password_reset": True}
    assert m.call_args.kwargs["Username"] == EMAIL_NORM


def test_reset_password_bad_code(aws):
    with patch.object(auth.cognito(), "confirm_forgot_password", side_effect=_client_error("CodeMismatchException")):
        status, body = call(
            auth, "POST /auth/password/reset", {"email": EMAIL, "code": "123456", "new_password": "newmisal1"}
        )
    assert status == 400 and body["error"]["code"] == "INVALID_CODE"


# ---------------------------------------------------------------- routing
def test_unknown_route(aws):
    status, body = call(auth, "GET /auth/nope")
    assert status == 404 and body["error"]["code"] == "NOT_FOUND"


def test_unexpected_exception_is_500_without_details(aws):
    with patch.object(auth.cognito(), "initiate_auth", side_effect=RuntimeError("secret internals")):
        status, body = login()
    assert status == 500
    assert body["error"]["code"] == "INTERNAL"
    assert "secret" not in body["error"]["message"]
