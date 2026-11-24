from decimal import Decimal

import boto3
import pytest

import catalog
from conftest import REGION, TABLE, call


@pytest.fixture
def menu(aws):
    catalog.reset_clients()
    t = boto3.resource("dynamodb", region_name=REGION).Table(TABLE)

    def cat(cid, name, order, active=True):
        t.put_item(Item={
            "PK": "CATALOG", "SK": f"CATEGORY#{cid}", "entity": "CATEGORY", "id": cid,
            "name": name, "name_mr": "मिसळ", "image_url": f"https://cdn.test/menu/{cid}.jpg",
            "sort_order": Decimal(order), "is_active": active,
        })

    def prd(pid, cid, name, price, available=True, spice=True):
        t.put_item(Item={
            "PK": "CATALOG", "SK": f"PRODUCT#{pid}", "entity": "PRODUCT", "id": pid,
            "category_id": cid, "name": name, "name_mr": "मिसळ पाव", "description": "desc",
            "price": Decimal(price), "image_url": f"https://cdn.test/menu/{pid}.jpg",
            "is_veg": True, "has_spice_level": spice, "is_available": available,
        })

    cat("cat_thali", "Thali", 2)
    cat("cat_misal", "Misal", 1)
    cat("cat_hidden", "Hidden", 3, active=False)
    prd("prd_misal_pav", "cat_misal", "Misal Pav", 9000)
    prd("prd_kolhapuri_misal", "cat_misal", "Kolhapuri Misal", 11000, available=False)
    prd("prd_misal_thali", "cat_thali", "Misal Thali", 15000)
    # Something else in the same partition key space must not leak in.
    t.put_item(Item={"PK": "USER#x", "SK": "PROFILE", "user_id": "x"})
    yield t
    catalog.reset_clients()


def test_categories_active_only_sorted(menu):
    status, body = call(catalog, "GET /categories")
    assert status == 200
    assert [c["id"] for c in body] == ["cat_misal", "cat_thali"]
    assert body[0] == {
        "id": "cat_misal",
        "name": "Misal",
        "name_mr": "मिसळ",
        "image_url": "https://cdn.test/menu/cat_misal.jpg",
        "sort_order": 1,
        "is_active": True,
    }


def test_products_contract_shape_and_ints(menu):
    status, body = call(catalog, "GET /products")
    assert status == 200
    assert len(body) == 3
    p = next(x for x in body if x["id"] == "prd_misal_pav")
    assert p == {
        "id": "prd_misal_pav",
        "category_id": "cat_misal",
        "name": "Misal Pav",
        "name_mr": "मिसळ पाव",
        "description": "desc",
        "price": 9000,
        "image_url": "https://cdn.test/menu/prd_misal_pav.jpg",
        "is_veg": True,
        "has_spice_level": True,
        "is_available": True,
    }
    assert isinstance(p["price"], int) and not isinstance(p["price"], bool)


def test_sold_out_products_are_included(menu):
    _, body = call(catalog, "GET /products")
    sold_out = next(x for x in body if x["id"] == "prd_kolhapuri_misal")
    assert sold_out["is_available"] is False


def test_products_sorted_by_category_then_name(menu):
    _, body = call(catalog, "GET /products")
    assert [p["id"] for p in body] == ["prd_kolhapuri_misal", "prd_misal_pav", "prd_misal_thali"]


def test_cache_header(menu):
    resp = catalog.handler({"routeKey": "GET /products", "requestContext": {}}, None)
    assert resp["headers"]["Cache-Control"] == "public, max-age=60"
    assert resp["headers"]["Content-Type"] == "application/json"


def test_marathi_is_not_escaped(menu):
    resp = catalog.handler({"routeKey": "GET /categories", "requestContext": {}}, None)
    assert "मिसळ" in resp["body"]


def test_empty_catalog(aws):
    catalog.reset_clients()
    assert call(catalog, "GET /categories") == (200, [])
    assert call(catalog, "GET /products") == (200, [])


def test_pagination_is_followed(menu, monkeypatch):
    real_query = menu.query
    pages = []

    def paged_query(**kwargs):
        result = real_query(**{**kwargs, "Limit": 1})
        pages.append(1)
        return result

    monkeypatch.setattr(catalog.table(), "query", paged_query)
    _, body = call(catalog, "GET /products")
    assert len(body) == 3 and len(pages) >= 3


def test_unknown_route(menu):
    status, body = call(catalog, "POST /products")
    assert status == 404 and body["error"]["code"] == "NOT_FOUND"
