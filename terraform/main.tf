terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "aws_db_instance" "steelcore" {
  identifier        = "steelcore-db"
  engine            = "postgres"
  engine_version    = "15"
  instance_class    = "db.t3.micro"
  allocated_storage = 20
  db_name           = "steelcore"
  username          = "steelcore"
  password          = random_password.db_password.result
  skip_final_snapshot = true
  publicly_accessible = false
  storage_encrypted = true
}

resource "aws_s3_bucket" "steelcore_sdks" {
  bucket = "steelcore-sdks-${random_password.db_password.result}"
}

resource "aws_s3_bucket_versioning" "steelcore_sdks" {
  bucket = aws_s3_bucket.steelcore_sdks.id
  versioning_configuration {
    status = "Enabled"
  }
}

output "database_password" {
  value     = random_password.db_password.result
  sensitive = true
}

output "s3_bucket_name" {
  value = aws_s3_bucket.steelcore_sdks.id
}
