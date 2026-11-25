"""Test fixtures: moto mocks DynamoDB + Cognito in-process, so no AWS account is touched."""

import json
import os
import sys

import boto3
import pytest
from moto import mock_aws

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

REGION = "ap-south-1"
TABLE = "wmh-test"


@pytest.fixture(autouse=True)
def aws_env(monkeypatch):
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.setenv("TABLE_NAME", TABLE)


@pytest.fixture
def aws(monkeypatch):
    """Mocked AWS with a table and a user pool configured like cognito.tf."""
    with mock_aws():
        ddb = boto3.client("dynamodb", region_name=REGION)
        ddb.create_table(
            TableName=TABLE,
            AttributeDefinitions=[
                {"AttributeName": "PK", "AttributeType": "S"},
                {"AttributeName": "SK", "AttributeType": "S"},
                {"AttributeName": "GSI1PK", "AttributeType": "S"},
                {"AttributeName": "GSI1SK", "AttributeType": "S"},
            ],
            KeySchema=[
                {"AttributeName": "PK", "KeyType": "HASH"},
                {"AttributeName": "SK", "KeyType": "RANGE"},
            ],
            GlobalSecondaryIndexes=[  # like dynamodb.tf
                {
                    "IndexName": "GSI1",
                    "KeySchema": [
                        {"AttributeName": "GSI1PK", "KeyType": "HASH"},
                        {"AttributeName": "GSI1SK", "KeyType": "RANGE"},
                    ],
                    "Projection": {"ProjectionType": "ALL"},
                }
            ],
            BillingMode="PAY_PER_REQUEST",
        )
        idp = boto3.client("cognito-idp", region_name=REGION)
        pool = idp.create_user_pool(
            PoolName="wmh-test",
            UsernameAttributes=["email"],
            AutoVerifiedAttributes=["email"],
            Policies={
                "PasswordPolicy": {
                    "MinimumLength": 8,
                    "RequireLowercase": True,
                    "RequireNumbers": True,
                    "RequireUppercase": False,
                    "RequireSymbols": False,
                }
            },
        )["UserPool"]
        client = idp.create_user_pool_client(
            UserPoolId=pool["Id"],
            ClientName="wmh-app",
            GenerateSecret=False,
            ExplicitAuthFlows=["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
        )["UserPoolClient"]
        idp.create_group(GroupName="admin", UserPoolId=pool["Id"])
        monkeypatch.setenv("USER_POOL_CLIENT_ID", client["ClientId"])

        import auth
        import me

        auth.reset_clients()
        me.reset_clients()
        yield {"idp": idp, "pool_id": pool["Id"], "client_id": client["ClientId"], "ddb": ddb}
        auth.reset_clients()
        me.reset_clients()


def call(module, route_key, body=None, claims=None, raw_body=None):
    event = {"routeKey": route_key, "requestContext": {}}
    if raw_body is not None:
        event["body"] = raw_body
    elif body is not None:
        event["body"] = json.dumps(body)
    if claims is not None:
        event["requestContext"]["authorizer"] = {"jwt": {"claims": claims}}
    resp = module.handler(event, None)
    parsed = json.loads(resp["body"]) if resp.get("body") else None
    return resp["statusCode"], parsed
