"""Catalog Lambda: the menu. Both routes are public (no login needed).

Routes
  GET /categories   active categories, by sort_order        -> Category[]
  GET /products     every visible product, sold-out ones included   -> Product[]
                    (dishes hidden by the kitchen, is_active = false, are left out)

Storage (single table, one partition for the whole menu):
  PK = "CATALOG", SK = "CATEGORY#<id>"   a category
  PK = "CATALOG", SK = "PRODUCT#<id>"    a product (price in integer paise)
"""

from __future__ import annotations

import boto3
from boto3.dynamodb.conditions import Key

from common import dispatch, env, response

CATALOG_PK = "CATALOG"
# Lets phones and API Gateway reuse a menu for a minute; edits show up within ~60 s.
CACHE_HEADERS = {"Cache-Control": "public, max-age=60"}

_table = None


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(env("TABLE_NAME"))
    return _table


def reset_clients() -> None:
    global _table
    _table = None


def _query(sk_prefix: str) -> list[dict]:
    """All items in the CATALOG partition whose SK starts with `sk_prefix` (follows pagination)."""
    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("PK").eq(CATALOG_PK) & Key("SK").begins_with(sk_prefix)}
    while True:
        page = table().query(**kwargs)
        items.extend(page.get("Items", []))
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def to_category(item: dict) -> dict:
    """DynamoDB item -> the app's `Category` (src/types/index.ts)."""
    return {
        "id": item["id"],
        "name": item.get("name", ""),
        "name_mr": item.get("name_mr", ""),
        "image_url": item.get("image_url", ""),
        "sort_order": int(item.get("sort_order", 0)),
        "is_active": bool(item.get("is_active", True)),
    }


def to_product(item: dict) -> dict:
    """DynamoDB item -> the app's `Product` (src/types/index.ts)."""
    return {
        "id": item["id"],
        "category_id": item.get("category_id", ""),
        "name": item.get("name", ""),
        "name_mr": item.get("name_mr", ""),
        "description": item.get("description", ""),
        "price": int(item.get("price", 0)),
        "image_url": item.get("image_url", ""),
        "is_veg": bool(item.get("is_veg", True)),
        "has_spice_level": bool(item.get("has_spice_level", False)),
        "is_available": bool(item.get("is_available", True)),
    }


def get_categories(event: dict) -> dict:  # noqa: ARG001 - route signature
    categories = [to_category(i) for i in _query("CATEGORY#")]
    active = [c for c in categories if c["is_active"]]
    active.sort(key=lambda c: (c["sort_order"], c["name"]))
    return response(200, active, CACHE_HEADERS)


def get_products(event: dict) -> dict:  # noqa: ARG001 - route signature
    products = [to_product(i) for i in _query("PRODUCT#") if i.get("is_active", True)]
    products.sort(key=lambda p: (p["category_id"], p["name"]))
    return response(200, products, CACHE_HEADERS)


ROUTES = {
    "GET /categories": get_categories,
    "GET /products": get_products,
}


def handler(event, context):  # noqa: ARG001 - Lambda signature
    return dispatch(ROUTES, event)
