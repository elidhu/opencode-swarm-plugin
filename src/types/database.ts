/**
 * Database Adapter Interface
 *
 * Abstracts SQL database operations to enable:
 * - In-memory testing (10x faster, no shared state)
 * - Alternative database backends (SQLite, PGLite, PostgreSQL)
 * - Checkpoint/recovery implementations
 *
 * Design Goals:
 * - Minimal interface (query, exec, transaction)
 * - Compatible with PGLite API
 * - Supports parameterized queries for safety
 */

/**
 * Query result from database operations
 *
 * Compatible with PGLite's query result format
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Rows returned by the query */
  rows: T[];
  /** Number of rows affected (for INSERT/UPDATE/DELETE) */
  affectedRows?: number;
  /** Query execution metadata */
  fields?: Array<{ name: string; dataTypeID: number }>;
}

/**
 * Database adapter interface
 *
 * Abstracts SQL database operations for Swarm Mail event store.
 * Implementations must provide query execution, DDL operations, and transactions.
 *
 * @example
 * ```typescript
 * // Query with parameters
 * const result = await db.query<{ name: string }>(
 *   "SELECT name FROM agents WHERE project_key = $1",
 *   ["my-project"]
 * );
 *
 * // Execute DDL
 * await db.exec("CREATE TABLE IF NOT EXISTS test (id SERIAL)");
 *
 * // Transaction
 * await db.exec("BEGIN");
 * try {
 *   await db.query("INSERT INTO test VALUES (1)");
 *   await db.exec("COMMIT");
 * } catch (e) {
 *   await db.exec("ROLLBACK");
 * }
 * ```
 */
export interface DatabaseAdapter {
  /**
   * Execute a parameterized SQL query
   *
   * @param sql - SQL query with $1, $2, etc. placeholders
   * @param params - Parameter values (optional)
   * @returns Query result with typed rows
   *
   * @example
   * ```typescript
   * const result = await db.query<{ count: number }>(
   *   "SELECT COUNT(*) as count FROM events WHERE type = $1",
   *   ["message_sent"]
   * );
   * console.log(result.rows[0].count);
   * ```
   */
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;

  /**
   * Execute SQL without returning results
   *
   * Used for DDL (CREATE TABLE, etc.) and transaction control (BEGIN, COMMIT, ROLLBACK)
   *
   * @param sql - SQL statement(s) to execute
   *
   * @example
   * ```typescript
   * await db.exec("BEGIN");
   * await db.exec("CREATE INDEX IF NOT EXISTS idx_events ON events(type)");
   * await db.exec("COMMIT");
   * ```
   */
  exec(sql: string): Promise<void>;

  /**
   * Close the database connection
   *
   * Should be called when the adapter is no longer needed.
   * In-memory adapters can use this for cleanup.
   */
  close(): Promise<void>;
}

/**
 * Transaction helper for DatabaseAdapter
 *
 * Wraps operations in BEGIN/COMMIT with automatic ROLLBACK on error
 *
 * @param db - Database adapter
 * @param fn - Function to execute within transaction
 * @returns Result of the function
 *
 * @example
 * ```typescript
 * const result = await withTransaction(db, async () => {
 *   await db.query("INSERT INTO events VALUES ($1)", [event]);
 *   await db.query("UPDATE agents SET last_active = $1", [now]);
 *   return { success: true };
 * });
 * ```
 */
export async function withTransaction<T>(
  db: DatabaseAdapter,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec("BEGIN");
  try {
    const result = await fn();
    await db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch (rollbackError) {
      // Log both errors but throw composite error
      console.error("[adapter] ROLLBACK failed:", rollbackError);
      const compositeError = new Error(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}. ` +
          `ROLLBACK also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      );
      (compositeError as any).originalError = error;
      (compositeError as any).rollbackError = rollbackError;
      throw compositeError;
    }
    throw error;
  }
}
