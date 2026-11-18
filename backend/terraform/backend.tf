terraform {
  backend "s3" {
    bucket       = "tfstate-630287363216-ap-south-1"
    key          = "tf-workspace/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
