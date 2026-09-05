import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM over anything that must be stored but also shown again later --
 * a share token, an anonymous project's edit token.
 *
 * The hash of such a token is what we look it up by; this exists only so the
 * person who created it can be shown it a second time. Changing SECRET_KEY
 * therefore makes existing sealed values unreadable, and there is no rotation
 * procedure yet.
 */
export interface Sealed { ct: string; iv: string; tag: string }

const keyOf = (secret: string) => Buffer.from(secret, 'base64');

export function seal(plaintext: string, secret: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ct: ct.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function open(sealed: Sealed, secret: string): string | null {
  if (!sealed.ct) return null;   // pre-migration rows hold no ciphertext
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function sign(value: string, secret: string): string {
  return createHmac('sha256', keyOf(secret)).update(value).digest('base64url');
}

export function verify(value: string, signature: string, secret: string): boolean {
  const expected = Buffer.from(sign(value, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
