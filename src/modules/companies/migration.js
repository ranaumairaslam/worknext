require('dotenv').config();
const pool = require('../../config/db');
const bcrypt = require('bcryptjs');

async function migrate() {
  console.log('Starting migration and seeding...');
  try {
    // 0. Ensure revenues and tasks tables exist
    console.log('Ensuring revenues and tasks tables exist...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS revenues (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        amount NUMERIC(14,2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'todo',
        priority VARCHAR(50) DEFAULT 'medium',
        due_date TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log('Tables created or already existed.');
    // 1. Check if superadmin already exists
    const superAdminEmail = 'superadmin@example.com';
    const checkRes = await pool.query('SELECT id FROM users WHERE email = $1', [superAdminEmail]);
    
    if (checkRes.rows.length > 0) {
      console.log('Super Admin user already exists. Skipping seeding.');
      return;
    }

    // 2. Hash password
    const passwordHash = await bcrypt.hash('superadmin123', 10);

    // 3. Insert Super Admin user
    const insertQuery = `
      INSERT INTO users (name, email, password, role, status, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING id, name, email, role;
    `;
    const values = ['Super Admin', superAdminEmail, passwordHash, 'super_admin', 'active'];
    const result = await pool.query(insertQuery, values);
    
    console.log('Super Admin seeded successfully:', result.rows[0]);
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log('Migration completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration failed with error:', err);
    process.exit(1);
  });
