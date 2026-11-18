"""Auth Lambda: every /auth/* route. All routes are public (no JWT authorizer):
a user calling them has no valid token yet, or (logout/refresh) presents the
refresh token itself, which is the secret.

Routes
  POST /auth/register         {name, email, password, phone}
  POST /auth/confirm          {email, code}
  POST /auth/resend-code      {email}
  POST /auth/login            {email, password}
  POST /auth/refresh          {refresh_token}
  POST /auth/logout           {refresh_token}
  POST /auth/password/forgot  {email}
  POST /auth/password/reset   {email, code, new_password}

The app client is public (no secret), so these Cognito calls need no IAM
permissions: Cognito authenticates them by client id + user credentials.
"""

from __future__ import annotations

import base64
import json
import logging

import boto3
from botocore.exceptions import ClientError

import users
from common import (
    ApiError,
    dispatch,
    env,
    parse_body,
    require_str,
    response,
    role_from_claims,
    validate_code,
    validate_email,
    validate_name,
    validate_password,
    validate_phone,
)

logger = logging.getLogger()

_cognito = None


def cognito():
    global _cognito
    if _cognito is None:
        _cognito = boto3.client("cognito-idp")
    return _cognito


def reset_clients() -> None:
    global _cognito
    _cognito = None
    users.reset_clients()


# ---------------------------------------------------------------------------
# Cognito error mapping
# ---------------------------------------------------------------------------
_THROTTLED = {"LimitExceededException", "TooManyRequestsException", "TooManyFailedAttemptsException"}

_DEFAULT_ERRORS: dict[str, tuple[int, str, str]] = {
    "UsernameExistsException": (
        409,
        "EMAIL_TAKEN",
        "An account with this email already exists. If you haven't confirmed it, request a new code.",
    ),
    "InvalidPasswordException": (
        400,
        "WEAK_PASSWORD",
        "Password must be at least 8 characters and include a lowercase letter and a number.",
    ),
    "CodeMismatchException": (400, "INVALID_CODE", "That code is not correct."),
    "ExpiredCodeException": (400, "CODE_EXPIRED", "That code has expired. Request a new one."),
    "UserNotConfirmedException": (
        403,
        "USER_NOT_CONFIRMED",
        "Please confirm your email first. Check your inbox for the code.",
    ),
    "CodeDeliveryFailureException": (
        502,
        "EMAIL_DELIVERY_FAILED",
        "We couldn't send the email. Please try again later.",
    ),
    "InvalidParameterException": (400, "VALIDATION_ERROR", "The request was not valid."),
}


def _cognito_error(exc: ClientError, overrides: dict[str, tuple[int, str, str]] | None = None) -> ApiError:
    code = exc.response.get("Error", {}).get("Code", "")
    message = exc.response.get("Error", {}).get("Message", "")
    if code in _THROTTLED:
        return ApiError(429, "TOO_MANY_REQUESTS", "Too many attempts. Please wait a few minutes and try again.")
    mapping = {**_DEFAULT_ERRORS, **(overrides or {})}
    if code in mapping:
        status, api_code, api_message = mapping[code]
        return ApiError(status, api_code, api_message)
    logger.error("Unmapped Cognito error %s: %s", code, message)
    return ApiError(500, "AUTH_SERVICE_ERROR", "Authentication service error.")


def _delivery(details: dict | None) -> dict | None:
    if not details:
        return None
    return {"medium": details.get("DeliveryMedium"), "destination": details.get("Destination")}


def _decode_jwt_payload(token: str) -> dict:
    """Read claims from a token Cognito just handed us over TLS. Not a verification step:
    API Gateway's JWT authorizer verifies tokens on protected routes."""
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def register(event: dict) -> dict:
    body = parse_body(event)
    name = validate_name(body.get("name"))
    email = validate_email(body.get("email"))
    phone = validate_phone(body.get("phone"))
    password = validate_password(body.get("password"))
    try:
        result = cognito().sign_up(
            ClientId=env("USER_POOL_CLIENT_ID"),
            Username=email,
            Password=password,
            UserAttributes=[{"Name": "email", "Value": email}],
        )
    except ClientError as exc:
        raise _cognito_error(exc) from exc
    users.create_profile(result["UserSub"], email=email, name=name, phone=phone)
    return response(
        201,
        {
            "user_confirmed": bool(result.get("UserConfirmed")),
            "code_delivery": _delivery(result.get("CodeDeliveryDetails")),
        },
    )


def confirm(event: dict) -> dict:
    body = parse_body(event)
    email = validate_email(body.get("email"))
    code = validate_code(body.get("code"))
    try:
        cognito().confirm_sign_up(ClientId=env("USER_POOL_CLIENT_ID"), Username=email, ConfirmationCode=code)
    except ClientError as exc:
        raise _cognito_error(
            exc,
            {
                # Cognito says NotAuthorized when the account is already confirmed.
                "NotAuthorizedException": (409, "ALREADY_CONFIRMED", "This account is already confirmed. Please log in."),
                "UserNotFoundException": (400, "INVALID_CODE", "That code is not correct."),
            },
        ) from exc
    return response(200, {"confirmed": True})


def resend_code(event: dict) -> dict:
    body = parse_body(event)
    email = validate_email(body.get("email"))
    try:
        result = cognito().resend_confirmation_code(ClientId=env("USER_POOL_CLIENT_ID"), Username=email)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "UserNotFoundException":
            # Don't reveal whether an email is registered.
            return response(200, {"code_delivery": None})
        raise _cognito_error(
            exc,
            {"InvalidParameterException": (409, "ALREADY_CONFIRMED", "This account is already confirmed. Please log in.")},
        ) from exc
    return response(200, {"code_delivery": _delivery(result.get("CodeDeliveryDetails"))})


def login(event: dict) -> dict:
    body = parse_body(event)
    email = validate_email(body.get("email"))
    password = require_str(body, "password")
    try:
        result = cognito().initiate_auth(
            ClientId=env("USER_POOL_CLIENT_ID"),
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password},
        )
    except ClientError as exc:
        raise _cognito_error(
            exc,
            {
                "NotAuthorizedException": (401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
                "UserNotFoundException": (401, "INVALID_CREDENTIALS", "Email or password is incorrect."),
            },
        ) from exc

    if "AuthenticationResult" not in result:
        # e.g. NEW_PASSWORD_REQUIRED for a user an admin created in the console.
        raise ApiError(
            403, "CHALLENGE_REQUIRED", f"Additional sign-in step required: {result.get('ChallengeName', 'unknown')}."
        )

    tokens = result["AuthenticationResult"]
    claims = _decode_jwt_payload(tokens["IdToken"])
    profile = users.get_or_create_profile(claims["sub"], email=claims.get("email", email))
    return response(
        200,
        {
            "token": tokens["IdToken"],
            "refresh_token": tokens["RefreshToken"],
            "expires_in": tokens["ExpiresIn"],
            "user": users.to_user(profile, role_from_claims(claims)),
        },
    )


def refresh(event: dict) -> dict:
    body = parse_body(event)
    refresh_token = require_str(body, "refresh_token", max_len=8192)
    try:
        result = cognito().initiate_auth(
            ClientId=env("USER_POOL_CLIENT_ID"),
            AuthFlow="REFRESH_TOKEN_AUTH",
            AuthParameters={"REFRESH_TOKEN": refresh_token},
        )
    except ClientError as exc:
        raise _cognito_error(
            exc,
            {"NotAuthorizedException": (401, "INVALID_REFRESH_TOKEN", "Session expired. Please log in again.")},
        ) from exc
    tokens = result.get("AuthenticationResult") or {}
    if "IdToken" not in tokens:
        raise ApiError(401, "INVALID_REFRESH_TOKEN", "Session expired. Please log in again.")
    body_out = {"token": tokens["IdToken"], "expires_in": tokens["ExpiresIn"]}
    # Only present if refresh-token rotation is ever turned on.
    if tokens.get("RefreshToken"):
        body_out["refresh_token"] = tokens["RefreshToken"]
    return response(200, body_out)


def logout(event: dict) -> dict:
    """Revoke this device's refresh token. Idempotent: an already-invalid token is fine."""
    body = parse_body(event)
    refresh_token = require_str(body, "refresh_token", max_len=8192)
    try:
        cognito().revoke_token(Token=refresh_token, ClientId=env("USER_POOL_CLIENT_ID"))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in _THROTTLED:
            raise _cognito_error(exc) from exc
        logger.info("revoke_token ignored error %s", code)
    return response(204)


def password_forgot(event: dict) -> dict:
    body = parse_body(event)
    email = validate_email(body.get("email"))
    try:
        cognito().forgot_password(ClientId=env("USER_POOL_CLIENT_ID"), Username=email)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in _THROTTLED:
            raise _cognito_error(exc) from exc
        # Same answer whether or not the account exists or is confirmed.
        logger.info("forgot_password suppressed error %s", code)
    return response(200, {"message": "If an account exists for this email, a reset code has been sent."})


def password_reset(event: dict) -> dict:
    body = parse_body(event)
    email = validate_email(body.get("email"))
    code = validate_code(body.get("code"))
    new_password = validate_password(body.get("new_password"), "new_password")
    try:
        cognito().confirm_forgot_password(
            ClientId=env("USER_POOL_CLIENT_ID"),
            Username=email,
            ConfirmationCode=code,
            Password=new_password,
        )
    except ClientError as exc:
        raise _cognito_error(
            exc,
            {
                "UserNotFoundException": (400, "INVALID_CODE", "That code is not correct."),
                "NotAuthorizedException": (400, "INVALID_CODE", "That code is not correct."),
            },
        ) from exc
    return response(200, {"password_reset": True})


ROUTES = {
    "POST /auth/register": register,
    "POST /auth/confirm": confirm,
    "POST /auth/resend-code": resend_code,
    "POST /auth/login": login,
    "POST /auth/refresh": refresh,
    "POST /auth/logout": logout,
    "POST /auth/password/forgot": password_forgot,
    "POST /auth/password/reset": password_reset,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
