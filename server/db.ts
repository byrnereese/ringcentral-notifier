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

  CREATE TABLE IF NOT EXISTS connectors (
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
    connector_id TEXT,
    status TEXT,
    inbound_request TEXT,
    generated_card TEXT,
    outbound_request TEXT,
    outbound_response TEXT,
    is_test BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(connector_id) REFERENCES connectors(id)
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
  db.exec("ALTER TABLE connectors ADD COLUMN team_name TEXT;");
} catch (e) {
  // Column might already exist
}

export default db;
