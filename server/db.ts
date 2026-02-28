import Database from 'better-sqlite3';
import { Pool, PoolClient } from 'pg';

export interface IDatabase {
  query(sql: string, params?: any[]): Promise<any[]>;
  get(sql: string, params?: any[]): Promise<any>;
  run(sql: string, params?: any[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
  transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T>;
}

class SQLiteAdapter implements IDatabase {
  private db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.init();
  }

  private init() {
    this.db.exec(`
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
        filter_variable TEXT,
        filter_operator TEXT,
        filter_value TEXT,
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

      CREATE TABLE IF NOT EXISTS webhook_events (
        id TEXT PRIMARY KEY,
        public_id TEXT,
        payload TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_webhook_events_public_id ON webhook_events(public_id);
    `);

    // Migrations
    try { this.db.exec("ALTER TABLE logs ADD COLUMN is_test BOOLEAN DEFAULT 0;"); } catch (e) {}
    try { this.db.exec("ALTER TABLE logs ADD COLUMN outbound_request TEXT;"); } catch (e) {}
    try { this.db.exec("ALTER TABLE notifiers ADD COLUMN team_name TEXT;"); } catch (e) {}
    try { this.db.exec("ALTER TABLE notifiers ADD COLUMN filter_variable TEXT;"); } catch (e) {}
    try { this.db.exec("ALTER TABLE notifiers ADD COLUMN filter_operator TEXT;"); } catch (e) {}
    try { this.db.exec("ALTER TABLE notifiers ADD COLUMN filter_value TEXT;"); } catch (e) {}
    
    try {
      const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connectors'").get();
      if (tableExists) {
        this.db.exec("ALTER TABLE connectors RENAME TO notifiers;");
      }
    } catch (e) {}

    try {
      const columnExists = this.db.prepare("PRAGMA table_info(logs)").all().find((c: any) => c.name === 'connector_id');
      if (columnExists) {
        this.db.exec("ALTER TABLE logs RENAME COLUMN connector_id TO notifier_id;");
      }
    } catch (e) {}
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    return this.db.prepare(sql).all(params);
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    return this.db.prepare(sql).get(params);
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
    const info = this.db.prepare(sql).run(params);
    return { changes: info.changes };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    const tx = this.db.transaction(() => {
      // Since better-sqlite3 transactions are synchronous, we need to handle the async callback carefully.
      // However, better-sqlite3 transactions expect a synchronous function.
      // This is a mismatch. We can't easily wrap async logic in a better-sqlite3 transaction.
      // For this adapter, we might have to accept that the callback must be synchronous if we use .transaction(),
      // OR we just run the callback without a real DB transaction for SQLite if we want async support,
      // OR we don't use the .transaction() helper of better-sqlite3 and just run BEGIN/COMMIT.
      // Given the constraints, manual BEGIN/COMMIT is safer for async compatibility.
      throw new Error("Use manual BEGIN/COMMIT for async transactions in this adapter wrapper");
    });
    
    // Manual implementation for async compatibility
    this.db.prepare('BEGIN').run();
    try {
      const result = await callback(this);
      this.db.prepare('COMMIT').run();
      return result;
    } catch (error) {
      this.db.prepare('ROLLBACK').run();
      throw error;
    }
  }
}

class PostgresAdapter implements IDatabase {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false } // Required for Heroku
    });
    this.init();
  }

  private async init() {
    const client = await this.pool.connect();
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
          filter_variable TEXT,
          filter_operator TEXT,
          filter_value TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
          is_test BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(notifier_id) REFERENCES notifiers(id)
        );

        CREATE TABLE IF NOT EXISTS teams (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          name TEXT,
          is_personal BOOLEAN DEFAULT FALSE,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS webhook_events (
          id TEXT PRIMARY KEY,
          public_id TEXT,
          payload TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE INDEX IF NOT EXISTS idx_webhook_events_public_id ON webhook_events(public_id);
      `);
      
      // Migrations - checking columns in PG is more complex, skipping for now as this is a fresh init for PG usually.
      // If needed, we'd query information_schema.
    } catch (err) {
      console.error('Failed to initialize Postgres DB:', err);
    } finally {
      client.release();
    }
  }

  // Helper to convert ? to $1, $2, etc.
  private convertSql(sql: string): string {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const res = await this.pool.query(this.convertSql(sql), params);
    return res.rows;
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    const res = await this.pool.query(this.convertSql(sql), params);
    return res.rows[0];
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
    const res = await this.pool.query(this.convertSql(sql), params);
    return { changes: res.rowCount || 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const txAdapter = new PostgresTxAdapter(client);
    
    try {
      await client.query('BEGIN');
      const result = await callback(txAdapter);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

class PostgresTxAdapter implements IDatabase {
  constructor(private client: PoolClient) {}

  private convertSql(sql: string): string {
    let i = 1;
    return sql.replace(/\?/g, () => `$${i++}`);
  }

  async query(sql: string, params: any[] = []): Promise<any[]> {
    const res = await this.client.query(this.convertSql(sql), params);
    return res.rows;
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    const res = await this.client.query(this.convertSql(sql), params);
    return res.rows[0];
  }

  async run(sql: string, params: any[] = []): Promise<{ changes: number }> {
    const res = await this.client.query(this.convertSql(sql), params);
    return { changes: res.rowCount || 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(callback: (tx: IDatabase) => Promise<T>): Promise<T> {
    // Nested transactions using SAVEPOINT if needed, but for now simple nested call
    return callback(this);
  }
}

const db = process.env.DATABASE_URL 
  ? new PostgresAdapter(process.env.DATABASE_URL)
  : new SQLiteAdapter('database.sqlite');

export default db;
