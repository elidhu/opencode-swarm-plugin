/**
 * Adapter Tests
 *
 * Tests for DatabaseAdapter and SwarmMailAdapter factory.
 * Focus on interface contracts and in-memory implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  InMemoryDatabaseAdapter,
  PGliteDatabaseAdapter,
  createSwarmMailAdapter,
} from "./adapter";
import type { DatabaseAdapter } from "./types/database";
import { withTransaction } from "./types/database";

describe("InMemoryDatabaseAdapter", () => {
  let db: DatabaseAdapter;

  beforeEach(() => {
    db = new InMemoryDatabaseAdapter();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Schema Operations", () => {
    it("should create tables", async () => {
      await db.exec("CREATE TABLE IF NOT EXISTS test (id SERIAL PRIMARY KEY, name TEXT)");
      
      // Insert and verify
      await db.exec("INSERT INTO test (name) VALUES ('foo')");
      const result = await db.query<{ name: string }>("SELECT name FROM test");
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe("foo");
    });

    it("should handle CREATE INDEX as no-op", async () => {
      await db.exec("CREATE TABLE test (id SERIAL)");
      await db.exec("CREATE INDEX idx_test ON test(id)");
      // Should not throw
    });
  });

  describe("Query Operations", () => {
    beforeEach(async () => {
      await db.exec("CREATE TABLE events (id SERIAL PRIMARY KEY, type TEXT, data TEXT)");
    });

    it("should insert and return SERIAL id", async () => {
      const result = await db.query<{ id: number }>(
        "INSERT INTO events (type, data) VALUES ($1, $2) RETURNING id",
        ["test", "data"]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe(1);
    });

    it("should auto-increment SERIAL columns", async () => {
      await db.query("INSERT INTO events (type, data) VALUES ($1, $2)", ["test1", "data1"]);
      await db.query("INSERT INTO events (type, data) VALUES ($1, $2)", ["test2", "data2"]);

      const result = await db.query<{ id: number }>("SELECT id FROM events");
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].id).toBe(1);
      expect(result.rows[1].id).toBe(2);
    });

    it("should handle parameterized SELECT", async () => {
      await db.query("INSERT INTO events (type, data) VALUES ($1, $2)", ["foo", "data1"]);
      await db.query("INSERT INTO events (type, data) VALUES ($1, $2)", ["bar", "data2"]);

      const result = await db.query<{ type: string; data: string }>(
        "SELECT type, data FROM events WHERE type = $1",
        ["foo"]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].type).toBe("foo");
    });

    it("should handle UPDATE with WHERE", async () => {
      await db.query("INSERT INTO events (type, data) VALUES ($1, $2)", ["foo", "old"]);
      
      const updateResult = await db.query(
        "UPDATE events SET data = $1 WHERE type = $2",
        ["new", "foo"]
      );

      expect(updateResult.affectedRows).toBe(1);

      const selectResult = await db.query<{ data: string }>(
        "SELECT data FROM events WHERE type = $1",
        ["foo"]
      );

      expect(selectResult.rows[0].data).toBe("new");
    });

    it("should handle DELETE with WHERE", async () => {
      await db.query("INSERT INTO events (type) VALUES ($1)", ["foo"]);
      await db.query("INSERT INTO events (type) VALUES ($1)", ["bar"]);

      const deleteResult = await db.query("DELETE FROM events WHERE type = $1", ["foo"]);
      expect(deleteResult.affectedRows).toBe(1);

      const selectResult = await db.query<{ type: string }>("SELECT type FROM events");
      expect(selectResult.rows).toHaveLength(1);
      expect(selectResult.rows[0].type).toBe("bar");
    });

    it("should handle DELETE without WHERE (delete all)", async () => {
      await db.query("INSERT INTO events (type) VALUES ($1)", ["foo"]);
      await db.query("INSERT INTO events (type) VALUES ($1)", ["bar"]);

      await db.exec("DELETE FROM events");

      const result = await db.query("SELECT * FROM events");
      expect(result.rows).toHaveLength(0);
    });
  });

  describe("Query Modifiers", () => {
    beforeEach(async () => {
      await db.exec("CREATE TABLE items (id SERIAL, value INTEGER)");
      await db.query("INSERT INTO items (value) VALUES ($1)", [30]);
      await db.query("INSERT INTO items (value) VALUES ($1)", [10]);
      await db.query("INSERT INTO items (value) VALUES ($1)", [20]);
    });

    it("should handle ORDER BY ASC", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value ASC"
      );

      expect(result.rows.map(r => r.value)).toEqual([10, 20, 30]);
    });

    it("should handle ORDER BY DESC", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value DESC"
      );

      expect(result.rows.map(r => r.value)).toEqual([30, 20, 10]);
    });

    it("should handle LIMIT", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value ASC LIMIT 2"
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows.map(r => r.value)).toEqual([10, 20]);
    });

    it("should handle parameterized LIMIT", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value ASC LIMIT $1",
        [2]
      );

      expect(result.rows).toHaveLength(2);
    });

    it("should handle OFFSET", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value ASC OFFSET 1"
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows.map(r => r.value)).toEqual([20, 30]);
    });

    it("should handle LIMIT and OFFSET together", async () => {
      const result = await db.query<{ value: number }>(
        "SELECT value FROM items ORDER BY value ASC LIMIT 1 OFFSET 1"
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].value).toBe(20);
    });
  });

  describe("Transactions", () => {
    beforeEach(async () => {
      await db.exec("CREATE TABLE accounts (id SERIAL, balance INTEGER)");
      await db.query("INSERT INTO accounts (balance) VALUES ($1)", [100]);
    });

    it("should commit successful transactions", async () => {
      await db.exec("BEGIN");
      await db.query("UPDATE accounts SET balance = $1 WHERE id = $2", [150, 1]);
      await db.exec("COMMIT");

      const result = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 1");
      expect(result.rows[0].balance).toBe(150);
    });

    it("should rollback on error", async () => {
      await db.exec("BEGIN");
      await db.query("UPDATE accounts SET balance = $1 WHERE id = $2", [150, 1]);
      await db.exec("ROLLBACK");

      const result = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 1");
      expect(result.rows[0].balance).toBe(100); // Original value
    });

    it("should work with withTransaction helper", async () => {
      const result = await withTransaction(db, async () => {
        await db.query("UPDATE accounts SET balance = $1 WHERE id = $2", [200, 1]);
        return { success: true };
      });

      expect(result.success).toBe(true);

      const selectResult = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 1");
      expect(selectResult.rows[0].balance).toBe(200);
    });

    it("should rollback when withTransaction throws", async () => {
      try {
        await withTransaction(db, async () => {
          await db.query("UPDATE accounts SET balance = $1 WHERE id = $2", [200, 1]);
          throw new Error("Test error");
        });
      } catch (e) {
        expect((e as Error).message).toBe("Test error");
      }

      const result = await db.query<{ balance: number }>("SELECT balance FROM accounts WHERE id = 1");
      expect(result.rows[0].balance).toBe(100); // Rolled back
    });
  });

  describe("Condition Evaluation", () => {
    beforeEach(async () => {
      await db.exec("CREATE TABLE users (id SERIAL, name TEXT, email TEXT)");
      await db.query("INSERT INTO users (name, email) VALUES ($1, $2)", ["Alice", "alice@example.com"]);
      await db.query("INSERT INTO users (name, email) VALUES ($1, $2)", ["Bob", "bob@example.com"]);
      await db.query("INSERT INTO users (name) VALUES ($1)", ["Charlie"]); // NULL email
    });

    it("should handle IS NULL", async () => {
      const result = await db.query<{ name: string }>("SELECT name FROM users WHERE email IS NULL");
      
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe("Charlie");
    });

    it("should handle IS NOT NULL", async () => {
      const result = await db.query<{ name: string }>("SELECT name FROM users WHERE email IS NOT NULL");
      
      expect(result.rows).toHaveLength(2);
      expect(result.rows.map(r => r.name)).toEqual(["Alice", "Bob"]);
    });

    it("should handle AND conditions", async () => {
      const result = await db.query<{ name: string }>(
        "SELECT name FROM users WHERE name = $1 AND email IS NOT NULL",
        ["Alice"]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].name).toBe("Alice");
    });
  });
});

describe("createSwarmMailAdapter", () => {
  it("should create in-memory adapter", async () => {
    const adapter = await createSwarmMailAdapter({ inMemory: true });

    expect(adapter).toBeDefined();
    expect(typeof adapter.isHealthy).toBe("function");
    expect(typeof adapter.getStats).toBe("function");

    await adapter.close();
  });

  it("should pass health check", async () => {
    const adapter = await createSwarmMailAdapter({ inMemory: true });

    const healthy = await adapter.isHealthy();
    expect(healthy).toBe(true);

    await adapter.close();
  });

  it("should return stats", async () => {
    const adapter = await createSwarmMailAdapter({ inMemory: true });

    const stats = await adapter.getStats();
    expect(stats).toEqual({
      events: 0,
      agents: 0,
      messages: 0,
      reservations: 0,
    });

    await adapter.close();
  });

  it("should accept custom database adapter", async () => {
    const customDb = new InMemoryDatabaseAdapter();
    await customDb.exec("CREATE TABLE test (id SERIAL)");

    const adapter = await createSwarmMailAdapter({ dbOverride: customDb });

    expect(adapter).toBeDefined();
    await adapter.close();
  });
});

describe("PGliteDatabaseAdapter", () => {
  it("should wrap PGlite instance", async () => {
    // Note: This test requires actual PGLite, which we'll skip for now
    // since it needs filesystem access. Integration tests will cover this.
    expect(PGliteDatabaseAdapter).toBeDefined();
  });
});
