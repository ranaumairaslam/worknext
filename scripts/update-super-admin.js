require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../src/config/db');

const NEW_EMAIL = 'ranaumair455@gmail.com';
const OLD_EMAIL = 'superadmin@example.com';
const NEW_PASSWORD =
  process.env.NEW_SUPER_ADMIN_PASSWORD ||
  `${crypto.randomBytes(9).toString('base64url')}Aa1!`;

async function main() {
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const oldResult = await client.query(
      `SELECT id, email, role, status
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [OLD_EMAIL]
    );

    const newResult = await client.query(
      `SELECT id, email, role, status
       FROM users
       WHERE LOWER(email) = LOWER($1)`,
      [NEW_EMAIL]
    );

    let newUserId = null;

    if (newResult.rows[0]) {
      await client.query(
        `UPDATE users
         SET
           name = COALESCE(NULLIF(name, ''), 'Super Admin'),
           password = $1,
           role = 'super_admin',
           status = 'active',
           token = NULL,
           updated_at = NOW()
         WHERE id = $2`,
        [hash, newResult.rows[0].id]
      );
      newUserId = newResult.rows[0].id;
      console.log('Updated existing user:', newUserId);
    } else if (oldResult.rows[0]) {
      await client.query(
        `UPDATE users
         SET
           email = $1,
           name = COALESCE(NULLIF(name, ''), 'Super Admin'),
           password = $2,
           role = 'super_admin',
           status = 'active',
           token = NULL,
           updated_at = NOW()
         WHERE id = $3`,
        [NEW_EMAIL, hash, oldResult.rows[0].id]
      );
      newUserId = oldResult.rows[0].id;
      console.log('Renamed old super-admin user:', newUserId);
    } else {
      const inserted = await client.query(
        `INSERT INTO users (name, email, password, role, status, created_at)
         VALUES ('Super Admin', $1, $2, 'super_admin', 'active', NOW())
         RETURNING id`,
        [NEW_EMAIL, hash]
      );
      newUserId = inserted.rows[0].id;
      console.log('Created new super-admin user:', newUserId);
    }

    // Disable any leftover old email account (if it still exists separately)
    await client.query(
      `UPDATE users
       SET status = 'inactive', token = NULL, updated_at = NOW()
       WHERE LOWER(email) = LOWER($1)
         AND id <> $2`,
      [OLD_EMAIL, newUserId]
    );

    // Disable any other super_admin accounts except the new one
    await client.query(
      `UPDATE users
       SET status = 'inactive', token = NULL, updated_at = NOW()
       WHERE LOWER(REPLACE(COALESCE(role, ''), '-', '_')) IN ('super_admin', 'superadmin')
         AND id <> $1`,
      [newUserId]
    );

    await client.query('COMMIT');

    const check = await pool.query(
      `SELECT id, email, role, status
       FROM users
       WHERE LOWER(email) IN (LOWER($1), LOWER($2))
          OR id = $3
       ORDER BY id`,
      [NEW_EMAIL, OLD_EMAIL, newUserId]
    );

    console.log('Users after update:', JSON.stringify(check.rows, null, 2));
    console.log('NEW_EMAIL=' + NEW_EMAIL);
    console.log('NEW_PASSWORD=' + NEW_PASSWORD);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Failed to update super-admin:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
