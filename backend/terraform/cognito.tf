# Cognito User Pool = the user directory: it stores emails + password hashes,
# sends confirmation / reset codes, and issues the JWTs the app sends back to the API.

resource "aws_cognito_user_pool" "main" {
  name = "${var.project}-users"

  # Users sign in with their email (Cognito keeps an internal UUID as the real username).
  # Fixed at creation: changing it later means a new pool and migrating every user.
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  username_configuration {
    case_sensitive = false # Naman@Gmail.com and naman@gmail.com are the same user
  }

  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_numbers                  = true
    require_uppercase                = false
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  mfa_configuration = "OFF"

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  admin_create_user_config {
    allow_admin_create_user_only = false # anyone can sign up from the app
  }

  # Cognito's built-in sender: ~50 emails/day, from no-reply@verificationemail.com.
  # Swap to SES before launch (roadmap part 10).
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "Your Wagheshwar Misal House code"
    email_message        = "Your Wagheshwar Misal House verification code is {####}. It expires in 24 hours."
  }

  # A changed email stays unverified until the user confirms the new one.
  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  # Real users live here: refuse deletion until this is set to INACTIVE by hand.
  deletion_protection = "ACTIVE"
}

# The "app client" is how the mobile app identifies itself to the pool.
# Public client = no secret, because anything shipped in an APK can be extracted.
resource "aws_cognito_user_pool_client" "app" {
  name         = "${var.project}-app"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # "Wrong email or password" instead of "no such user", so emails can't be probed.
  prevent_user_existence_errors = "ENABLED"

  # Lets POST /auth/logout revoke a refresh token.
  enable_token_revocation = true

  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 30

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

# Members of this group get role "admin" in the API (roadmap part 6).
resource "aws_cognito_user_group" "admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "Kitchen / shop staff. Can manage orders and the menu."
  precedence   = 1
}
