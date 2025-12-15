/**
 * Shared test utilities for Effect streams
 *
 * Provides helpers to reduce test boilerplate:
 * - createTestDatabase: Isolated test database with automatic cleanup
 * - createTestEnv: Full test environment with all services
 *
 * @example
 * ```typescript
 * const testDb = createTestDatabase("lock-test");
 *
 * beforeEach(testDb.setup);
 * afterEach(testDb.cleanup);
 *
 * it("my test", async () => {
 *   const program = Effect.gen(function* () {
 *     const lock = yield* acquireLock("test-resource");
 *     // ...
 *   });
 *   await testDb.run(program);
 * });
 * ```
 */

import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Layer } from "effect";
import { resetDatabase, closeDatabase } from "../index";
import {
  DurableCursor,
  DurableCursorLive,
  DurableDeferredLive,
  DurableLockLive,
  DurableMailboxLive,
} from "./index";

// ============================================================================
// Layer Compositions
// ============================================================================

/**
 * All durable streams services composed into one layer
 *
 * Provides: DurableCursor, DurableDeferred, DurableLock, DurableMailbox
 */
const DurableStreamsLayer = Layer.mergeAll(
  Layer.succeed(DurableCursor, DurableCursorLive),
  DurableDeferredLive,
  DurableLockLive,
  DurableMailboxLive,
);

// ============================================================================
// Test Database Setup
// ============================================================================

/**
 * Setup isolated test database with automatic cleanup
 *
 * Returns an object with:
 * - setup: Function to call in beforeEach
 * - cleanup: Function to call in afterEach
 * - path: Function to get the current test database path
 * - run: Function to run Effect programs with full layer
 *
 * @param prefix - Unique prefix for test database (e.g., "lock-test")
 *
 * @example
 * ```typescript
 * const testDb = createTestDatabase("cursor-test");
 *
 * beforeEach(testDb.setup);
 * afterEach(testDb.cleanup);
 *
 * it("my test", async () => {
 *   const program = Effect.gen(function* () {
 *     const cursor = yield* DurableCursor;
 *     // Use cursor...
 *   });
 *   await testDb.run(program);
 * });
 * ```
 */
export function createTestDatabase(prefix: string) {
  let dbPath: string;

  return {
    /**
     * Setup function - call in beforeEach
     * Creates isolated test database with unique path
     */
    setup: async () => {
      dbPath = `/tmp/${prefix}-${randomUUID()}`;
      await resetDatabase(dbPath);
    },

    /**
     * Cleanup function - call in afterEach
     * Closes database and cleans up temporary files
     */
    cleanup: async () => {
      try {
        await closeDatabase(dbPath);
        // Give PGLite time to release file handles
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (error) {
        // Ignore cleanup errors to avoid failing tests
        console.warn(`Cleanup warning for ${dbPath}:`, error);
      }
    },

    /**
     * Get the current test database path
     */
    path: () => dbPath,

    /**
     * Run an Effect program with all durable streams services
     */
    run: <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
      Effect.runPromise(
        effect.pipe(Effect.provide(DurableStreamsLayer)) as Effect.Effect<
          A,
          E,
          never
        >,
      ),
  };
}

/**
 * Create isolated test environment with all services
 *
 * Extended version of createTestDatabase with additional helpers.
 *
 * @param prefix - Unique prefix for test database (defaults to "test")
 *
 * @example
 * ```typescript
 * const testEnv = createTestEnv("mailbox-test");
 *
 * beforeEach(testEnv.setup);
 * afterEach(testEnv.cleanup);
 *
 * it("my test", async () => {
 *   await testEnv.runTest((projectPath) =>
 *     Effect.gen(function* () {
 *       const mailbox = yield* DurableMailbox;
 *       const mb = yield* mailbox.create({
 *         agent: "test",
 *         projectKey: "/test",
 *         projectPath,
 *       });
 *       // Use mailbox...
 *     })
 *   );
 * });
 * ```
 */
export function createTestEnv(prefix: string = "test") {
  const db = createTestDatabase(prefix);

  return {
    ...db,

    /**
     * Run Effect program with projectPath automatically injected
     *
     * Useful when your test needs the projectPath parameter.
     */
    runTest: <A, E, R>(
      program: (projectPath: string) => Effect.Effect<A, E, R>,
    ): Promise<A> => db.run(program(db.path())),
  };
}
