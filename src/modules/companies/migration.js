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

    // Upgrade older teams tables missing newer columns
    await pool.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS description TEXT;`);
    await pool.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);

    // Make sure users table has team_id column (for step 3: assigning leader/members)
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
    `);

    // Phone for OTP / password-reset identity
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);`);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    `);
    await pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_public_id TEXT;
    `);

    // Password reset OTPs (email or phone)
    console.log('Ensuring password_reset_otps table exists...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_otps (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        channel VARCHAR(10) NOT NULL CHECK (channel IN ('email', 'phone')),
        destination VARCHAR(255) NOT NULL,
        otp_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user ON password_reset_otps(user_id);`
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_password_reset_otps_destination ON password_reset_otps(destination);`
    );

    // CLIENTS table (Step 8: Add Client)
    console.log("Ensuring clients table exists...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        company_name VARCHAR(255),
        address TEXT,
        industry VARCHAR(255),
        account_owner_name VARCHAR(255),
        company_size VARCHAR(100),
        revenue NUMERIC(14,2),
        location VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Upgrade older clients tables that were created without the newer columns
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry VARCHAR(255);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS account_owner_name VARCHAR(255);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_size VARCHAR(100);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS revenue NUMERIC(14,2);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS location VARCHAR(255);`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS notes TEXT;`);
    await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);

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
        project_leader_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'pending',
        priority VARCHAR(50) DEFAULT 'medium',
        start_date DATE,
        due_date DATE,
        end_date DATE,
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
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        revenue_date DATE,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS source VARCHAR(255);`);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS revenue_date DATE;`);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';`);
    await pool.query(`ALTER TABLE revenues ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_revenues_company ON revenues(company_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_revenues_project ON revenues(project_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_revenues_client ON revenues(client_id);`);

    // MEETINGS table (scheduled meetings)
    console.log('Ensuring meetings tables exist...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS meetings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        to_whom VARCHAR(255),
        invitee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        scheduled_date DATE,
        scheduled_time TIME,
        scheduled_at TIMESTAMP WITH TIME ZONE,
        mode VARCHAR(50) DEFAULT 'online',
        meeting_link TEXT,
        status VARCHAR(50) DEFAULT 'scheduled',
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS to_whom VARCHAR(255);`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS invitee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;`);
    // Older meetings tables required client_id; company scheduling may not have a client
    await pool.query(`ALTER TABLE meetings ALTER COLUMN client_id DROP NOT NULL;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_date DATE;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_time TIME;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMP WITH TIME ZONE;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mode VARCHAR(50) DEFAULT 'online';`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS meeting_link TEXT;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'scheduled';`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS description TEXT;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
    await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_teams (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        PRIMARY KEY (meeting_id, team_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS meeting_members (
        meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        PRIMARY KEY (meeting_id, user_id)
      );
    `);

    // In-app notifications (CareClinic-style)
    console.log('Ensuring notifications table exists...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        recipient_email VARCHAR(255),
        type VARCHAR(100) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        link TEXT,
        read BOOLEAN NOT NULL DEFAULT FALSE,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;`);
    await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_email ON notifications(recipient_email);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read);`);

    // Per-user notification preference switches
    console.log('Ensuring notification_settings table exists...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notification_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        email_alerts BOOLEAN NOT NULL DEFAULT TRUE,
        push_notifications BOOLEAN NOT NULL DEFAULT TRUE,
        task_updates BOOLEAN NOT NULL DEFAULT TRUE,
        weekly_summary BOOLEAN NOT NULL DEFAULT TRUE,
        new_client_added BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
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
