# One Lambda per domain. Each zip holds the shared modules plus its own handler.
# Code comes from local.lambda_sources (lambda_sources.tf, generated from backend/src).
# archive_file zips it during plan; if the code changes, the zip hash changes and
# Terraform updates the function. This replaces `sam build`.

locals {
  functions = {
    auth = {
      handler = "auth.handler"
      files   = ["common.py", "users.py", "auth.py"]
    }
    me = {
      handler = "me.handler"
      files   = ["common.py", "users.py", "me.py"]
    }
    catalog = {
      handler = "catalog.handler"
      files   = ["common.py", "users.py", "store.py", "catalog.py"]
    }
    addresses = {
      handler = "addresses.handler"
      files   = ["common.py", "users.py", "addresses.py"]
    }
    orders = {
      handler = "orders.handler"
      files   = ["common.py", "users.py", "store.py", "addresses.py", "eta.py", "orders.py"]
    }
    admin = {
      handler = "admin.handler"
      files   = ["common.py", "users.py", "store.py", "addresses.py", "eta.py", "orders.py", "catalog.py", "delivery_boys.py", "admin.py"]
    }
    # The delivery boy's Deliveries tab (part 7c).
    delivery = {
      handler = "delivery.handler"
      files   = ["common.py", "users.py", "store.py", "addresses.py", "eta.py", "orders.py", "delivery_boys.py", "delivery.py"]
    }
    # Not behind the API: EventBridge Scheduler runs it every 10 minutes (scheduler.tf).
    expire = {
      handler = "expire.handler"
      files   = ["common.py", "users.py", "store.py", "addresses.py", "eta.py", "orders.py", "expire.py"]
    }
  }

  # The functions API Gateway calls (everything except scheduled jobs).
  api_functions = { for name, fn in local.functions : name => fn if name != "expire" }

  upi_env = {
    UPI_ID                 = lower(trimspace(var.upi_id))
    UPI_PAYEE_NAME         = var.upi_payee_name
    PAYMENT_WINDOW_MINUTES = tostring(var.payment_window_minutes)
  }

  # Settings only some functions need, so the others aren't redeployed when they change.
  function_env = {
    orders = merge(local.upi_env, {
      MIN_ORDER_PAISE = tostring(var.min_order_paise)
    })
    admin  = local.upi_env
    expire = local.upi_env
  }
}

data "archive_file" "fn" {
  for_each    = local.functions
  type        = "zip"
  output_path = "${path.module}/.build/${each.key}.zip"

  dynamic "source" {
    for_each = each.value.files
    content {
      content  = local.lambda_sources[source.value]
      filename = source.value
    }
  }
}

# Created by Terraform (not by Lambda on first run) so retention is set and destroy is clean.
resource "aws_cloudwatch_log_group" "fn" {
  for_each          = local.functions
  name              = "/aws/lambda/${var.project}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "fn" {
  for_each = local.functions

  function_name    = "${var.project}-${each.key}"
  role             = aws_iam_role.lambda.arn
  runtime          = "python3.13"
  architectures    = ["arm64"] # Graviton: ~20% cheaper than x86 for the same work
  handler          = each.value.handler
  filename         = data.archive_file.fn[each.key].output_path
  source_code_hash = data.archive_file.fn[each.key].output_base64sha256
  memory_size      = 256
  timeout          = 10

  environment {
    variables = merge({
      TABLE_NAME          = aws_dynamodb_table.main.name
      USER_POOL_CLIENT_ID = aws_cognito_user_pool_client.app.id
      LOG_LEVEL           = "INFO"
      SHOP_LATITUDE       = tostring(var.shop_latitude)
      SHOP_LONGITUDE      = tostring(var.shop_longitude)
      DELIVERY_RADIUS_KM  = tostring(var.delivery_radius_km)
      SHOP_CITY           = var.shop_city
    }, try(local.function_env[each.key], {}))
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }

  depends_on = [aws_iam_role_policy.lambda]
}

# Allow API Gateway (this API only) to invoke the functions.
resource "aws_lambda_permission" "apigw" {
  for_each      = local.api_functions
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
