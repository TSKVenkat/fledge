import { z } from 'zod';

/**
 * Parsed once at boot, so a bad value stops the process rather than failing on
 * the first request that happens to touch it.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  SECRET_KEY: z.string().refine(
    (v) => { try { return Buffer.from(v, 'base64').length === 32; } catch { return false; } },
    'SECRET_KEY must be 32 bytes, base64 encoded',
  ),
  PUBLIC_URL: z.string().url().default('http://localhost:8080'),
  SANDBOX_URL: z.string().url().default('http://sandbox.localhost:8080'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  // Read directly by password.ts, but declared here anyway so a typo fails the
  // process at boot rather than silently leaving the default in place.
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(10),
  ALLOW_MICROPIP: z.enum(['true', 'false']).default('false'),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

/** Origins allowed to call the API with credentials. */
export function webOrigins(env: Env): string[] {
  return [...new Set([new URL(env.PUBLIC_URL).origin])];
}
