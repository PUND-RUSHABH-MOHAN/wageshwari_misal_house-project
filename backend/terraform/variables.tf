variable "project" {
  description = "Name prefix for every resource (wmh-users, wmh-auth, wmh-api, ...)."
  type        = string
  default     = "wmh"
}

variable "region" {
  description = "AWS region. Mumbai, closest to Pune."
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
