# EventBridge Scheduler: AWS's managed timer. Every 10 minutes it invokes `wmh-expire`, which
# cancels UPI orders that were never paid (no UTR) within var.payment_window_minutes.
# Costs nothing at this volume (free tier: 14 million invocations a month).

# The scheduler acts through its own IAM role, allowed to invoke only that one function.
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id] # declared in cdn.tf
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${var.project}-scheduler-invoke"
  role = aws_iam_role.scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.fn["expire"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "expire_unpaid" {
  name                = "${var.project}-expire-unpaid-upi"
  description         = "Cancel UPI orders with no payment reported within the payment window."
  schedule_expression = "rate(10 minutes)"

  flexible_time_window {
    mode = "OFF" # run on time
  }

  target {
    arn      = aws_lambda_function.fn["expire"].arn
    role_arn = aws_iam_role.scheduler.arn

    retry_policy {
      maximum_retry_attempts = 1 # the next run is 10 minutes away anyway
    }
  }
}
