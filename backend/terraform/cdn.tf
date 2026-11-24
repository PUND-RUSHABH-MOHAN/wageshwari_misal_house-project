# Menu photos: a private S3 bucket served through CloudFront.
#
# S3 = file storage. The bucket blocks all public access; nobody can read it directly.
# CloudFront = AWS's CDN. It caches files at edge locations near users (Mumbai, Chennai,
# Delhi, ...) and is the only thing allowed to read the bucket, via Origin Access Control.

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "media" {
  # Bucket names are global across all AWS accounts, so the account id keeps it unique.
  bucket = "${var.project}-media-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket                  = aws_s3_bucket.media.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "media" {
  bucket = aws_s3_bucket.media.id
  rule {
    object_ownership = "BucketOwnerEnforced" # no per-object ACLs; the bucket policy decides
  }
}

# Lets CloudFront sign its requests to S3, so S3 can tell them apart from anyone else's.
resource "aws_cloudfront_origin_access_control" "media" {
  name                              = "${var.project}-media"
  description                       = "CloudFront -> ${aws_s3_bucket.media.bucket}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# AWS-managed cache settings for static files (long TTLs, gzip/brotli, no cookies/query strings).
data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_distribution" "media" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.project} menu photos"
  http_version    = "http2and3"
  # PriceClass_200 is the cheapest class that includes India's edge locations.
  price_class = "PriceClass_200"

  origin {
    origin_id                = "media-s3"
    domain_name              = aws_s3_bucket.media.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.media.id
  }

  default_cache_behavior {
    target_origin_id       = "media-s3"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # *.cloudfront.net address with AWS's certificate. A custom domain comes in roadmap part 10.
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Only this CloudFront distribution may read objects from the bucket.
data "aws_iam_policy_document" "media_bucket" {
  statement {
    sid       = "CloudFrontReadOnly"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.media.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.media.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "media" {
  bucket     = aws_s3_bucket.media.id
  policy     = data.aws_iam_policy_document.media_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.media]
}
