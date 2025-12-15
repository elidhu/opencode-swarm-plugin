/**
 * Discovery Queue Module - Out-of-Scope Finding Tracking
 *
 * This module provides tools for agents to log discoveries made during task
 * execution without derailing from their primary work. Discoveries can later
 * be promoted to beads by the coordinator.
 *
 * Key principles:
 * - Zero-config: Uses existing LanceDB storage
 * - Fast logging: Minimal overhead for agents
 * - Semantic search: Vector search over discovery context
 * - Promotion workflow: Easy conversion to beads
 *
 * @module discovery
 */

import { tool } from "@opencode-ai/plugin";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getStorage } from "./storage";
import { embed } from "./embeddings";
import {
  DiscoveryEntrySchema,
  DiscoveryCreateArgsSchema,
  DiscoveryUpdateArgsSchema,
  DiscoveryQueryArgsSchema,
  DiscoveryPromoteArgsSchema,
  DiscoveryPromoteResultSchema,
  type DiscoveryEntry,
  type DiscoveryCreateArgs,
  type DiscoveryUpdateArgs,
  type DiscoveryQueryArgs,
  type DiscoveryPromoteArgs,
  type DiscoveryPromoteResult,
} from "./schemas/discovery";
import type { Bead } from "./schemas/bead";

// ============================================================================
// Working Directory Configuration
// ============================================================================

/**
 * Module-level working directory for discovery operations.
 * Set this via setDiscoveryWorkingDirectory() before using tools.
 */
let discoveryWorkingDirectory: string | null = null;

/**
 * Set the working directory for discovery operations.
 * This is used when creating beads from discoveries.
 *
 * @param directory - Absolute path to the project directory
 */
export function setDiscoveryWorkingDirectory(directory: string): void {
  discoveryWorkingDirectory = directory;
}

/**
 * Get the current working directory for discovery operations.
 */
export function getDiscoveryWorkingDirectory(): string {
  return discoveryWorkingDirectory || process.cwd();
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Custom error for discovery operations
 */
export class DiscoveryError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

/**
 * Custom error for validation failures
 */
export class DiscoveryValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError,
  ) {
    super(message);
    this.name = "DiscoveryValidationError";
  }
}

// ============================================================================
// Discovery Storage Interface
// ============================================================================

/**
 * Discovery storage operations
 * 
 * Uses LanceDB for persistence with semantic search capabilities.
 */
export interface DiscoveryStorage {
  storeDiscovery(entry: DiscoveryEntry): Promise<void>;
  getDiscovery(id: string): Promise<DiscoveryEntry | null>;
  getAllDiscoveries(): Promise<DiscoveryEntry[]>;
  queryDiscoveries(args: DiscoveryQueryArgs): Promise<DiscoveryEntry[]>;
  updateDiscovery(args: DiscoveryUpdateArgs): Promise<DiscoveryEntry>;
  findSimilarDiscoveries(query: string, limit?: number): Promise<DiscoveryEntry[]>;
}

/**
 * LanceDB-backed discovery storage
 */
export class LanceDBDiscoveryStorage implements DiscoveryStorage {
  private tableName = "discoveries";

  /**
   * Ensure the discoveries table exists and add data
   */
  private async ensureTableAndAdd(data: Record<string, unknown>): Promise<void> {
    const db = await this.getDb();
    
    try {
      const table = await db.openTable(this.tableName);
      await table.add([data]);
    } catch {
      // Table doesn't exist, create it
      console.log(`[discovery] Creating table: ${this.tableName}`);
      await db.createTable(this.tableName, [data]);
    }
  }

  /**
   * Get the discoveries table (returns null if doesn't exist)
   */
  private async getTable(): Promise<Record<string, any> | null> {
    const db = await this.getDb();
    
    try {
      return await db.openTable(this.tableName);
    } catch {
      return null;
    }
  }

  /**
   * Get the LanceDB connection
   */
  private async getDb(): Promise<Record<string, any>> {
    // Access the internal LanceDB connection from storage
    const storage = getStorage();
    
    // Use the storage's internal vector directory
    const vectorDir = (storage as any).vectorDir || ".hive/vectors";
    
    // Import lancedb and connect
    const lancedb = await import("@lancedb/lancedb");
    return await lancedb.connect(vectorDir);
  }

  async storeDiscovery(entry: DiscoveryEntry): Promise<void> {
    // Create embedding from discovery content
    const content = `${entry.title} ${entry.description} ${entry.type} ${entry.tags.join(" ")}`;
    const vector = await embed(content);

    const row = {
      id: entry.id,
      vector,
      type: entry.type,
      urgency: entry.urgency,
      status: entry.status,
      title: entry.title,
      description: entry.description,
      related_files: entry.related_files.join(","),
      code_context: entry.code_context || "",
      suggested_action: entry.suggested_action || "",
      estimated_effort: entry.estimated_effort || 0,
      discovered_by: entry.discovered_by,
      discovered_during: entry.discovered_during,
      thread_id: entry.thread_id || "",
      promoted_to_bead: entry.promoted_to_bead || "",
      tags: entry.tags.join(","),
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      metadata: JSON.stringify(entry.metadata || {}),
    };

    await this.ensureTableAndAdd(row);
  }

  async getDiscovery(id: string): Promise<DiscoveryEntry | null> {
    const table = await this.getTable();
    if (!table) return null;

    try {
      const results = await table.query().where(`id = '${id}'`).limit(1).toArray();

      if (results.length === 0) {
        return null;
      }

      const r = results[0];
      return this.rowToEntry(r);
    } catch {
      return null;
    }
  }

  async getAllDiscoveries(): Promise<DiscoveryEntry[]> {
    const table = await this.getTable();
    if (!table) return [];

    try {
      const results = await table.query().toArray();
      return results.map((r: any) => this.rowToEntry(r));
    } catch {
      return [];
    }
  }

  async queryDiscoveries(args: DiscoveryQueryArgs): Promise<DiscoveryEntry[]> {
    const table = await this.getTable();
    if (!table) return [];

    try {
      let query = table.query();

      // Build WHERE clause
      const conditions: string[] = [];
      
      if (args.status) {
        conditions.push(`status = '${args.status}'`);
      }
      if (args.type) {
        conditions.push(`type = '${args.type}'`);
      }
      if (args.urgency) {
        conditions.push(`urgency = '${args.urgency}'`);
      }
      if (args.discovered_by) {
        conditions.push(`discovered_by = '${args.discovered_by}'`);
      }
      if (args.discovered_during) {
        conditions.push(`discovered_during = '${args.discovered_during}'`);
      }

      if (conditions.length > 0) {
        query = query.where(conditions.join(" AND "));
      }

      const results = await query.limit(args.limit).toArray();

      // Filter by tags in-memory if specified
      let filtered = results.map((r: Record<string, any>) => this.rowToEntry(r));
      
      if (args.tags && args.tags.length > 0) {
        filtered = filtered.filter((entry: DiscoveryEntry) => 
          args.tags!.some((tag: string) => entry.tags.includes(tag))
        );
      }

      return filtered;
    } catch (error) {
      console.error("[discovery] Query error:", error);
      return [];
    }
  }

  async updateDiscovery(args: DiscoveryUpdateArgs): Promise<DiscoveryEntry> {
    // Get existing discovery
    const existing = await this.getDiscovery(args.id);
    if (!existing) {
      throw new DiscoveryError(`Discovery ${args.id} not found`, "updateDiscovery");
    }

    // Merge updates
    const updated: DiscoveryEntry = {
      ...existing,
      status: args.status || existing.status,
      urgency: args.urgency || existing.urgency,
      promoted_to_bead: args.promoted_to_bead || existing.promoted_to_bead,
      tags: args.tags || existing.tags,
      metadata: args.metadata ? { ...existing.metadata, ...args.metadata } : existing.metadata,
      updated_at: new Date().toISOString(),
    };

    // Store updated discovery (adds new version)
    await this.storeDiscovery(updated);
    
    return updated;
  }

  async findSimilarDiscoveries(query: string, limit: number = 10): Promise<DiscoveryEntry[]> {
    const table = await this.getTable();
    if (!table) return [];

    try {
      const queryVector = await embed(query);
      const results = await table.vectorSearch(queryVector).limit(limit).toArray();

      return results.map((r: any) => this.rowToEntry(r));
    } catch {
      return [];
    }
  }

  /**
   * Convert database row to DiscoveryEntry
   */
  private rowToEntry(r: Record<string, any>): DiscoveryEntry {
    return {
      id: r.id,
      type: r.type,
      urgency: r.urgency,
      status: r.status,
      title: r.title,
      description: r.description,
      related_files: r.related_files ? r.related_files.split(",").filter((f: string) => f) : [],
      code_context: r.code_context || undefined,
      suggested_action: r.suggested_action || undefined,
      estimated_effort: r.estimated_effort || undefined,
      discovered_by: r.discovered_by,
      discovered_during: r.discovered_during,
      thread_id: r.thread_id || undefined,
      promoted_to_bead: r.promoted_to_bead || undefined,
      tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
      created_at: r.created_at,
      updated_at: r.updated_at,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    };
  }
}

// ============================================================================
// Global Storage Instance
// ============================================================================

let globalDiscoveryStorage: DiscoveryStorage | null = null;

/**
 * Get or create the global discovery storage instance
 */
export function getDiscoveryStorage(): DiscoveryStorage {
  if (!globalDiscoveryStorage) {
    globalDiscoveryStorage = new LanceDBDiscoveryStorage();
  }
  return globalDiscoveryStorage;
}

/**
 * Set the global discovery storage instance (useful for testing)
 */
export function setDiscoveryStorage(storage: DiscoveryStorage): void {
  globalDiscoveryStorage = storage;
}

/**
 * Reset the global discovery storage instance
 */
export function resetDiscoveryStorage(): void {
  globalDiscoveryStorage = null;
}

// ============================================================================
// Context Management
// ============================================================================

/**
 * Discovery context for current agent
 */
interface DiscoveryContext {
  agentName?: string;
  currentBeadId?: string;
  threadId?: string;
}

let discoveryContext: DiscoveryContext = {};

/**
 * Set the discovery context for the current agent
 */
export function setDiscoveryContext(context: DiscoveryContext): void {
  discoveryContext = { ...discoveryContext, ...context };
}

/**
 * Get the current discovery context
 */
export function getDiscoveryContext(): DiscoveryContext {
  return discoveryContext;
}

/**
 * Clear the discovery context
 */
export function clearDiscoveryContext(): void {
  discoveryContext = {};
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create a new discovery
 * 
 * Logs a discovery made during task execution. The agent doesn't need to
 * break focus - discoveries are triaged asynchronously by the coordinator.
 * 
 * @example
 * ```typescript
 * // Log a bug found in unrelated code
 * discovery_create({
 *   type: "bug",
 *   urgency: "high",
 *   title: "Race condition in user auth",
 *   description: "While working on X, noticed auth.ts has...",
 *   related_files: ["src/auth.ts"],
 *   code_context: "```typescript\n// problematic code\n```",
 * })
 * ```
 */
export const discovery_create = tool({
  description: "Log a discovery found during task work without breaking focus",
  args: {
    type: tool.schema
      .enum([
        "bug",
        "debt",
        "security",
        "performance",
        "idea",
        "question",
        "documentation",
        "test",
        "dependency",
        "other",
      ])
      .describe("Discovery type for categorization"),
    urgency: tool.schema
      .enum(["critical", "high", "medium", "low", "info"])
      .optional()
      .describe("Urgency level (default: medium)"),
    title: tool.schema
      .string()
      .describe("Brief one-line summary (max 200 chars)"),
    description: tool.schema
      .string()
      .describe("Detailed description: what, why it matters, context"),
    related_files: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Files related to the discovery"),
    code_context: tool.schema
      .string()
      .optional()
      .describe("Code snippets or error messages (use markdown code blocks)"),
    suggested_action: tool.schema
      .string()
      .optional()
      .describe("Recommended next steps to address this"),
    estimated_effort: tool.schema
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe("Effort estimate: 1=trivial (<15min), 2=simple (15-60min), 3=moderate (1-4hr), 4=significant (1day), 5=major (multiple days)"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Tags for categorization (e.g., ['frontend', 'auth'])"),
  },
  async execute(args, ctx) {
    try {
      // Validate args
      const validated = DiscoveryCreateArgsSchema.parse(args);

      // Get context
      const context = getDiscoveryContext();
      
      if (!context.agentName) {
        throw new DiscoveryError(
          "Discovery context not set. Agent name is required.",
          "discovery_create"
        );
      }
      
      if (!context.currentBeadId) {
        throw new DiscoveryError(
          "Discovery context not set. Current bead ID is required.",
          "discovery_create"
        );
      }

      // Create discovery entry
      const now = new Date().toISOString();
      const entry: DiscoveryEntry = {
        id: nanoid(),
        type: validated.type,
        urgency: validated.urgency,
        status: "open",
        title: validated.title,
        description: validated.description,
        related_files: validated.related_files,
        code_context: validated.code_context,
        suggested_action: validated.suggested_action,
        estimated_effort: validated.estimated_effort,
        discovered_by: context.agentName,
        discovered_during: context.currentBeadId,
        thread_id: context.threadId,
        tags: validated.tags,
        created_at: now,
        updated_at: now,
      };

      // Store in LanceDB
      const storage = getDiscoveryStorage();
      await storage.storeDiscovery(entry);

      return JSON.stringify(
        {
          success: true,
          discovery_id: entry.id,
          message: `Discovery logged: ${entry.title}`,
        },
        null,
        2
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new DiscoveryValidationError(
          `Invalid discovery arguments: ${error.message}`,
          error
        );
      }
      throw error;
    }
  },
});

/**
 * Query discoveries with filters
 * 
 * Search for discoveries by status, type, urgency, or other criteria.
 * Supports semantic search via findSimilarDiscoveries.
 * 
 * @example
 * ```typescript
 * // Get all open security discoveries
 * discovery_query({
 *   status: "open",
 *   type: "security",
 * })
 * 
 * // Get discoveries by urgency
 * discovery_query({
 *   urgency: "critical",
 *   limit: 5,
 * })
 * ```
 */
export const discovery_query = tool({
  description: "Query pending discoveries with filters",
  args: {
    status: tool.schema
      .enum(["open", "triaged", "promoted", "deferred", "duplicate", "rejected", "resolved"])
      .optional()
      .describe("Filter by status"),
    type: tool.schema
      .enum([
        "bug",
        "debt",
        "security",
        "performance",
        "idea",
        "question",
        "documentation",
        "test",
        "dependency",
        "other",
      ])
      .optional()
      .describe("Filter by discovery type"),
    urgency: tool.schema
      .enum(["critical", "high", "medium", "low", "info"])
      .optional()
      .describe("Filter by urgency level"),
    discovered_by: tool.schema
      .string()
      .optional()
      .describe("Filter by agent who discovered"),
    discovered_during: tool.schema
      .string()
      .optional()
      .describe("Filter by bead ID during which it was discovered"),
    tags: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Filter by tags (matches any)"),
    limit: tool.schema
      .number()
      .optional()
      .describe("Max results to return (default: 20)"),
  },
  async execute(args, ctx) {
    try {
      // Validate args
      const validated = DiscoveryQueryArgsSchema.parse(args);

      // Query storage
      const storage = getDiscoveryStorage();
      const discoveries = await storage.queryDiscoveries(validated);

      return JSON.stringify(
        {
          count: discoveries.length,
          discoveries,
        },
        null,
        2
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new DiscoveryValidationError(
          `Invalid query arguments: ${error.message}`,
          error
        );
      }
      throw error;
    }
  },
});

/**
 * Promote a discovery to a bead
 * 
 * Converts a discovery into a tracked bead. This is typically done by the
 * coordinator during triage. The discovery is marked as "promoted" and
 * linked to the created bead.
 * 
 * @example
 * ```typescript
 * // Promote a discovery to a bead
 * discovery_promote({
 *   discovery_id: "abc123",
 *   bead_priority: 2,
 * })
 * 
 * // Promote with custom title/description
 * discovery_promote({
 *   discovery_id: "abc123",
 *   bead_title: "Fix race condition in auth",
 *   bead_description: "Detailed description...",
 *   parent_bead_id: "epic-xyz",
 * })
 * ```
 */
export const discovery_promote = tool({
  description: "Convert a discovery to a bead for tracking",
  args: {
    discovery_id: tool.schema.string().describe("Discovery ID to promote"),
    bead_title: tool.schema
      .string()
      .optional()
      .describe("Override title from discovery"),
    bead_description: tool.schema
      .string()
      .optional()
      .describe("Override description from discovery"),
    bead_priority: tool.schema
      .number()
      .min(0)
      .max(3)
      .optional()
      .describe("Priority for the created bead (0-3)"),
    parent_bead_id: tool.schema
      .string()
      .optional()
      .describe("Parent bead if this should be a subtask"),
  },
  async execute(args, ctx) {
    try {
      // Validate args
      const validated = DiscoveryPromoteArgsSchema.parse(args);

      // Get discovery
      const storage = getDiscoveryStorage();
      const discovery = await storage.getDiscovery(validated.discovery_id);

      if (!discovery) {
        throw new DiscoveryError(
          `Discovery ${validated.discovery_id} not found`,
          "discovery_promote"
        );
      }

      // Check if already promoted
      if (discovery.status === "promoted" && discovery.promoted_to_bead) {
        return JSON.stringify(
          {
            success: false,
            error: `Discovery already promoted to bead ${discovery.promoted_to_bead}`,
          },
          null,
          2
        );
      }

      // Map discovery type to bead type
      const typeMap: Record<string, "bug" | "feature" | "task" | "epic" | "chore"> = {
        bug: "bug",
        idea: "feature",
        debt: "chore",
        security: "bug",
        performance: "chore",
        question: "task",
        documentation: "chore",
        test: "chore",
        dependency: "chore",
        other: "task",
      };

      // Create bead using beads module
      const { beads_create } = await import("./beads");
      
      const beadType = typeMap[discovery.type] || "task";
      const beadArgs = {
        title: validated.bead_title || discovery.title,
        type: beadType as "bug" | "feature" | "task" | "epic" | "chore",
        priority: validated.bead_priority ?? 2,
        description: validated.bead_description || discovery.description,
        parent_id: validated.parent_bead_id,
      };

      const beadResult = await beads_create.execute(beadArgs, ctx);
      const bead: Bead = JSON.parse(beadResult);

      // Update discovery status
      const updated = await storage.updateDiscovery({
        id: discovery.id,
        status: "promoted",
        promoted_to_bead: bead.id,
      });

      const result: DiscoveryPromoteResult = {
        success: true,
        discovery_id: discovery.id,
        bead_id: bead.id,
        updated_discovery: updated,
      };

      return JSON.stringify(result, null, 2);
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new DiscoveryValidationError(
          `Invalid promote arguments: ${error.message}`,
          error
        );
      }
      throw error;
    }
  },
});

// ============================================================================
// Export all tools
// ============================================================================

export const discoveryTools = {
  discovery_create,
  discovery_query,
  discovery_promote,
};
