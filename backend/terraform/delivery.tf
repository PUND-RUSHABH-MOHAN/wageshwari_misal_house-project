# Part 7c: delivery boys. Members of this Cognito group see the Deliveries tab in the app and
# only the orders assigned to them (checked in delivery.py). Add people by hand, like admins
# (backend README "Add a delivery boy"). One person may be in both `admin` and `delivery`.
resource "aws_cognito_user_group" "delivery" {
  name         = "delivery"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Delivery boys. See and deliver the orders assigned to them."
  precedence   = 2
}
