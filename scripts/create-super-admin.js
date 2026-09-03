require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

const EMAIL = 'raonimra337@gmail.com';
const PASSWORD =
  process.env.NEW_SUPER_ADMIN_PASSWORD ||
  `${crypto.randomBytes(9).toString('base64url')}Aa1!`;

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 10);

  try {
    const existing = await pool.query(
      `SELECT id, email, role, status
       FROM users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [EMAIL]
    );

    let userId;

    if (existing.rows[0]) {
      const updated = await pool.query(
        `UPDATE users
         SET
           name = COALESCE(NULLIF(name, ''), 'Super Admin'),
           password = $1,
           role = 'super_admin',
           status = 'active',
           token = NULL,
           updated_at = NOW()
         WHERE id = $2
         RETURNING id, email, role, status`,
        [hash, existing.rows[0].id]
      );
      userId = updated.rows[0].id;
      console.log('Updated existing user to active super_admin');
      console.log('USER', JSON.stringify(updated.rows[0]));
    } else {
      const inserted = await pool.query(
        `INSERT INTO users (name, email, password, role, status, created_at)
         VALUES ('Super Admin', $1, $2, 'super_admin', 'active', NOW())
         RETURNING id, email, role, status`,
        [EMAIL, hash]
      );
      userId = inserted.rows[0].id;
      console.log('Created new super_admin');
      console.log('USER', JSON.stringify(inserted.rows[0]));
    }

    console.log('EMAIL=' + EMAIL);
    console.log('PASSWORD=' + PASSWORD);
    console.log('USER_ID=' + userId);
  } catch (error) {
    console.error('Failed:', error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
