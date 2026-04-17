-- Migration 002: Create brands table

CREATE TABLE IF NOT EXISTS `brands` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(255) NOT NULL,
  `slug`       VARCHAR(255) NULL UNIQUE,
  `url`        VARCHAR(255) NULL,
  `logo`        VARCHAR(2048) NULL,
  `raw_data`   LONGTEXT     NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
