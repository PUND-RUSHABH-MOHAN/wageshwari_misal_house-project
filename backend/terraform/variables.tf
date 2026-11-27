variable "project" {
  description = "Name prefix for every resource (wmh-users, wmh-auth, wmh-api, ...)."
  type        = string
  default     = "wmh"
}

variable "region" {
  description = "AWS region (Mumbai, the closest region to Jalna)."
  type        = string
  default     = "ap-south-1"
}

variable "log_retention_days" {
  description = "How long Lambda and API access logs are kept."
  type        = number
  default     = 14
}

variable "api_throttle_rate" {
  description = "Steady-state requests per second allowed across the whole API."
  type        = number
  default     = 50
}

variable "api_throttle_burst" {
  description = "Short burst of requests allowed above the steady rate."
  type        = number
  default     = 100
}

# The hotel: A/P Chandanzira, Jalna – Chh. Sambhajinagar Highway, Jalna 431203.
# 19°51'24.6"N 75°51'07.0"E, given by the owner on 2026-11-25.
variable "shop_latitude" {
  description = "Hotel latitude (decimal degrees). Centre of the delivery area."
  type        = number
  default     = 19.856833
}

variable "shop_longitude" {
  description = "Hotel longitude (decimal degrees)."
  type        = number
  default     = 75.851944
}

variable "delivery_radius_km" {
  description = "Addresses further than this (straight line) from the hotel are refused."
  type        = number
  default     = 3
}

variable "shop_city" {
  description = "City stored on every delivery address."
  type        = string
  default     = "Jalna"
}

variable "min_order_paise" {
  description = "Smallest food subtotal (before delivery and GST) an order may have, in paise."
  type        = number
  default     = 10000 # ₹100
}

# --- Direct UPI payments (part 7) -------------------------------------------------------------
# The UPI ID is NOT committed (it contains a phone number and this repo is public). Set it in
# `upi.auto.tfvars` in the Terraform workspace (git-ignored). Empty = UPI checkout switched off.
variable "upi_id" {
  description = "Hotel's UPI ID (VPA) customers pay to, e.g. a business UPI ID. Empty disables UPI."
  type        = string
  default     = ""
}

variable "upi_payee_name" {
  description = "Name customers see in their UPI app when paying."
  type        = string
  default     = "Wagheshwar Misal House"
}

variable "payment_window_minutes" {
  description = "Unpaid UPI orders (no UTR sent) are cancelled after this many minutes."
  type        = number
  default     = 30
}
