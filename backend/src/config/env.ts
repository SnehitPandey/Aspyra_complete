import { config } from 'dotenv';
import { z } from 'zod';

// Load environment variables
config();

// Environment schema with validation
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1000).max(65535).default(5000),
  HOST: z.string().default('localhost'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url('Invalid DATABASE_URL format'),

  // --- Add your JWT variables here ---
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_ACCESS_TOKEN_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters long'),
  JWT_REFRESH_TOKEN_EXPIRES_IN: z.string().default('7d'),
  // --- redis variables ---
  REDIS_URL: z.string().url('Invalid REDIS_URL format'),
  REDIS_PASSWORD: z.string().optional(),
  SOCKET_IO_CORS_ORIGIN: z.string().url().default('http://localhost:3000'),
  
  // --- Cookie and Upload variables ---
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 characters long'),
  UPLOAD_DIR: z.string().default('./uploads'),
  
  // --- Gemini AI variables ---
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required for AI features'),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
  GEMINI_MAX_TOKENS: z.coerce.number().min(1).max(8192).default(2048),
  
  // --- Google OAuth variables ---
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().url().default('http://localhost:5000/api/auth/google/callback'),
  FRONTEND_URL: z.string().url().default('http://localhost:3000'),
  
  // --- Email/SMTP variables ---
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.string().optional(),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

// Validate and parse environment variables
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parseResult.error.format());
  process.exit(1);
}

export const env = parseResult.data;

// Type-safe environment configuration
export type Environment = z.infer<typeof envSchema>;
