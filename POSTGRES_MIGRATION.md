# Migrating to PostgreSQL on Heroku

This guide explains how to migrate your application from SQLite (`better-sqlite3`) to PostgreSQL (`pg`) for production deployment on Heroku.

## Why Migrate?

SQLite stores data in a local file (`database.sqlite`). On Heroku, the filesystem is ephemeral, meaning this file is deleted every time the application restarts (at least once every 24 hours). PostgreSQL stores data in a persistent database service, ensuring your data is safe.

## Step 1: Provision Heroku Postgres

1.  **Add the Postgres Add-on**:
    ```bash
    heroku addons:create heroku-postgresql:mini
    ```
    This will automatically set the `DATABASE_URL` environment variable in your Heroku app.

## Step 2: Install Dependencies

1.  **Install the PostgreSQL client**:
    ```bash
    npm install pg
    npm install --save-dev @types/pg
    ```
    *(Note: You can remove `better-sqlite3` later, but keep it for local development if you prefer)*

## Step 3: Refactor Database Connection (`server/db.ts`)

You need to replace the SQLite connection with a PostgreSQL connection pool.

**Create a new file `server/db-pg.ts` (or update `server/db.ts`):**

```typescript
import { Pool } from 'pg';

// Use DATABASE_URL from environment (Heroku provides this)
// For local dev, you can set DATABASE_URL in your .env file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Helper to initialize schema
export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(`
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      );
      
      -- ... (Add other tables: logs, teams, webhook_events) ...
      -- Note: Use TIMESTAMP instead of DATETIME
      -- Note: Use BOOLEAN (Postgres supports native boolean)
    `);
    console.log('Database initialized');
  } finally {
    client.release();
  }
}

// Export the pool for queries
export default pool;
```

## Step 4: Refactor Server Logic (`server.ts`)

This is the most significant change. `better-sqlite3` is **synchronous**, but `pg` is **asynchronous**. You must update all database calls in `server.ts` to use `async/await`.

### Key Changes:

1.  **Imports**:
    ```typescript
    // Remove
    import db from './server/db';
    // Add
    import pool, { initDb } from './server/db-pg';
    ```

2.  **Initialization**:
    Call `initDb()` when the server starts.

3.  **Query Syntax**:
    *   **Placeholders**: Change `?` to `$1`, `$2`, etc.
    *   **Methods**: Change `db.prepare().get()`/`.run()`/`.all()` to `await pool.query()`.

### Examples:

**Select One (Get User):**
*   *SQLite*:
    ```typescript
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    ```
*   *Postgres*:
    ```typescript
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    const user = res.rows[0];
    ```

**Select Many (List Notifiers):**
*   *SQLite*:
    ```typescript
    const rows = db.prepare('SELECT * FROM notifiers WHERE user_id = ?').all(userId);
    ```
*   *Postgres*:
    ```typescript
    const res = await pool.query('SELECT * FROM notifiers WHERE user_id = $1', [userId]);
    const rows = res.rows;
    ```

**Insert/Update (Run):**
*   *SQLite*:
    ```typescript
    db.prepare('INSERT INTO users ... VALUES (?, ?)').run(id, name);
    ```
*   *Postgres*:
    ```typescript
    await pool.query('INSERT INTO users ... VALUES ($1, $2)', [id, name]);
    ```

**Transactions:**
*   *SQLite*: `db.transaction(...)`
*   *Postgres*: You must manually manage `BEGIN`, `COMMIT`, and `ROLLBACK` using a client from the pool.
    ```typescript
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // ... queries using client.query() ...
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    ```

## Step 5: Update `package.json`

Ensure `pg` is in `dependencies` and the `start` script runs the updated server file.

## Step 6: Deploy

1.  Commit your changes.
2.  Push to Heroku: `git push heroku main`.
3.  Check logs: `heroku logs --tail`.
