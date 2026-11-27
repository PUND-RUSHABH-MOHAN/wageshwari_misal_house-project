# API Gateway HTTP API = the public HTTPS front door. It matches "METHOD /path" to a route,
# checks the JWT on protected routes, and passes the request to the right Lambda.

locals {
  # auth = true -> the JWT authorizer must accept the token before the Lambda runs.
  routes = {
    "POST /auth/register"        = { fn = "auth", auth = false }
    "POST /auth/confirm"         = { fn = "auth", auth = false }
    "POST /auth/resend-code"     = { fn = "auth", auth = false }
    "POST /auth/login"           = { fn = "auth", auth = false }
    "POST /auth/refresh"         = { fn = "auth", auth = false }
    "POST /auth/logout"          = { fn = "auth", auth = false }
    "POST /auth/password/forgot" = { fn = "auth", auth = false }
    "POST /auth/password/reset"  = { fn = "auth", auth = false }
    "GET /me"                    = { fn = "me", auth = true }
    "PATCH /me"                  = { fn = "me", auth = true }
    "GET /categories"            = { fn = "catalog", auth = false }
    "GET /products"              = { fn = "catalog", auth = false }
    "GET /addresses"             = { fn = "addresses", auth = true }
    "POST /addresses"            = { fn = "addresses", auth = true }
    "PATCH /addresses/{id}"      = { fn = "addresses", auth = true }
    "DELETE /addresses/{id}"     = { fn = "addresses", auth = true }
    "POST /orders"               = { fn = "orders", auth = true }
    "GET /orders"                = { fn = "orders", auth = true }
    "GET /orders/{id}"           = { fn = "orders", auth = true }
    "POST /orders/{id}/cancel"   = { fn = "orders", auth = true }
    "POST /orders/{id}/payment"  = { fn = "orders", auth = true }
    # Admin: the JWT authorizer checks the login; admin.py checks the `admin` group (403 otherwise).
    "GET /admin/orders"              = { fn = "admin", auth = true }
    "POST /admin/orders/{id}/status" = { fn = "admin", auth = true }
    "GET /admin/categories"          = { fn = "admin", auth = true }
    "POST /admin/categories"         = { fn = "admin", auth = true }
    "PATCH /admin/categories/{id}"   = { fn = "admin", auth = true }
    "GET /admin/products"            = { fn = "admin", auth = true }
    "POST /admin/products"           = { fn = "admin", auth = true }
    "PATCH /admin/products/{id}"     = { fn = "admin", auth = true }
  }
}

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.project}-api"
  protocol_type = "HTTP"
  description   = "Wagheshwar Misal House app API"
}

# JWT authorizer: verifies the Cognito ID token's signature, expiry, issuer (our pool)
# and audience (our app client). Handlers then just read the verified claims.
resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.http.id
  name             = "cognito"
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = "https://${aws_cognito_user_pool.main.endpoint}"
    audience = [aws_cognito_user_pool_client.app.id]
  }
}

resource "aws_apigatewayv2_integration" "fn" {
  for_each               = local.api_functions
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.fn[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "route" {
  for_each           = local.routes
  api_id             = aws_apigatewayv2_api.http.id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.fn[each.value.fn].id}"
  authorization_type = each.value.auth ? "JWT" : "NONE"
  authorizer_id      = each.value.auth ? aws_apigatewayv2_authorizer.cognito.id : null
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${var.project}-api"
  retention_in_days = var.log_retention_days
}

# $default stage = served at the API's base URL with no /stage prefix.
# auto_deploy publishes route changes immediately.
resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.api_throttle_rate
    throttling_burst_limit = var.api_throttle_burst
  }

  # One JSON line per request. No headers or bodies, so no tokens/passwords get logged.
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId    = "$context.requestId"
      time         = "$context.requestTime"
      ip           = "$context.identity.sourceIp"
      routeKey     = "$context.routeKey"
      status       = "$context.status"
      latencyMs    = "$context.responseLatency"
      authError    = "$context.authorizer.error"
      integrError  = "$context.integrationErrorMessage"
      userSub      = "$context.authorizer.claims.sub"
      responseSize = "$context.responseLength"
    })
  }
}
