# One table for the whole app (single-table design). Items are told apart by keys:
#   PK = "USER#<cognito sub>", SK = "PROFILE"       user profile (this part)
#   PK = "USER#<cognito sub>", SK = "ADDRESS#<id>"  addresses (part 4)
#   PK = "USER#<cognito sub>", SK = "ORDER#<id>"    orders (part 5)
#   PK = "USER#<cognito sub>", SK = "IDEMP#<key>"   "no double orders" records (part 5, expire)
#   PK = "COUNTER",            SK = "ORDER#<date>"  daily order-number counter (part 5)
#   PK = "ORDERREF#<id>",      SK = "ORDER"         which user an order belongs to (part 6)
#   PK = "UTR#<utr>",          SK = "UTR"           which order a UPI reference was used for (part 7)
#   PK = "SETTINGS",           SK = "STORE"         online orders on/off switch (part 7b)
#   PK = "CATALOG",            SK = "CATEGORY#/PRODUCT#<id>"  the menu (part 3)
#
# GSI1 (part 6): the kitchen's order board. Only orders carry GSI1PK/GSI1SK, so only orders are
# copied into it ("sparse" index):
#   GSI1PK = "ORDERDATE#<delivery_date>", GSI1SK = "<slot hour>#<created_at>#<id>"
# One Query on GSI1 = all orders for a day, by slot then time.

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

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # A global secondary index is a second copy of the matching items, kept in sync by DynamoDB,
  # with its own keys. Adding it to an existing table happens online; DynamoDB back-fills it
  # from the orders already stored (they have carried GSI1PK/GSI1SK since part 5).
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL" # the board shows whole orders, so copy every attribute
  }

  # TTL: DynamoDB deletes an item for free some time (usually within 48 h) after the epoch
  # seconds in `expires_at` pass. Only items that have the attribute are affected; today
  # that is just the idempotency records. Code still checks expiry itself.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  # Continuous backups: restore the table to any second in the last 35 days.
  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true
}
