# Seed photos: the 5 food photos already in the repo, uploaded to s3://<media bucket>/menu/.
# Terraform reads them from GitHub at a pinned commit (the Terraform workspace only
# holds .tf files), so the upload is reproducible and needs no manual step.
# New photos for new dishes come from the admin screen (roadmap part 6).

locals {
  photo_source_commit = "83b676a42d6968a4ba3ec21f275fd67bfe64b5dc"
  photo_source_base   = "https://raw.githubusercontent.com/PUND-RUSHABH-MOHAN/wageshwari_misal_house-project/${local.photo_source_commit}/wageshwari_misal_house/assets/images/food"
  menu_photos         = toset(["misal.jpg", "special-thali.jpg", "misal-thali.jpg", "vada-pav.jpg", "chaha.jpg"])
  menu_photo_base_url = "https://${aws_cloudfront_distribution.media.domain_name}/menu"
}

data "http" "menu_photo" {
  for_each = local.menu_photos
  url      = "${local.photo_source_base}/${each.key}"

  lifecycle {
    postcondition {
      condition     = self.status_code == 200
      error_message = "Could not download ${each.key} from GitHub (HTTP ${self.status_code})."
    }
  }
}

resource "aws_s3_object" "menu_photo" {
  for_each       = local.menu_photos
  bucket         = aws_s3_bucket.media.id
  key            = "menu/${each.key}"
  # sensitive() only hides the image bytes in plan output, so the plan stays readable.
  content_base64 = sensitive(data.http.menu_photo[each.key].response_body_base64)
  content_type   = "image/jpeg"
  # Phones and CloudFront may reuse a photo for a day before checking for a new one.
  cache_control = "public, max-age=86400"
}
