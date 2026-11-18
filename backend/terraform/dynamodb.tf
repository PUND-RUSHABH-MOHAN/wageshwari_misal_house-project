# One table for the whole app (single-table design). Items are told apart by keys:
#   PK = "USER#<cognito sub>", SK = "PROFILE"       user profile (this part)
#   PK = "USER#<cognito sub>", SK = "ADDRESS#<id>"  addresses (part 4)
#   PK = "USER#<cognito sub>", SK = "ORDER#<id>"    orders (part 5)
# GSIs get added here when later parts need other access patterns.

resource "aws_dynamodb_table" "main" {
  name         = "${var.project}-main"
  billing_mode = "PAY_PER_REQUEST" # on-demand: pay per request, nothing when idle

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # Continuous backups: restore the table to any second in the last 35 days.
  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}
