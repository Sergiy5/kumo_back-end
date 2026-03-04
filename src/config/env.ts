import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env.test when NODE_ENV=test, otherwise .env
const envFile = process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

const isProd = process.env.NODE_ENV === 'production';

const optional = z.string().optional();
const optionalNum = z.string().transform(Number).optional();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OPENAI_API_KEY: isProd ? z.string() : optional,
  AWS_ACCESS_KEY_ID: optional,
  AWS_SECRET_ACCESS_KEY: optional,
  AWS_REGION: z.string().default('us-east-1'),
  AWS_S3_BUCKET: optional,
  SMTP_HOST: isProd ? z.string() : optional,
  SMTP_PORT: isProd ? z.string().transform(Number) : optionalNum,
  SMTP_USER: isProd ? z.string() : optional,
  SMTP_PASS: isProd ? z.string() : optional,
  SMTP_FROM: isProd ? z.string() : optional,
  // RevenueCat (subscription management)
  REVENUECAT_SECRET_API_KEY: isProd ? z.string() : optional,
  REVENUECAT_WEBHOOK_SECRET: isProd ? z.string() : optional,
  // Expo Push Notifications (optional — increases delivery reliability)
  EXPO_ACCESS_TOKEN: optional,
  GOOGLE_SHEETS_PRIVATE_KEY: isProd ? z.string() : optional,
  GOOGLE_SHEETS_CLIENT_EMAIL: isProd ? z.string() : optional,
  GOOGLE_SHEETS_SPREADSHEET_ID: isProd ? z.string() : optional,
  // Google OAuth Client IDs (at least one required in production)
  GOOGLE_WEB_CLIENT_ID: optional,
  GOOGLE_ANDROID_CLIENT_ID: optional,
  GOOGLE_IOS_CLIENT_ID: optional,
  PORT: z.string().transform(Number).default('3001'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
