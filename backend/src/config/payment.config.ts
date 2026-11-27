import "dotenv/config";

const configuredExpiryHours = process.env.PAYMENT_EXPIRY_HOURS;
const parsedExpiryHours = configuredExpiryHours === undefined
  ? 48
  : Number(configuredExpiryHours);

if (
  !Number.isSafeInteger(parsedExpiryHours)
  || parsedExpiryHours < 1
  || parsedExpiryHours > 24 * 365
) {
  throw new Error("PAYMENT_EXPIRY_HOURS must be an integer between 1 and 8760");
}

export const PAYMENT_EXPIRY_HOURS = parsedExpiryHours;
export const PAYMENT_EXPIRY_MS = PAYMENT_EXPIRY_HOURS * 60 * 60 * 1000;
