-- Migration 001: Create database
-- Run once as a privileged MySQL user before running subsequent migrations.

CREATE DATABASE IF NOT EXISTS `hackathon`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `hackathon`;
