"""Me Lambda: the signed-in user's own profile. Both routes sit behind the JWT authorizer,
so the claims are already verified; the user id is always the token's `sub`.

Routes
  GET   /me
  PATCH /me   {name?, phone?}
"""

from __future__ import annotations

import users
from common import (
    ApiError,
    dispatch,
    jwt_claims,
    parse_body,
    response,
    role_from_claims,
    validate_name,
    validate_phone,
)

_PATCHABLE = {"name": validate_name, "phone": validate_phone}


def reset_clients() -> None:
    users.reset_clients()


def get_me(event: dict) -> dict:
    claims = jwt_claims(event)
    profile = users.get_or_create_profile(claims["sub"], email=claims.get("email", ""))
    return response(200, users.to_user(profile, role_from_claims(claims)))


def patch_me(event: dict) -> dict:
    claims = jwt_claims(event)
    body = parse_body(event)

    if "email" in body:
        # Email is the sign-in identity in Cognito; changing it needs a verify-new-email
        # flow that isn't built yet.
        raise ApiError(400, "EMAIL_CHANGE_NOT_SUPPORTED", "Changing your email isn't supported yet.")
    unknown = sorted(set(body) - set(_PATCHABLE))
    if unknown:
        raise ApiError(400, "VALIDATION_ERROR", f"Unknown field(s): {', '.join(unknown)}.")
    changes = {field: _PATCHABLE[field](body[field]) for field in body}
    if not changes:
        raise ApiError(400, "VALIDATION_ERROR", "Send at least one of `name`, `phone`.")

    profile = users.update_profile(claims["sub"], changes, email=claims.get("email", ""))
    return response(200, users.to_user(profile, role_from_claims(claims)))


ROUTES = {
    "GET /me": get_me,
    "PATCH /me": patch_me,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
