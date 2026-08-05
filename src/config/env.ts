import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT:                z.string().default('5000'),
  NODE_ENV:            z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL:        z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_SECRET:   z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET:  z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_EXPIRES:  z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  BCRYPT_ROUNDS:       z.string().default('12'),
  ALLOWED_ORIGINS:     z.string().default('http://localhost:3000'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),
  GMAIL_USER:          z.string().optional(),
  GMAIL_APP_PASSWORD:  z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
