/**
 * Adapter Factory & In-Memory Implementation
 *
 * Creates DatabaseAdapter and SwarmMailAdapter instances with dependency injection support.
 * Includes in-memory implementations for 10x faster testing without shared state.
 *
 * Usage:
 * ```typescript
 * // Production: PGLite-backed adapter
 * const adapter = await createSwarmMailAdapter({ projectPath: "/path/to/project" });
 *
 * // Testing: In-memory adapter (fast, isolated)
 * const adapter = await createSwarmMailAdapter({ inMemory: true });
 *
 * // Custom database adapter
 * const dbAdapter = new MyCustomDatabaseAdapter();
 * const adapter = await createSwarmMailAdapter({ dbOverride: dbAdapter });
 * ```
 */

import { PGlite } from "@electric-sql/pglite";
import type { DatabaseAdapter, QueryResult } from "./types/database";
import type { SwarmMailAdapter, AgentInfo, SwarmMessage, FileReservation } from "./types/adapter";
import { getDatabase } from "./streams/index";
import type { AgentEvent } from "./streams/events";
import { minimatch } from "minimatch";

// ============================================================================
// PGLite Database Adapter
// ============================================================================

/**
 * PGLite-backed database adapter
 *
 * Wraps PGLite instance with DatabaseAdapter interface.
 * Used for production deployment with persistent storage.
 */
export class PGliteDatabaseAdapter implements DatabaseAdapter {
  constructor(private db: PGlite) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    const result = await this.db.query<T>(sql, params);
    return {
      rows: result.rows,
      affectedRows: result.affectedRows,
      fields: result.fields,
    };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

// ============================================================================
// In-Memory Database Adapter
// ============================================================================

/**
 * In-memory database adapter for testing
 *
 * Simulates SQL database behavior without persistence.
 * 10x faster than PGLite, no shared state between tests.
 *
 * Limitations:
 * - No SQL parsing (uses simple table-based storage)
 * - Limited query support (no JOINs, subqueries, etc.)
 * - No transaction isolation (single-threaded only)
 */
export class InMemoryDatabaseAdapter implements DatabaseAdapter {
  private tables = new Map<string, Array<Record<string, any>>>();
  private sequences = new Map<string, number>();
  private transactionSnapshot: Map<string, Array<Record<string, any>>> | null = null;

  async query<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    const normalizedSql = sql.trim().toUpperCase();

    // Handle SELECT queries
    if (normalizedSql.startsWith("SELECT")) {
      return this.handleSelect<T>(sql, params);
    }

    // Handle INSERT queries
    if (normalizedSql.startsWith("INSERT")) {
      return this.handleInsert<T>(sql, params);
    }

    // Handle UPDATE queries
    if (normalizedSql.startsWith("UPDATE")) {
      return this.handleUpdate<T>(sql, params);
    }

    // Handle DELETE queries
    if (normalizedSql.startsWith("DELETE")) {
      return this.handleDelete<T>(sql, params);
    }

    return { rows: [] as T[] };
  }

  async exec(sql: string): Promise<void> {
    const normalizedSql = sql.trim().toUpperCase();

    // Handle transaction control
    if (normalizedSql === "BEGIN") {
      // Take snapshot of current state
      this.transactionSnapshot = new Map();
      for (const [table, rows] of this.tables) {
        this.transactionSnapshot.set(table, JSON.parse(JSON.stringify(rows)));
      }
      return;
    }

    if (normalizedSql === "COMMIT") {
      this.transactionSnapshot = null;
      return;
    }

    if (normalizedSql === "ROLLBACK") {
      // Restore snapshot
      if (this.transactionSnapshot) {
        this.tables = this.transactionSnapshot;
      }
      this.transactionSnapshot = null;
      return;
    }

    // Handle CREATE TABLE
    if (normalizedSql.includes("CREATE TABLE")) {
      const match = sql.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
      if (match) {
        const tableName = match[1].toLowerCase();
        if (!this.tables.has(tableName)) {
          this.tables.set(tableName, []);
        }
      }
      return;
    }

    // Handle CREATE INDEX (no-op for in-memory)
    if (normalizedSql.includes("CREATE INDEX")) {
      return;
    }

    // Handle INSERT
    if (normalizedSql.startsWith("INSERT")) {
      await this.query(sql);
      return;
    }

    // Handle DELETE
    if (normalizedSql.startsWith("DELETE")) {
      await this.query(sql);
      return;
    }
  }

  async close(): Promise<void> {
    this.tables.clear();
    this.sequences.clear();
  }

  // -------------------------------------------------------------------------
  // Query Handlers
  // -------------------------------------------------------------------------

  private handleSelect<T>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<T>> {
    const match = sql.match(/FROM\s+(\w+)/i);
    if (!match) {
      return Promise.resolve({ rows: [] as T[] });
    }

    const tableName = match[1].toLowerCase();
    let rows = this.tables.get(tableName) || [];

    // Handle WHERE clause (simple equality checks only)
    const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER BY|LIMIT|$)/i);
    if (whereMatch) {
      const condition = whereMatch[1].trim();
      rows = rows.filter((row) => this.evaluateCondition(row, condition, params));
    }

    // Handle ORDER BY
    const orderMatch = sql.match(/ORDER BY\s+(\w+)(?:\s+(ASC|DESC))?/i);
    if (orderMatch) {
      const field = orderMatch[1];
      const direction = orderMatch[2]?.toUpperCase() === "DESC" ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        if (a[field] < b[field]) return -direction;
        if (a[field] > b[field]) return direction;
        return 0;
      });
    }

    // Handle OFFSET (must be applied before LIMIT)
    const offsetMatch = sql.match(/OFFSET\s+(\d+|\$\d+)/i);
    if (offsetMatch) {
      const offsetValue = offsetMatch[1];
      const offset =
        offsetValue.startsWith("$")
          ? Number(params[Number.parseInt(offsetValue.slice(1)) - 1])
          : Number.parseInt(offsetValue);
      rows = rows.slice(offset);
    }

    // Handle LIMIT
    const limitMatch = sql.match(/LIMIT\s+(\d+|\$\d+)/i);
    if (limitMatch) {
      const limitValue = limitMatch[1];
      const limit =
        limitValue.startsWith("$")
          ? Number(params[Number.parseInt(limitValue.slice(1)) - 1])
          : Number.parseInt(limitValue);
      rows = rows.slice(0, limit);
    }

    return Promise.resolve({ rows: rows as T[] });
  }

  private handleInsert<T>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<T>> {
    const match = sql.match(/INSERT INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
    if (!match) {
      return Promise.resolve({ rows: [] as T[] });
    }

    const tableName = match[1].toLowerCase();
    const columns = match[2].split(",").map((c) => c.trim());
    const values = match[3].split(",").map((v) => v.trim());

    if (!this.tables.has(tableName)) {
      this.tables.set(tableName, []);
    }

    const row: Record<string, any> = {};

    // Map values to columns
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const val = values[i];

      if (val.startsWith("$")) {
        // Parameter reference
        const paramIndex = Number.parseInt(val.slice(1)) - 1;
        row[col] = params[paramIndex];
      } else if (val === "CURRENT_TIMESTAMP") {
        row[col] = new Date().toISOString();
      } else {
        // Literal value
        row[col] = val.replace(/^'|'$/g, "");
      }
    }

    // Handle SERIAL columns (auto-increment)
    if (!row.id) {
      const seqKey = `${tableName}_id_seq`;
      const nextId = (this.sequences.get(seqKey) || 0) + 1;
      this.sequences.set(seqKey, nextId);
      row.id = nextId;
    }

    if (!row.sequence) {
      const seqKey = `${tableName}_sequence_seq`;
      const nextSeq = (this.sequences.get(seqKey) || 0) + 1;
      this.sequences.set(seqKey, nextSeq);
      row.sequence = nextSeq;
    }

    this.tables.get(tableName)!.push(row);

    // Handle RETURNING clause
    if (sql.toUpperCase().includes("RETURNING")) {
      const returningMatch = sql.match(/RETURNING\s+(.+)/i);
      if (returningMatch) {
        const returnCols = returningMatch[1].split(",").map((c) => c.trim());
        const result: Record<string, any> = {};
        for (const col of returnCols) {
          result[col] = row[col];
        }
        return Promise.resolve({ rows: [result as T], affectedRows: 1 });
      }
    }

    return Promise.resolve({ rows: [] as T[], affectedRows: 1 });
  }

  private handleUpdate<T>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<T>> {
    const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
    if (!match) {
      return Promise.resolve({ rows: [] as T[], affectedRows: 0 });
    }

    const tableName = match[1].toLowerCase();
    const setClause = match[2];
    const whereClause = match[3];

    const rows = this.tables.get(tableName) || [];
    let affectedRows = 0;

    for (const row of rows) {
      if (this.evaluateCondition(row, whereClause, params)) {
        // Parse SET clause
        const assignments = setClause.split(",").map((a) => a.trim());
        for (const assignment of assignments) {
          const [col, val] = assignment.split("=").map((s) => s.trim());
          if (val.startsWith("$")) {
            const paramIndex = Number.parseInt(val.slice(1)) - 1;
            row[col] = params[paramIndex];
          } else {
            row[col] = val.replace(/^'|'$/g, "");
          }
        }
        affectedRows++;
      }
    }

    return Promise.resolve({ rows: [] as T[], affectedRows });
  }

  private handleDelete<T>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResult<T>> {
    const match = sql.match(/DELETE FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (!match) {
      return Promise.resolve({ rows: [] as T[], affectedRows: 0 });
    }

    const tableName = match[1].toLowerCase();
    const whereClause = match[2];

    const rows = this.tables.get(tableName) || [];

    if (!whereClause) {
      // Delete all rows
      const count = rows.length;
      this.tables.set(tableName, []);
      return Promise.resolve({ rows: [] as T[], affectedRows: count });
    }

    // Delete matching rows
    const newRows = rows.filter(
      (row) => !this.evaluateCondition(row, whereClause, params),
    );
    const affectedRows = rows.length - newRows.length;
    this.tables.set(tableName, newRows);

    return Promise.resolve({ rows: [] as T[], affectedRows });
  }

  // -------------------------------------------------------------------------
  // Condition Evaluation
  // -------------------------------------------------------------------------

  private evaluateCondition(
    row: Record<string, any>,
    condition: string,
    params: unknown[],
  ): boolean {
    // Handle AND conditions FIRST (before other checks)
    if (condition.includes(" AND ")) {
      const parts = condition.split(" AND ").map(p => p.trim());
      return parts.every((part) => this.evaluateCondition(row, part, params));
    }

    // Handle IS NULL / IS NOT NULL
    if (condition.includes("IS NULL")) {
      const col = condition.replace(/\s+IS NULL/i, "").trim();
      return row[col] == null;
    }
    if (condition.includes("IS NOT NULL")) {
      const col = condition.replace(/\s+IS NOT NULL/i, "").trim();
      return row[col] != null;
    }

    // Handle simple equality: col = value or col = $n
    const eqMatch = condition.match(/(\w+)\s*=\s*(.+)/);
    if (eqMatch) {
      const col = eqMatch[1].trim();
      let value = eqMatch[2].trim();

      // Handle parameter references
      if (value.startsWith("$")) {
        const paramIndex = Number.parseInt(value.slice(1)) - 1;
        value = params[paramIndex] as string;
      } else {
        // Remove quotes
        value = value.replace(/^'|'$/g, "");
      }

      return String(row[col]) === String(value);
    }

    return true;
  }
}

// ============================================================================
// Swarm Mail Adapter Factory
// ============================================================================

export interface SwarmMailAdapterOptions {
  /** Project path for PGLite storage */
  projectPath?: string;

  /** Use in-memory adapter (testing) */
  inMemory?: boolean;

  /** Override database adapter (DI) */
  dbOverride?: DatabaseAdapter;
}

// ============================================================================
// Adapter Cache (Zero-Config)
// ============================================================================

/**
 * Global adapter cache for zero-config usage
 *
 * Reuses adapters by project path to avoid creating multiple connections.
 */
const adapterCache = new Map<string, SwarmMailAdapter>();

/**
 * Get or create a cached adapter for a project
 *
 * @param projectPath - Project directory path
 * @returns Cached or new SwarmMailAdapter instance
 *
 * @example
 * ```typescript
 * const adapter = await getOrCreateAdapter("/path/to/project");
 * await adapter.registerAgent("my-project", "agent-1");
 * ```
 */
export async function getOrCreateAdapter(
  projectPath: string,
): Promise<SwarmMailAdapter> {
  if (!adapterCache.has(projectPath)) {
    const adapter = await createSwarmMailAdapter({ projectPath });
    adapterCache.set(projectPath, adapter);
  }
  return adapterCache.get(projectPath)!;
}

/**
 * Clear adapter cache (useful for testing)
 *
 * @param projectPath - Optional project path to clear specific adapter
 */
export async function clearAdapterCache(projectPath?: string): Promise<void> {
  if (projectPath) {
    const adapter = adapterCache.get(projectPath);
    if (adapter) {
      await adapter.close();
      adapterCache.delete(projectPath);
    }
  } else {
    // Close all adapters
    await Promise.all(
      Array.from(adapterCache.values()).map((adapter) => adapter.close()),
    );
    adapterCache.clear();
  }
}

/**
 * Create a Swarm Mail adapter
 *
 * @param options - Adapter configuration
 * @returns Swarm Mail adapter instance
 *
 * @example
 * ```typescript
 * // Production: PGLite-backed
 * const adapter = await createSwarmMailAdapter({
 *   projectPath: "/path/to/project"
 * });
 *
 * // Testing: In-memory
 * const adapter = await createSwarmMailAdapter({
 *   inMemory: true
 * });
 *
 * // Custom DB adapter
 * const adapter = await createSwarmMailAdapter({
 *   dbOverride: myCustomAdapter
 * });
 * ```
 */
export async function createSwarmMailAdapter(
  options: SwarmMailAdapterOptions = {},
): Promise<SwarmMailAdapter> {
  let dbAdapter: DatabaseAdapter;

  if (options.dbOverride) {
    // Use provided adapter
    dbAdapter = options.dbOverride;
  } else if (options.inMemory) {
    // Create in-memory adapter
    dbAdapter = new InMemoryDatabaseAdapter();
    // Initialize schema
    await initializeInMemorySchema(dbAdapter);
  } else {
    // Create PGLite adapter (default)
    const db = await getDatabase(options.projectPath);
    dbAdapter = new PGliteDatabaseAdapter(db);
  }

  // TODO: Implement full SwarmMailAdapter
  // For now, return a stub that delegates to existing functions
  return createSwarmMailAdapterImpl(dbAdapter, options.projectPath);
}

/**
 * Initialize in-memory database schema
 */
async function initializeInMemorySchema(db: DatabaseAdapter): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      project_key TEXT NOT NULL,
      timestamp BIGINT NOT NULL,
      sequence SERIAL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      name TEXT NOT NULL,
      program TEXT DEFAULT 'opencode',
      model TEXT DEFAULT 'unknown',
      task_description TEXT,
      registered_at BIGINT NOT NULL,
      last_active_at BIGINT NOT NULL,
      UNIQUE(project_key, name)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      from_agent TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      thread_id TEXT,
      importance TEXT DEFAULT 'normal',
      ack_required BOOLEAN DEFAULT FALSE,
      created_at BIGINT NOT NULL
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS message_recipients (
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      agent_name TEXT NOT NULL,
      read_at BIGINT,
      acked_at BIGINT,
      PRIMARY KEY(message_id, agent_name)
    )
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      project_key TEXT NOT NULL,
      agent_name TEXT NOT NULL,
      path_pattern TEXT NOT NULL,
      exclusive BOOLEAN DEFAULT TRUE,
      reason TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      released_at BIGINT
    )
  `);
}

/**
 * Create Swarm Mail adapter implementation
 *
 * Full implementation of SwarmMailAdapter interface.
 * Moved from store.ts and projections.ts for adapter-based architecture.
 */
function createSwarmMailAdapterImpl(
  db: DatabaseAdapter,
  _projectPath?: string,
): SwarmMailAdapter {


  // Helper: Parse timestamp from database row
  function parseTimestamp(timestamp: string | number): number {
    if (typeof timestamp === 'number') return timestamp;
    const ts = parseInt(timestamp, 10);
    if (Number.isNaN(ts)) {
      throw new Error(`[HiveMail] Invalid timestamp: ${timestamp}`);
    }
    return ts;
  }

  // Helper: Update materialized views based on event type
  async function updateMaterializedViews(
    event: AgentEvent & { id: number; sequence: number },
  ): Promise<void> {
    try {
      switch (event.type) {
        case "agent_registered":
          await db.query(
            `INSERT INTO agents (project_key, name, program, model, task_description, registered_at, last_active_at)
             VALUES ($1, $2, $3, $4, $5, $6, $6)
             ON CONFLICT (project_key, name) DO UPDATE SET
               program = EXCLUDED.program,
               model = EXCLUDED.model,
               task_description = EXCLUDED.task_description,
               last_active_at = EXCLUDED.last_active_at`,
            [
              event.project_key,
              event.agent_name,
              event.program || 'opencode',
              event.model || 'unknown',
              event.task_description || null,
              event.timestamp,
            ],
          );
          break;

        case "agent_active":
          await db.query(
            `UPDATE agents SET last_active_at = $1 WHERE project_key = $2 AND name = $3`,
            [event.timestamp, event.project_key, event.agent_name],
          );
          break;

        case "message_sent":
          // Insert message
          const result = await db.query<{ id: number }>(
            `INSERT INTO messages (project_key, from_agent, subject, body, thread_id, importance, ack_required, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              event.project_key,
              event.from_agent,
              event.subject,
              event.body,
              event.thread_id || null,
              event.importance || 'normal',
              event.ack_required || false,
              event.timestamp,
            ],
          );

          const msgRow = result.rows[0];
          if (!msgRow) {
            throw new Error("Failed to insert message - no row returned");
          }
          const messageId = msgRow.id;

          // Bulk insert recipients
          if (event.to_agents && event.to_agents.length > 0) {
            const values = event.to_agents.map((_: any, i: number) => `($1, $${i + 2})`).join(", ");
            const params = [messageId, ...event.to_agents];

            await db.query(
              `INSERT INTO message_recipients (message_id, agent_name)
               VALUES ${values}
               ON CONFLICT DO NOTHING`,
              params,
            );
          }
          break;

        case "message_read":
          await db.query(
            `UPDATE message_recipients SET read_at = $1 WHERE message_id = $2 AND agent_name = $3`,
            [event.timestamp, event.message_id, event.agent_name],
          );
          break;

        case "message_acked":
          await db.query(
            `UPDATE message_recipients SET acked_at = $1 WHERE message_id = $2 AND agent_name = $3`,
            [event.timestamp, event.message_id, event.agent_name],
          );
          break;

        case "file_reserved":
          // Delete existing active reservations first (idempotency)
          if (event.paths && event.paths.length > 0) {
            await db.query(
              `DELETE FROM reservations 
               WHERE project_key = $1 
                 AND agent_name = $2 
                 AND path_pattern = ANY($3)
                 AND released_at IS NULL`,
              [event.project_key, event.agent_name, event.paths],
            );

            // Bulk insert reservations
            const values = event.paths
              .map(
                (_: any, i: number) =>
                  `($1, $2, $${i + 3}, $${event.paths.length + 3}, $${event.paths.length + 4}, $${event.paths.length + 5}, $${event.paths.length + 6})`,
              )
              .join(", ");

            const params = [
              event.project_key,
              event.agent_name,
              ...event.paths,
              event.exclusive ?? true,
              event.reason || null,
              event.timestamp,
              event.expires_at,
            ];

            await db.query(
              `INSERT INTO reservations (project_key, agent_name, path_pattern, exclusive, reason, created_at, expires_at)
               VALUES ${values}`,
              params,
            );
          }
          break;

        case "file_released":
          if (event.reservation_ids && event.reservation_ids.length > 0) {
            await db.query(
              `UPDATE reservations SET released_at = $1 WHERE id = ANY($2)`,
              [event.timestamp, event.reservation_ids],
            );
          } else if (event.paths && event.paths.length > 0) {
            await db.query(
              `UPDATE reservations SET released_at = $1
               WHERE project_key = $2 AND agent_name = $3 AND path_pattern = ANY($4) AND released_at IS NULL`,
              [event.timestamp, event.project_key, event.agent_name, event.paths],
            );
          } else {
            await db.query(
              `UPDATE reservations SET released_at = $1
               WHERE project_key = $2 AND agent_name = $3 AND released_at IS NULL`,
              [event.timestamp, event.project_key, event.agent_name],
            );
          }
          break;

        case "task_started":
        case "task_progress":
        case "task_completed":
        case "task_blocked":
          // No materialized views for task events yet
          break;
      }
    } catch (error) {
      console.error("[HiveMail] Failed to update materialized views", {
        eventType: event.type,
        eventId: event.id,
        error,
      });
      throw error;
    }
  }

  return {
    // =========================================================================
    // Agent Operations
    // =========================================================================

    async registerAgent(projectKey, agentName, options = {}) {
      const event: AgentEvent = {
        type: "agent_registered",
        project_key: projectKey,
        agent_name: agentName,
        program: options.program || "opencode",
        model: options.model || "unknown",
        task_description: options.taskDescription,
        timestamp: Date.now(),
      };

      const result = await this.appendEvent(event);

      // Return agent info
      const agent = await this.getAgent(projectKey, agentName);
      if (!agent) {
        throw new Error("Failed to register agent");
      }
      return agent;
    },

    async getAgent(projectKey, agentName) {
      const result = await db.query<{
        id: number;
        name: string;
        program: string;
        model: string;
        task_description: string | null;
        registered_at: string | number;
        last_active_at: string | number;
      }>(
        `SELECT id, name, program, model, task_description, registered_at, last_active_at
         FROM agents
         WHERE project_key = $1 AND name = $2`,
        [projectKey, agentName],
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        project_key: projectKey,
        name: row.name,
        program: row.program,
        model: row.model,
        task_description: row.task_description ?? undefined,
        registered_at: parseTimestamp(row.registered_at),
        last_active_at: parseTimestamp(row.last_active_at),
      };
    },

    async listAgents(projectKey) {
      const result = await db.query<{
        id: number;
        name: string;
        program: string;
        model: string;
        task_description: string | null;
        registered_at: string | number;
        last_active_at: string | number;
      }>(
        `SELECT id, name, program, model, task_description, registered_at, last_active_at
         FROM agents
         WHERE project_key = $1
         ORDER BY registered_at ASC`,
        [projectKey],
      );

      return result.rows.map((row) => ({
        id: row.id,
        project_key: projectKey,
        name: row.name,
        program: row.program,
        model: row.model,
        task_description: row.task_description ?? undefined,
        registered_at: parseTimestamp(row.registered_at),
        last_active_at: parseTimestamp(row.last_active_at),
      }));
    },

    // =========================================================================
    // Message Operations
    // =========================================================================

    async sendMessage(projectKey, fromAgent, toAgents, subject, body, options = {}) {
      const event: AgentEvent = {
        type: "message_sent",
        project_key: projectKey,
        from_agent: fromAgent,
        to_agents: toAgents,
        subject,
        body,
        thread_id: options.threadId,
        importance: options.importance || "normal",
        ack_required: options.ackRequired || false,
        timestamp: Date.now(),
      };

      await this.appendEvent(event);

      // Query to get the message ID we just created
      const result = await db.query<{ id: number }>(
        `SELECT id FROM messages 
         WHERE project_key = $1 AND from_agent = $2 AND subject = $3 
         ORDER BY created_at DESC LIMIT 1`,
        [projectKey, fromAgent, subject],
      );

      const messageId = result.rows[0]?.id || 0;

      return {
        messageId,
        threadId: options.threadId,
        recipientCount: toAgents.length,
      };
    },

    async getInbox(projectKey, agentName, options = {}) {
      const {
        limit = 50,
        urgentOnly = false,
        unreadOnly = false,
        includeBodies = true,
      } = options;

      const conditions = ["m.project_key = $1", "mr.agent_name = $2"];
      const params: (string | number)[] = [projectKey, agentName];
      let paramIndex = 3;

      if (urgentOnly) {
        conditions.push(`m.importance = 'urgent'`);
      }

      if (unreadOnly) {
        conditions.push(`mr.read_at IS NULL`);
      }

      const bodySelect = includeBodies ? ", m.body" : "";

      const query = `
        SELECT m.id, m.from_agent, m.subject${bodySelect}, m.thread_id, 
               m.importance, m.ack_required, m.created_at,
               mr.read_at, mr.acked_at
        FROM messages m
        JOIN message_recipients mr ON m.id = mr.message_id
        WHERE ${conditions.join(" AND ")}
        ORDER BY m.created_at DESC
        LIMIT $${paramIndex}
      `;
      params.push(limit);

      const result = await db.query<{
        id: number;
        from_agent: string;
        subject: string;
        body?: string;
        thread_id: string | null;
        importance: string;
        ack_required: boolean;
        created_at: string | number;
        read_at?: string | number | null;
        acked_at?: string | number | null;
      }>(query, params);

      return result.rows.map((row) => ({
        id: row.id,
        from_agent: row.from_agent,
        subject: row.subject,
        body: row.body ?? "",
        thread_id: row.thread_id || undefined,
        importance: row.importance as "low" | "normal" | "high" | "urgent",
        ack_required: row.ack_required,
        created_at: parseTimestamp(row.created_at),
      }));
    },

    async getMessage(projectKey, messageId) {
      const result = await db.query<{
        id: number;
        from_agent: string;
        subject: string;
        body: string;
        thread_id: string | null;
        importance: string;
        ack_required: boolean;
        created_at: string | number;
      }>(
        `SELECT id, from_agent, subject, body, thread_id, importance, ack_required, created_at
         FROM messages
         WHERE project_key = $1 AND id = $2`,
        [projectKey, messageId],
      );

      const row = result.rows[0];
      if (!row) return null;

      return {
        id: row.id,
        from_agent: row.from_agent,
        subject: row.subject,
        body: row.body,
        thread_id: row.thread_id || undefined,
        importance: row.importance as "low" | "normal" | "high" | "urgent",
        ack_required: row.ack_required,
        created_at: parseTimestamp(row.created_at),
      };
    },

    async markMessageRead(projectKey, messageId, agentName) {
      const event: AgentEvent = {
        type: "message_read",
        project_key: projectKey,
        message_id: messageId,
        agent_name: agentName,
        timestamp: Date.now(),
      };

      await this.appendEvent(event);
      return { success: true };
    },

    async acknowledgeMessage(projectKey, messageId, agentName) {
      const timestamp = Date.now();
      const event: AgentEvent = {
        type: "message_acked",
        project_key: projectKey,
        message_id: messageId,
        agent_name: agentName,
        timestamp,
      };

      await this.appendEvent(event);
      return { acknowledged: true, acknowledgedAt: timestamp };
    },

    // =========================================================================
    // File Reservation Operations
    // =========================================================================

    async reserveFiles(projectKey, agentName, paths, options = {}) {
      // Check for conflicts first
      const conflicts = await this.checkReservationConflicts(projectKey, paths, agentName);

      if (conflicts.length > 0) {
        // Return conflicts, no reservations granted
        return {
          granted: [],
          conflicts: conflicts.map((c) => ({ path: c.path, heldBy: c.heldBy })),
        };
      }

      // Create reservation event
      const ttlSeconds = options.ttlSeconds || 3600;
      const event: AgentEvent = {
        type: "file_reserved",
        project_key: projectKey,
        agent_name: agentName,
        paths,
        reason: options.reason,
        exclusive: options.exclusive ?? true,
        ttl_seconds: ttlSeconds,
        expires_at: Date.now() + ttlSeconds * 1000,
        timestamp: Date.now(),
      };

      await this.appendEvent(event);

      // Query the reservations we just created
      const result = await db.query<{
        id: number;
        agent_name: string;
        path_pattern: string;
        exclusive: boolean;
        reason: string | null;
        created_at: string | number;
        expires_at: string | number;
      }>(
        `SELECT id, agent_name, path_pattern, exclusive, reason, created_at, expires_at
         FROM reservations
         WHERE project_key = $1 AND agent_name = $2 AND path_pattern = ANY($3) AND released_at IS NULL
         ORDER BY created_at DESC`,
        [projectKey, agentName, paths],
      );

      const granted = result.rows.map((row) => ({
        id: row.id,
        project_key: projectKey,
        agent_name: row.agent_name,
        path_pattern: row.path_pattern,
        exclusive: row.exclusive,
        reason: row.reason || undefined,
        created_at: parseTimestamp(row.created_at),
        expires_at: parseTimestamp(row.expires_at),
      }));

      return { granted, conflicts: [] };
    },

    async releaseFiles(projectKey, agentName, options = {}) {
      const timestamp = Date.now();
      const event: AgentEvent = {
        type: "file_released",
        project_key: projectKey,
        agent_name: agentName,
        paths: options.paths,
        reservation_ids: options.reservationIds,
        timestamp,
      };

      await this.appendEvent(event);

      // Count how many were released
      let releasedCount = 0;
      if (options.reservationIds && options.reservationIds.length > 0) {
        const result = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM reservations WHERE id = ANY($1) AND released_at = $2`,
          [options.reservationIds, timestamp],
        );
        releasedCount = Number(result.rows[0]?.count || 0);
      } else if (options.paths && options.paths.length > 0) {
        const result = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM reservations 
           WHERE project_key = $1 AND agent_name = $2 AND path_pattern = ANY($3) AND released_at = $4`,
          [projectKey, agentName, options.paths, timestamp],
        );
        releasedCount = Number(result.rows[0]?.count || 0);
      } else {
        const result = await db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM reservations 
           WHERE project_key = $1 AND agent_name = $2 AND released_at = $3`,
          [projectKey, agentName, timestamp],
        );
        releasedCount = Number(result.rows[0]?.count || 0);
      }

      return { released: releasedCount, releasedAt: timestamp };
    },

    async getActiveReservations(projectKey, agentName) {
      const now = Date.now();
      const result = await db.query<{
        id: number;
        agent_name: string;
        path_pattern: string;
        exclusive: boolean;
        reason: string | null;
        created_at: string | number;
        expires_at: string | number;
      }>(
        `SELECT id, agent_name, path_pattern, exclusive, reason, created_at, expires_at
         FROM reservations
         WHERE project_key = $1 AND agent_name = $2 AND released_at IS NULL AND expires_at > $3
         ORDER BY created_at ASC`,
        [projectKey, agentName, now],
      );

      return result.rows.map((row) => ({
        id: row.id,
        project_key: projectKey,
        agent_name: row.agent_name,
        path_pattern: row.path_pattern,
        exclusive: row.exclusive,
        reason: row.reason || undefined,
        created_at: parseTimestamp(row.created_at),
        expires_at: parseTimestamp(row.expires_at),
      }));
    },

    async checkReservationConflicts(projectKey, paths, excludeAgent) {
      const now = Date.now();
      const result = await db.query<{
        agent_name: string;
        path_pattern: string;
        exclusive: boolean;
      }>(
        `SELECT agent_name, path_pattern, exclusive
         FROM reservations
         WHERE project_key = $1 AND released_at IS NULL AND expires_at > $2 AND exclusive = TRUE`,
        [projectKey, now],
      );

      const conflicts: Array<{ path: string; heldBy: string; exclusive: boolean }> = [];

      // Import minimatch for pattern matching
      const minimatch = require("minimatch");

      for (const reservation of result.rows) {
        // Skip reservations by the excluded agent
        if (excludeAgent && reservation.agent_name === excludeAgent) {
          continue;
        }

        // Check each requested path against the reservation pattern
        for (const path of paths) {
          const matches =
            path === reservation.path_pattern ||
            minimatch.minimatch(path, reservation.path_pattern);

          if (matches) {
            conflicts.push({
              path,
              heldBy: reservation.agent_name,
              exclusive: reservation.exclusive,
            });
          }
        }
      }

      return conflicts;
    },

    // =========================================================================
    // Event Operations
    // =========================================================================

    async appendEvent(event) {
      const { type, project_key, timestamp, ...rest } = event as AgentEvent;

      await db.exec("BEGIN");
      try {
        // Insert event
        const result = await db.query<{ id: number; sequence: number }>(
          `INSERT INTO events (type, project_key, timestamp, data)
           VALUES ($1, $2, $3, $4)
           RETURNING id, sequence`,
          [type, project_key, timestamp, JSON.stringify(rest)],
        );

        const row = result.rows[0];
        if (!row) {
          throw new Error("Failed to insert event - no row returned");
        }
        const { id, sequence } = row;

        // Update materialized views
        await updateMaterializedViews({ ...event, id, sequence } as AgentEvent & {
          id: number;
          sequence: number;
        });

        await db.exec("COMMIT");

        return { ...event, id, sequence };
      } catch (e) {
        await db.exec("ROLLBACK");
        throw e;
      }
    },

    async readEvents(options = {}) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (options.projectKey) {
        conditions.push(`project_key = $${paramIndex++}`);
        params.push(options.projectKey);
      }

      if (options.types && options.types.length > 0) {
        conditions.push(`type = ANY($${paramIndex++})`);
        params.push(options.types);
      }

      if (options.since !== undefined) {
        conditions.push(`timestamp >= $${paramIndex++}`);
        params.push(options.since);
      }

      if (options.until !== undefined) {
        conditions.push(`timestamp <= $${paramIndex++}`);
        params.push(options.until);
      }

      if (options.afterSequence !== undefined) {
        conditions.push(`sequence > $${paramIndex++}`);
        params.push(options.afterSequence);
      }

      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      let query = `
        SELECT id, type, project_key, timestamp, sequence, data
        FROM events
        ${whereClause}
        ORDER BY sequence ASC
      `;

      if (options.limit) {
        query += ` LIMIT $${paramIndex++}`;
        params.push(options.limit);
      }

      const result = await db.query<{
        id: number;
        type: string;
        project_key: string;
        timestamp: string | number;
        sequence: number;
        data: string;
      }>(query, params);

      return result.rows.map((row) => {
        const data =
          typeof row.data === "string" ? JSON.parse(row.data) : row.data;
        return {
          id: row.id,
          type: row.type,
          project_key: row.project_key,
          timestamp: parseTimestamp(row.timestamp),
          sequence: row.sequence,
          ...data,
        } as AgentEvent & { id: number; sequence: number };
      });
    },

    async getLatestSequence(projectKey) {
      const query = projectKey
        ? "SELECT MAX(sequence) as seq FROM events WHERE project_key = $1"
        : "SELECT MAX(sequence) as seq FROM events";

      const params = projectKey ? [projectKey] : [];
      const result = await db.query<{ seq: number | null }>(query, params);

      return result.rows[0]?.seq ?? 0;
    },

    // =========================================================================
    // Health & Lifecycle
    // =========================================================================

    async isHealthy() {
      try {
        await db.query("SELECT 1 as ok");
        return true;
      } catch {
        return false;
      }
    },

    async getStats(projectKey) {
      const conditions = projectKey ? `WHERE project_key = $1` : "";
      const params = projectKey ? [projectKey] : [];
      
      const [events, agents, messages, reservations] = await Promise.all([
        db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM events ${conditions}`,
          params
        ),
        db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM agents ${conditions}`,
          params
        ),
        db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM messages ${conditions}`,
          params
        ),
        db.query<{ count: number }>(
          `SELECT COUNT(*) as count FROM reservations ${conditions} AND released_at IS NULL`,
          params
        ),
      ]);

      return {
        events: Number(events.rows[0]?.count || 0),
        agents: Number(agents.rows[0]?.count || 0),
        messages: Number(messages.rows[0]?.count || 0),
        reservations: Number(reservations.rows[0]?.count || 0),
      };
    },

    async close() {
      await db.close();
    },
  };
}
