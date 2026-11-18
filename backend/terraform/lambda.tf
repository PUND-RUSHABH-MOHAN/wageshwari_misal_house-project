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
    variables = {
      TABLE_NAME          = aws_dynamodb_table.main.name
      USER_POOL_CLIENT_ID = aws_cognito_user_pool_client.app.id
      LOG_LEVEL           = "INFO"
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.fn[each.key].name
  }

  depends_on = [aws_iam_role_policy.lambda]
}

# Allow API Gateway (this API only) to invoke the functions.
resource "aws_lambda_permission" "apigw" {
  for_each      = local.functions
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
