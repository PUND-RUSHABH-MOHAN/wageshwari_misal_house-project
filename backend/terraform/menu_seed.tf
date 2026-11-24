# Starting menu, written to DynamoDB once.
#
# lifecycle.ignore_changes = [item]: after the first apply, Terraform never overwrites
# these rows, so edits made later (admin screen, roadmap part 6) stick. To stop
# Terraform tracking a row at all (e.g. before deleting a dish in the admin screen):
#   terraform state rm 'aws_dynamodb_table_item.menu_product["prd_chaha"]'
#
# Prices are integer paise (9000 = ₹90). Placeholder prices from the app's mock data.

locals {
  menu_categories = {
    cat_misal   = { name = "Misal", name_mr = "मिसळ", photo = "misal.jpg", sort_order = 1 }
    cat_thali   = { name = "Thali", name_mr = "थाळी", photo = "special-thali.jpg", sort_order = 2 }
    cat_vadapav = { name = "Vada Pav", name_mr = "वडा पाव", photo = "vada-pav.jpg", sort_order = 3 }
    cat_chaha   = { name = "Chaha", name_mr = "चहा", photo = "chaha.jpg", sort_order = 4 }
  }

  menu_products = {
    prd_misal_pav = {
      category_id = "cat_misal", name = "Misal Pav", name_mr = "मिसळ पाव", price = 9000, spice = true, photo = "misal.jpg"
      description = "Spicy matki usal with tarri, farsan, onion, lemon and 2 soft pav."
    }
    prd_kolhapuri_misal = {
      category_id = "cat_misal", name = "Kolhapuri Misal", name_mr = "कोल्हापुरी मिसळ", price = 11000, spice = true, photo = "misal.jpg"
      description = "Fiery red Kolhapuri kat, sprouted matki, farsan, onion and 2 pav."
    }
    prd_misal_thali = {
      category_id = "cat_thali", name = "Misal Thali", name_mr = "मिसळ थाळी", price = 15000, spice = true, photo = "misal-thali.jpg"
      description = "Misal with 4 pav, tarri, salad, farsan and a glass of taak."
    }
    prd_special_thali = {
      category_id = "cat_thali", name = "Special Misal Thali", name_mr = "स्पेशल मिसळ थाळी", price = 18000, spice = true, photo = "special-thali.jpg"
      description = "Misal, extra tarri, pav, dahi, papad, farsan, kanda-limbu and taak."
    }
    prd_vada_pav = {
      category_id = "cat_vadapav", name = "Vada Pav", name_mr = "वडा पाव", price = 2500, spice = false, photo = "vada-pav.jpg"
      description = "Crisp batata vada in soft pav with green chutney, lasun chutney and fried mirchi."
    }
    prd_chaha = {
      category_id = "cat_chaha", name = "Kadak Chaha", name_mr = "कडक चहा", price = 1500, spice = false, photo = "chaha.jpg"
      description = "Strong Puneri cutting chai with ginger and elaichi. Chahala vel nasto!"
    }
  }
}

resource "aws_dynamodb_table_item" "menu_category" {
  for_each   = local.menu_categories
  table_name = aws_dynamodb_table.main.name
  hash_key   = aws_dynamodb_table.main.hash_key
  range_key  = aws_dynamodb_table.main.range_key

  item = jsonencode({
    PK         = { S = "CATALOG" }
    SK         = { S = "CATEGORY#${each.key}" }
    entity     = { S = "CATEGORY" }
    id         = { S = each.key }
    name       = { S = each.value.name }
    name_mr    = { S = each.value.name_mr }
    image_url  = { S = "${local.menu_photo_base_url}/${each.value.photo}" }
    sort_order = { N = tostring(each.value.sort_order) }
    is_active  = { BOOL = true }
  })

  lifecycle {
    ignore_changes = [item]
  }
}

resource "aws_dynamodb_table_item" "menu_product" {
  for_each   = local.menu_products
  table_name = aws_dynamodb_table.main.name
  hash_key   = aws_dynamodb_table.main.hash_key
  range_key  = aws_dynamodb_table.main.range_key

  item = jsonencode({
    PK              = { S = "CATALOG" }
    SK              = { S = "PRODUCT#${each.key}" }
    entity          = { S = "PRODUCT" }
    id              = { S = each.key }
    category_id     = { S = each.value.category_id }
    name            = { S = each.value.name }
    name_mr         = { S = each.value.name_mr }
    description     = { S = each.value.description }
    price           = { N = tostring(each.value.price) }
    image_url       = { S = "${local.menu_photo_base_url}/${each.value.photo}" }
    is_veg          = { BOOL = true }
    has_spice_level = { BOOL = each.value.spice }
    is_available    = { BOOL = true }
  })

  lifecycle {
    ignore_changes = [item]
  }

  depends_on = [aws_dynamodb_table_item.menu_category]
}
