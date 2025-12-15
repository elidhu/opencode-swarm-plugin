/**
 * Test Utilities for Swarm Mail
 *
 * Provides isolated in-memory adapters for fast, parallel testing.
 * Each test gets its own adapter instance with no shared state.
 *
 * Usage:
 * ```typescript
 * import { createInMemorySwarmMail } from './test-utils';
 *
 * describe('my tests', () => {
 *   let adapter: SwarmMailAdapter;
 *   let cleanup: () => Promise<void>;
 *
 *   beforeEach(async () => {
 *     const result = await createInMemorySwarmMail();
 *     adapter = result.adapter;
 *     cleanup = result.cleanup;
 *   });
 *
 *   afterEach(async () => {
 *     await cleanup();
 *   });
 *
 *   it('works with isolated state', async () => {
 *     // Use adapter here
 *   });
 * });
 * ```
 */

import { createSwarmMailAdapter } from "../adapter";
import type { SwarmMailAdapter } from "../types/adapter";

/**
 * Result from creating an in-memory Swarm Mail adapter
 */
export interface InMemorySwarmMailResult {
  /** Isolated adapter instance for testing */
  adapter: SwarmMailAdapter;

  /** Cleanup function to close adapter and release resources */
  cleanup: () => Promise<void>;
}

/**
 * Create an isolated in-memory Swarm Mail adapter for testing
 *
 * Benefits:
 * - 10x faster than PGLite
 * - No shared state between tests (perfect isolation)
 * - No filesystem artifacts (everything in memory)
 * - Parallel test execution safe
 *
 * @returns Isolated adapter and cleanup function
 *
 * @example
 * ```typescript
 * const { adapter, cleanup } = await createInMemorySwarmMail();
 * try {
 *   await adapter.registerAgent('test-project', 'agent-1');
 *   // ... test operations ...
 * } finally {
 *   await cleanup();
 * }
 * ```
 */
export async function createInMemorySwarmMail(): Promise<InMemorySwarmMailResult> {
  const adapter = await createSwarmMailAdapter({
    inMemory: true,
  });

  return {
    adapter,
    cleanup: async () => {
      await adapter.close();
    },
  };
}
