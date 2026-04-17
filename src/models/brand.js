import { DataTypes } from "sequelize";
import { sequelize } from "../config/database.js";

export const Brand = sequelize.define(
  "Brand",
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    slug: {
      type: DataTypes.STRING(255),
      unique: true,
    },
    logo: {
      type: DataTypes.TEXT,
    },
    url: {
      type: DataTypes.STRING(255),
    },
    raw_data: {
      type: DataTypes.TEXT("long"),
    },
  },
  {
    tableName: "brands",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);