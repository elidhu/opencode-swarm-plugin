/**
 * Effect Schema Migrations
 *
 * Centralized schema initialization for Effect-TS durable primitives.
 * This module provides a single location for all Effect-related table creation.
 *
 * Tables managed here:
 * - cursors: DurableCursor position tracking
 * - deferred: DurableDeferred distributed promises
 * - locks: DurableLock mutual exclusion
 *
 * @module streams/effect/migrations
 */

import type { PGlite } from "@electric-sql/pglite";

/**
 * Initialize all Effect schema tables
 *
 * Creates tables for cursors, deferred, and locks with appropriate indexes.
 * Idempotent - safe to call multiple times.
 *
 * @param db - PGLite database instance
 */
export async function initializeEffectSchemas(db: PGlite): Promise<void> {
  await db.exec(`
    -- Cursors table for DurableCursor
    CREATE TABLE IF NOT EXISTS cursors (
      id SERIAL PRIMARY KEY,
      stream TEXT NOT NULL,
      checkpoint TEXT NOT NULL,
      position BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      UNIQUE(stream, checkpoint)
    );

    CREATE INDEX IF NOT EXISTS idx_cursors_stream ON cursors(stream);
    CREATE INDEX IF NOT EXISTS idx_cursors_checkpoint ON cursors(checkpoint);

    -- Deferred table for DurableDeferred
    CREATE TABLE IF NOT EXISTS deferred (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      resolved BOOLEAN NOT NULL DEFAULT FALSE,
      value JSONB,
      error TEXT,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_deferred_url ON deferred(url);
    CREATE INDEX IF NOT EXISTS idx_deferred_expires ON deferred(expires_at);

    -- Locks table for DurableLock
    CREATE TABLE IF NOT EXISTS locks (
      resource TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      acquired_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_locks_expires ON locks(expires_at);
    CREATE INDEX IF NOT EXISTS idx_locks_holder ON locks(holder);
  `);
}
