require("dotenv").config();
const pool = require("../../config/db");

// =======================================================
// Migration script matching the workflow:
// Login -> Create Team -> Assign Team Leader ->
// Create Project -> Assign Project -> Monitor Progress ->
// Generate Reports -> Add Client
// =======================================================
async function migrate() {
  console.log("Starting workflow schema migration...");
  try {
    // TEAMS table (Step 2 & 3: Create Team, Assign Team Leader)
    console.log("Ensuring teams table exists...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Make sure users table has team_id column (for step 3: assigning leader/members)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
    `);

    // Make sure companies table can store payments and revenue status
    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS revenue NUMERIC(14,2) DEFAULT 0;
    `);
    await pool.query(`
      ALTER TABLE companies ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'Pending';
    `);

    // CLIENTS table (Step 8: Add Client)
    console.log("Ensuring clients table exists...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        company_name VARCHAR(255),
        address TEXT,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // PROJECTS table (Step 4 & 5: Create Project, Assign Project)
    console.log("Ensuring projects table exists...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'pending',
        start_date DATE,
        due_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Existing installations can have an older projects table. Add the
    // workflow columns before creating indexes or using dashboard queries.
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS project_leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS due_date DATE;`,
    );
    await pool.query(
      `ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;`,
    );

    // TASKS table (used for progress monitoring in step 6)
    console.log("Ensuring tasks table exists...");
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

    // REVENUES table (used in reports)
    console.log("Ensuring revenues table exists...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS revenues (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        amount NUMERIC(14,2) NOT NULL,
        source VARCHAR(255),
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Helpful indexes for the workflow's most common lookups
    console.log("Creating indexes...");
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_teams_company ON teams(company_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);`,
    );

    console.log("Workflow schema migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
}

migrate()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Migration failed with error:", err);
    process.exit(1);
  });
