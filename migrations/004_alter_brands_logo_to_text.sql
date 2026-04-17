-- Migration 004: Change logo column from VARCHAR(2048) to TEXT

ALTER TABLE `brands`
  MODIFY COLUMN `logo` TEXT NULL;
