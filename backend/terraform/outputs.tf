output "api_base_url" {
  description = "Put this in the app's .env as EXPO_PUBLIC_API_BASE_URL."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  value = aws_cognito_user_pool_client.app.id
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "media_base_url" {
  description = "CloudFront address for menu photos."
  value       = "https://${aws_cloudfront_distribution.media.domain_name}"
}

output "region" {
  value = var.region
}

# SHA-256 of each embedded handler file. Compare with backend/src to prove the
# deployed code is byte-identical to what the tests ran against.
output "lambda_source_sha256" {
  value = { for name, src in local.lambda_sources : name => sha256(src) }
}
