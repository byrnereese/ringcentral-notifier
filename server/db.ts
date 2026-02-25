import Database from 'better-sqlite3';

const db = new Database('database.sqlite');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    ringcentral_id TEXT UNIQUE,
    name TEXT,
    email TEXT,
    access_token TEXT,
    refresh_token TEXT
  );

  CREATE TABLE IF NOT EXISTS notifiers (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    glip_webhook_url TEXT,
    sample_payload TEXT,
    adaptive_card_template TEXT,
    notification_url TEXT,
    team_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    notifier_id TEXT,
    status TEXT,
    inbound_request TEXT,
    generated_card TEXT,
    outbound_request TEXT,
    outbound_response TEXT,
    is_test BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(notifier_id) REFERENCES notifiers(id)
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    is_personal BOOLEAN DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

try {
  db.exec("ALTER TABLE logs ADD COLUMN is_test BOOLEAN DEFAULT 0;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE logs ADD COLUMN outbound_request TEXT;");
} catch (e) {
  // Column might already exist
}

try {
  db.exec("ALTER TABLE notifiers ADD COLUMN team_name TEXT;");
} catch (e) {
  // Column might already exist
}

try {
  // Check if connectors table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connectors'").get();
  if (tableExists) {
    db.exec("ALTER TABLE connectors RENAME TO notifiers;");
  }
} catch (e) {
  // Table might already be renamed
}

try {
  // Check if logs table has connector_id column
  const columnExists = db.prepare("PRAGMA table_info(logs)").all().find((c: any) => c.name === 'connector_id');
  if (columnExists) {
    db.exec("ALTER TABLE logs RENAME COLUMN connector_id TO notifier_id;");
  }
} catch (e) {
  // Column might already be renamed
}

export default db;
