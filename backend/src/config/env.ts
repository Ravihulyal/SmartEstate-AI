
import "dotenv/config";

const jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  throw new Error("JWT_SECRET is missing in the .env file");
}

export const JWT_SECRET: string = jwtSecret;
