import { Sequelize } from "sequelize";
import dotenv from "dotenv";

dotenv.config();

export const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASS,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false // Required for Supabase connections
      }
    },
    logging: false, // set true for debug
  }
);

export async function connectDB() {
  try {
    await sequelize.authenticate();
    console.log("Supabase (PostgreSQL) connected");
  } catch (error) {
    console.error("Supabase connection failed:", error);
    process.exit(1);
  }
}