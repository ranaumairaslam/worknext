const crypto = require('crypto');

// Module-level constants — built once, not re-allocated on every call.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no 'l' to avoid confusion with 1
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no 'I', 'O'
const DIGITS = '23456789';                  // no 0/1
const SYMBOLS = '!@#$%^&*';
const ALL_CHARS = LOWER + UPPER + DIGITS + SYMBOLS;

const pick = (charset) => charset[crypto.randomInt(charset.length)];

/**
 * Generates a random, human-typeable-but-strong password.
 * Guarantees at least one lowercase, one uppercase, one digit, one symbol.
 *
 * @param {number} length - total password length (default 12, min 8)
 * @returns {string} plaintext password (show to super admin once, never store)
 */
function generatePassword(length = 12) {
  const safeLength = Math.max(8, length);

  const required = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: safeLength - required.length }, () => pick(ALL_CHARS));
  const combined = required.concat(rest);

  // Fisher-Yates shuffle so required chars aren't always at the front
  for (let i = combined.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join('');
}

/**
 * Slugifies a company name into an email-safe local part.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'company'
  );
}

/**
 * Generates a unique company login email based on the company name.
 *
 * Optimization vs. a naive loop: instead of awaiting one SELECT per attempt
 * (up to N sequential DB round trips), this builds all candidate emails
 * up front and checks them in a single batched query, then picks the first
 * one not already taken. Falls back to a timestamp+random suffix in the
 * astronomically unlikely case every batched candidate collides.
 *
 * e.g. "Acme Corp" -> "acme-corp@yourplatform.com", or
 *      "acme-corp-a1b2@yourplatform.com" if the first is taken.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} client - db client/pool (use the transaction client if called inside one)
 * @param {string} companyName
 * @param {string} domain - the platform's login domain, e.g. 'login.yourplatform.com'
 * @param {number} maxAttempts - how many candidates to generate before falling back (default 10)
 * @returns {Promise<string>}
 */
async function generateUniqueCompanyEmail(client, companyName, domain, maxAttempts = 10) {
  const baseSlug = slugify(companyName);

  // Build a de-duplicated batch of candidates: base slug + N-1 random-suffixed variants.
  const candidateSet = new Set([`${baseSlug}@${domain}`]);
  while (candidateSet.size < maxAttempts) {
    const suffix = crypto.randomBytes(2).toString('hex'); // 4 hex chars
    candidateSet.add(`${baseSlug}-${suffix}@${domain}`);
  }
  const candidates = Array.from(candidateSet);

  // Single round trip to find which candidates are already taken.
  const { rows } = await client.query('SELECT email FROM users WHERE email = ANY($1::text[])', [
    candidates
  ]);
  const taken = new Set(rows.map((r) => r.email));

  const free = candidates.find((c) => !taken.has(c));
  if (free) return free;

  // Extremely unlikely fallback: every batched candidate was taken.
  const suffix = `${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  return `${baseSlug}-${suffix}@${domain}`;
}

module.exports = { generatePassword, generateUniqueCompanyEmail, slugify };