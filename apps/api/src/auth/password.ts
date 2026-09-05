import bcrypt from 'bcryptjs';

const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);

/**
 * Compared against when no user matches, so an unknown identifier costs the
 * same time as a known one and the response cannot be used to enumerate
 * accounts.
 */
const DUMMY_HASH = bcrypt.hashSync('fledge-dummy-password', ROUNDS);

export const hashPassword = (plain: string) => bcrypt.hash(plain, ROUNDS);

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (hash === null) { await bcrypt.compare(plain, DUMMY_HASH); return false; }
  return bcrypt.compare(plain, hash);
}

/**
 * Length only. It does more for strength than character classes, and a rule a
 * child cannot satisfy is a rule a teacher works around by choosing
 * "Password1!" for the whole class.
 */
export function passwordProblem(plain: string, min = Number(process.env.PASSWORD_MIN_LENGTH ?? 10)): string | null {
  if (plain.length < min) return `Use at least ${min} characters.`;
  if (plain.length > 200) return 'That is longer than 200 characters.';
  return null;
}
