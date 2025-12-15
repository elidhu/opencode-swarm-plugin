/**
 * Storage Module - Persistent vector storage for learning data
 *
 * Provides LanceDB-backed persistent vector storage with semantic search.
 *
 * The lancedb backend uses tables:
 * - `feedback` - Criterion feedback events with embeddings
 * - `patterns` - Decomposition patterns and anti-patterns with embeddings
 * - `maturity` - Pattern maturity tracking
 * - `maturity-feedback` - Maturity feedback events
 * - `strikes` - Strike records for detecting architectural problems
 * - `errors` - Error entries accumulated during subtask execution
 *
 * @example
 * ```typescript
 * // Use default lancedb storage
 * const storage = createStorage();
 *
 * // Custom vector directory
 * const storage = createStorage({ vectorDir: ".custom-vectors" });
 * ```
 */

import type { FeedbackEvent, StrikeRecord, ErrorEntry } from "./learning";
import type { DecompositionPattern } from "./pattern-maturity";
import type { PatternMaturity, MaturityFeedback } from "./pattern-maturity";
import type { SpecializationScore, AgentSpecialization } from "./schemas/specialization";
import * as lancedb from "@lancedb/lancedb";
import { embed, EMBEDDING_DIMENSION } from "./embeddings";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";



// ============================================================================
// Configuration
// ============================================================================

/**
 * Storage configuration
 */
export interface StorageConfig {
  /** Directory for LanceDB storage (default: ".hive/vectors") */
  vectorDir?: string;
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  vectorDir: ".hive/vectors",
};

// ============================================================================
// Unified Storage Interface
// ============================================================================

/**
 * Unified storage interface for all learning data
 */
export interface LearningStorage {
  // Feedback operations
  storeFeedback(event: FeedbackEvent): Promise<void>;
  getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]>;
  getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]>;
  getAllFeedback(): Promise<FeedbackEvent[]>;
  findSimilarFeedback(query: string, limit?: number): Promise<FeedbackEvent[]>;

  // Pattern operations
  storePattern(pattern: DecompositionPattern): Promise<void>;
  getPattern(id: string): Promise<DecompositionPattern | null>;
  getAllPatterns(): Promise<DecompositionPattern[]>;
  getAntiPatterns(): Promise<DecompositionPattern[]>;
  getPatternsByTag(tag: string): Promise<DecompositionPattern[]>;
  findSimilarPatterns(
    query: string,
    limit?: number,
  ): Promise<DecompositionPattern[]>;

  // Maturity operations
  storeMaturity(maturity: PatternMaturity): Promise<void>;
  getMaturity(patternId: string): Promise<PatternMaturity | null>;
  getAllMaturity(): Promise<PatternMaturity[]>;
  getMaturityByState(state: string): Promise<PatternMaturity[]>;
  storeMaturityFeedback(feedback: MaturityFeedback): Promise<void>;
  getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]>;

  // Strike operations
  storeStrike(record: StrikeRecord): Promise<void>;
  getStrike(beadId: string): Promise<StrikeRecord | null>;
  getAllStrikes(): Promise<StrikeRecord[]>;
  clearStrike(beadId: string): Promise<void>;

  // Error operations
  storeError(entry: ErrorEntry): Promise<void>;
  getErrorsByBead(beadId: string): Promise<ErrorEntry[]>;
  getUnresolvedErrorsByBead(beadId: string): Promise<ErrorEntry[]>;
  markErrorResolved(id: string): Promise<void>;
  getAllErrors(): Promise<ErrorEntry[]>;

  // Specialization operations
  storeSpecializationScore(score: SpecializationScore): Promise<void>;
  getSpecializationScores(
    agentId: string,
    dimension: string,
    value: string,
  ): Promise<SpecializationScore[]>;
  getAllSpecializationScores(agentId: string): Promise<SpecializationScore[]>;
  findSpecializationScores(
    dimension: string,
    value: string,
  ): Promise<SpecializationScore[]>;
  storeAgentSpecialization(profile: AgentSpecialization): Promise<void>;
  getAgentSpecialization(agentId: string): Promise<AgentSpecialization | null>;
  getAllAgentSpecializations(): Promise<AgentSpecialization[]>;

  // Lifecycle
  close(): Promise<void>;
}

// ============================================================================
// LanceDB Storage Implementation
// ============================================================================

/** Per-directory LanceDB connection instances */
const lanceDbInstances = new Map<string, lancedb.Connection>();

/** Pending LanceDB initialization promises to prevent race conditions */
const lanceDbInitPromises = new Map<string, Promise<lancedb.Connection>>();

/** Track which tables have been initialized per directory */
const initializedTables = new Map<string, Set<string>>();

/**
 * Get or create the LanceDB connection for a specific directory
 *
 * Uses per-directory singleton pattern with lazy initialization.
 * Multiple concurrent calls to the same directory will share the same pending promise.
 */
async function getLanceDb(vectorDir: string): Promise<lancedb.Connection> {
  // Return cached instance if available
  const cachedInstance = lanceDbInstances.get(vectorDir);
  if (cachedInstance) {
    return cachedInstance;
  }

  // Return pending promise if initialization is in progress
  const pendingPromise = lanceDbInitPromises.get(vectorDir);
  if (pendingPromise) {
    return pendingPromise;
  }

  // Create new initialization promise
  const initPromise = initializeLanceDb(vectorDir);
  lanceDbInitPromises.set(vectorDir, initPromise);

  try {
    const instance = await initPromise;
    lanceDbInstances.set(vectorDir, instance);
    return instance;
  } finally {
    // Clean up pending promise once resolved/rejected
    lanceDbInitPromises.delete(vectorDir);
  }
}

/**
 * Initialize the LanceDB connection
 */
async function initializeLanceDb(
  vectorDir: string,
): Promise<lancedb.Connection> {
  try {
    // Ensure vector directory exists
    if (!existsSync(vectorDir)) {
      mkdirSync(vectorDir, { recursive: true });
    }

    console.log(`[storage] Connecting to LanceDB at ${vectorDir}`);
    const db = await lancedb.connect(vectorDir);
    console.log("[storage] LanceDB connection established");
    return db;
  } catch (error) {
    const err = error as Error;
    console.error(`[storage] Failed to initialize LanceDB: ${err.message}`);
    throw new Error(`LanceDB initialization failed: ${err.message}`);
  }
}

/**
 * LanceDB-backed storage with vector search
 *
 * Uses LanceDB for persistent vector storage with semantic search.
 * Data is stored in .hive/vectors/ with embeddings for similarity search.
 */
export class LanceDBStorage implements LearningStorage {
  private vectorDir: string;

  constructor(config: Partial<StorageConfig> = {}) {
    const fullConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };
    this.vectorDir = fullConfig.vectorDir || ".hive/vectors";
  }

  // -------------------------------------------------------------------------
  // Table Initialization
  // -------------------------------------------------------------------------

  /**
   * Get or create a table, inserting data if the table needs to be created.
   * 
   * @param tableName - Name of the table
   * @param data - Data to insert. If table doesn't exist, creates it with this data.
   *               If table exists, adds this data to it.
   * @returns The table (data already inserted)
   */
  private async ensureTableAndAdd<T extends Record<string, unknown>>(
    tableName: string,
    data: T,
  ): Promise<lancedb.Table> {
    const db = await getLanceDb(this.vectorDir);
    
    // Get or create the set of initialized tables for this directory
    if (!initializedTables.has(this.vectorDir)) {
      initializedTables.set(this.vectorDir, new Set<string>());
    }
    const dirTables = initializedTables.get(this.vectorDir)!;

    // Check if table already initialized in this session
    if (dirTables.has(tableName)) {
      const table = await db.openTable(tableName);
      await table.add([data]);
      return table;
    }

    try {
      // Try to open existing table and add data
      const table = await db.openTable(tableName);
      dirTables.add(tableName);
      await table.add([data]);
      return table;
    } catch {
      // Table doesn't exist, create it with the data
      console.log(`[storage] Creating table: ${tableName}`);
      const table = await db.createTable(tableName, [data]);
      dirTables.add(tableName);
      return table;
    }
  }

  /**
   * Get a table for reading (returns null if table doesn't exist)
   */
  private async getTable(tableName: string): Promise<lancedb.Table | null> {
    const db = await getLanceDb(this.vectorDir);
    
    if (!initializedTables.has(this.vectorDir)) {
      initializedTables.set(this.vectorDir, new Set<string>());
    }
    const dirTables = initializedTables.get(this.vectorDir)!;

    if (dirTables.has(tableName)) {
      return await db.openTable(tableName);
    }

    try {
      const table = await db.openTable(tableName);
      dirTables.add(tableName);
      return table;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Feedback Operations
  // -------------------------------------------------------------------------

  async storeFeedback(event: FeedbackEvent): Promise<void> {
    // Create embedding from feedback content
    const content = `${event.criterion} ${event.type} ${event.context || ""}`;
    const vector = await embed(content);

    const row = {
      id: event.id,
      vector,
      criterion: event.criterion,
      type: event.type,
      timestamp: event.timestamp,
      context: event.context || "",
      bead_id: event.bead_id || "",
      raw_value: event.raw_value,
    };

    await this.ensureTableAndAdd("feedback", row);
  }

  async getFeedbackByCriterion(criterion: string): Promise<FeedbackEvent[]> {
    const table = await this.getTable("feedback");
    if (!table) return [];

    try {
      const results = await table
        .query()
        .where(`criterion = '${criterion}'`)
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        criterion: r.criterion,
        type: r.type,
        timestamp: r.timestamp,
        context: r.context || undefined,
        bead_id: r.bead_id || undefined,
        raw_value: r.raw_value,
      }));
    } catch {
      return [];
    }
  }

  async getFeedbackByBead(beadId: string): Promise<FeedbackEvent[]> {
    const table = await this.getTable("feedback");
    if (!table) return [];

    try {
      const results = await table
        .query()
        .where(`bead_id = '${beadId}'`)
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        criterion: r.criterion,
        type: r.type,
        timestamp: r.timestamp,
        context: r.context || undefined,
        bead_id: r.bead_id || undefined,
        raw_value: r.raw_value,
      }));
    } catch {
      return [];
    }
  }

  async getAllFeedback(): Promise<FeedbackEvent[]> {
    const table = await this.getTable("feedback");
    if (!table) return [];

    try {
      const results = await table.query().toArray();

      return results.map((r: any) => ({
        id: r.id,
        criterion: r.criterion,
        type: r.type,
        timestamp: r.timestamp,
        context: r.context || undefined,
        bead_id: r.bead_id || undefined,
        raw_value: r.raw_value,
      }));
    } catch {
      return [];
    }
  }

  async findSimilarFeedback(
    query: string,
    limit: number = 10,
  ): Promise<FeedbackEvent[]> {
    const table = await this.getTable("feedback");
    if (!table) return [];

    try {
      const queryVector = await embed(query);
      const results = await table.vectorSearch(queryVector).limit(limit).toArray();

      return results.map((r: any) => ({
        id: r.id,
        criterion: r.criterion,
        type: r.type,
        timestamp: r.timestamp,
        context: r.context || undefined,
        bead_id: r.bead_id || undefined,
        raw_value: r.raw_value,
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Pattern Operations
  // -------------------------------------------------------------------------

  async storePattern(pattern: DecompositionPattern): Promise<void> {
    // Create embedding from pattern content and tags
    const content = `${pattern.content} ${pattern.tags.join(" ")} ${pattern.reason || ""}`;
    const vector = await embed(content);

    const row = {
      id: pattern.id,
      vector,
      content: pattern.content,
      kind: pattern.kind,
      is_negative: pattern.is_negative,
      success_count: pattern.success_count,
      failure_count: pattern.failure_count,
      created_at: pattern.created_at,
      updated_at: pattern.updated_at,
      reason: pattern.reason || "",
      tags: pattern.tags.join(","),
      example_beads: pattern.example_beads.join(","),
    };

    await this.ensureTableAndAdd("patterns", row);
  }

  async getPattern(id: string): Promise<DecompositionPattern | null> {
    const table = await this.getTable("patterns");
    if (!table) return null;

    try {
      const results = await table.query().where(`id = '${id}'`).limit(1).toArray();

      if (results.length === 0) {
        return null;
      }

      const r = results[0] as any;
      return {
        id: r.id,
        content: r.content,
        kind: r.kind,
        is_negative: r.is_negative,
        success_count: r.success_count,
        failure_count: r.failure_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        reason: r.reason || undefined,
        tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
        example_beads: r.example_beads
          ? r.example_beads.split(",").filter((b: string) => b)
          : [],
      };
    } catch {
      return null;
    }
  }

  async getAllPatterns(): Promise<DecompositionPattern[]> {
    const table = await this.getTable("patterns");
    if (!table) return [];

    try {
      // Note: LanceDB query() has a default limit of 10, so we need to explicitly set a higher limit
      const results = await table.query().limit(10000).toArray();

      return results.map((r: any) => ({
        id: r.id,
        content: r.content,
        kind: r.kind,
        is_negative: r.is_negative,
        success_count: r.success_count,
        failure_count: r.failure_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        reason: r.reason || undefined,
        tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
        example_beads: r.example_beads
          ? r.example_beads.split(",").filter((b: string) => b)
          : [],
      }));
    } catch {
      return [];
    }
  }

  async getAntiPatterns(): Promise<DecompositionPattern[]> {
    const table = await this.getTable("patterns");
    if (!table) return [];

    try {
      const results = await table
        .query()
        .where("kind = 'anti_pattern'")
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        content: r.content,
        kind: r.kind,
        is_negative: r.is_negative,
        success_count: r.success_count,
        failure_count: r.failure_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        reason: r.reason || undefined,
        tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
        example_beads: r.example_beads
          ? r.example_beads.split(",").filter((b: string) => b)
          : [],
      }));
    } catch {
      return [];
    }
  }

  async getPatternsByTag(tag: string): Promise<DecompositionPattern[]> {
    const table = await this.getTable("patterns");
    if (!table) return [];

    try {
      const results = await table.query().toArray();

      // Filter by tag in-memory (LanceDB doesn't have LIKE for arrays)
      return results
        .filter((r: any) => {
          const tags = r.tags ? r.tags.split(",") : [];
          return tags.includes(tag);
        })
        .map((r: any) => ({
          id: r.id,
          content: r.content,
          kind: r.kind,
          is_negative: r.is_negative,
          success_count: r.success_count,
          failure_count: r.failure_count,
          created_at: r.created_at,
          updated_at: r.updated_at,
          reason: r.reason || undefined,
          tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
          example_beads: r.example_beads
            ? r.example_beads.split(",").filter((b: string) => b)
            : [],
        }));
    } catch {
      return [];
    }
  }

  async findSimilarPatterns(
    query: string,
    limit: number = 10,
  ): Promise<DecompositionPattern[]> {
    const table = await this.getTable("patterns");
    if (!table) return [];

    try {
      const queryVector = await embed(query);
      const results = await table.vectorSearch(queryVector).limit(limit).toArray();

      return results.map((r: any) => ({
        id: r.id,
        content: r.content,
        kind: r.kind,
        is_negative: r.is_negative,
        success_count: r.success_count,
        failure_count: r.failure_count,
        created_at: r.created_at,
        updated_at: r.updated_at,
        reason: r.reason || undefined,
        tags: r.tags ? r.tags.split(",").filter((t: string) => t) : [],
        example_beads: r.example_beads
          ? r.example_beads.split(",").filter((b: string) => b)
          : [],
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Maturity Operations
  // -------------------------------------------------------------------------

  async storeMaturity(maturity: PatternMaturity): Promise<void> {
    const row = {
      pattern_id: maturity.pattern_id,
      state: maturity.state,
      helpful_count: maturity.helpful_count,
      harmful_count: maturity.harmful_count,
      last_validated: maturity.last_validated,
      promoted_at: maturity.promoted_at || "",
      deprecated_at: maturity.deprecated_at || "",
    };

    await this.ensureTableAndAdd("maturity", row);
  }

  async getMaturity(patternId: string): Promise<PatternMaturity | null> {
    try {
      const table = await this.getTable("maturity");
      if (!table) return null;

      const results = await table
        .query()
        .where(`pattern_id = '${patternId}'`)
        .limit(1)
        .toArray();

      if (results.length === 0) {
        return null;
      }

      const r = results[0] as any;
      return {
        pattern_id: r.pattern_id,
        state: r.state,
        helpful_count: r.helpful_count,
        harmful_count: r.harmful_count,
        last_validated: r.last_validated,
        promoted_at: r.promoted_at || undefined,
        deprecated_at: r.deprecated_at || undefined,
      };
    } catch {
      return null;
    }
  }

  async getAllMaturity(): Promise<PatternMaturity[]> {
    try {
      const table = await this.getTable("maturity");
      if (!table) return [];

      const results = await table.query().toArray();

      return results.map((r: any) => ({
        pattern_id: r.pattern_id,
        state: r.state,
        helpful_count: r.helpful_count,
        harmful_count: r.harmful_count,
        last_validated: r.last_validated,
        promoted_at: r.promoted_at || undefined,
        deprecated_at: r.deprecated_at || undefined,
      }));
    } catch {
      return [];
    }
  }

  async getMaturityByState(state: string): Promise<PatternMaturity[]> {
    try {
      const table = await this.getTable("maturity");
      if (!table) return [];

      const results = await table.query().where(`state = '${state}'`).toArray();

      return results.map((r: any) => ({
        pattern_id: r.pattern_id,
        state: r.state,
        helpful_count: r.helpful_count,
        harmful_count: r.harmful_count,
        last_validated: r.last_validated,
        promoted_at: r.promoted_at || undefined,
        deprecated_at: r.deprecated_at || undefined,
      }));
    } catch {
      return [];
    }
  }

  async storeMaturityFeedback(feedback: MaturityFeedback): Promise<void> {
    const row = {
      id: `${feedback.pattern_id}-${feedback.timestamp}`,
      pattern_id: feedback.pattern_id,
      type: feedback.type,
      timestamp: feedback.timestamp,
      weight: feedback.weight,
    };

    await this.ensureTableAndAdd("maturity-feedback", row);
  }

  async getMaturityFeedback(patternId: string): Promise<MaturityFeedback[]> {
    try {
      const table = await this.getTable("maturity-feedback");
      if (!table) return [];

      const results = await table
        .query()
        .where(`pattern_id = '${patternId}'`)
        .toArray();

      return results.map((r: any) => ({
        pattern_id: r.pattern_id,
        type: r.type,
        timestamp: r.timestamp,
        weight: r.weight,
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Strike Operations
  // -------------------------------------------------------------------------

  async storeStrike(record: StrikeRecord): Promise<void> {
    const row = {
      bead_id: record.bead_id,
      strike_count: record.strike_count,
      failures: JSON.stringify(record.failures),
      first_strike_at: record.first_strike_at || "",
      last_strike_at: record.last_strike_at || "",
    };

    await this.ensureTableAndAdd("strikes", row);
  }

  async getStrike(beadId: string): Promise<StrikeRecord | null> {
    try {
      const table = await this.getTable("strikes");
      if (!table) return null;

      const results = await table
        .query()
        .where(`bead_id = '${beadId}'`)
        .toArray();

      if (results.length === 0) {
        return null;
      }

      // Find the most recent record by last_strike_at
      let mostRecent = results[0] as any;
      for (const r of results) {
        if ((r as any).last_strike_at > mostRecent.last_strike_at) {
          mostRecent = r;
        }
      }

      const r = mostRecent;
      // If strike_count is 0, treat as cleared (return null)
      if (r.strike_count === 0) {
        return null;
      }
      
      return {
        bead_id: r.bead_id,
        strike_count: r.strike_count,
        failures: JSON.parse(r.failures),
        first_strike_at: r.first_strike_at || undefined,
        last_strike_at: r.last_strike_at || undefined,
      };
    } catch {
      return null;
    }
  }

  async getAllStrikes(): Promise<StrikeRecord[]> {
    try {
      const table = await this.getTable("strikes");
      if (!table) return [];

      const results = await table.query().toArray();

      // Group by bead_id and keep only the most recent for each
      const byBead = new Map<string, any>();
      for (const r of results) {
        const existing = byBead.get(r.bead_id);
        if (!existing || r.last_strike_at > existing.last_strike_at) {
          byBead.set(r.bead_id, r);
        }
      }

      return Array.from(byBead.values()).map((r: any) => ({
        bead_id: r.bead_id,
        strike_count: r.strike_count,
        failures: JSON.parse(r.failures),
        first_strike_at: r.first_strike_at || undefined,
        last_strike_at: r.last_strike_at || undefined,
      }));
    } catch {
      return [];
    }
  }

  async clearStrike(beadId: string): Promise<void> {
    // Store an empty strike record with current timestamp to effectively clear it
    // The current timestamp ensures this record is considered "most recent"
    const now = new Date().toISOString();
    const emptyRecord: StrikeRecord = {
      bead_id: beadId,
      strike_count: 0,
      failures: [],
      first_strike_at: undefined,
      last_strike_at: now, // Set timestamp so this is the "most recent" record
    };
    
    await this.storeStrike(emptyRecord);
  }

  // -------------------------------------------------------------------------
  // Error Operations
  // -------------------------------------------------------------------------

  async storeError(entry: ErrorEntry): Promise<void> {
    const row = {
      id: entry.id,
      bead_id: entry.bead_id,
      error_type: entry.error_type,
      message: entry.message,
      stack_trace: entry.stack_trace || "",
      tool_name: entry.tool_name || "",
      timestamp: entry.timestamp,
      resolved: entry.resolved,
      context: entry.context || "",
    };

    await this.ensureTableAndAdd("errors", row);
  }

  async getErrorsByBead(beadId: string): Promise<ErrorEntry[]> {
    try {
      const table = await this.getTable("errors");
      if (!table) return [];

      const results = await table
        .query()
        .where(`bead_id = '${beadId}'`)
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        bead_id: r.bead_id,
        error_type: r.error_type,
        message: r.message,
        stack_trace: r.stack_trace || undefined,
        tool_name: r.tool_name || undefined,
        timestamp: r.timestamp,
        resolved: r.resolved,
        context: r.context || undefined,
      }));
    } catch {
      return [];
    }
  }

  async getUnresolvedErrorsByBead(beadId: string): Promise<ErrorEntry[]> {
    try {
      const table = await this.getTable("errors");
      if (!table) return [];

      const results = await table
        .query()
        .where(`bead_id = '${beadId}' AND resolved = false`)
        .toArray();

      return results.map((r: any) => ({
        id: r.id,
        bead_id: r.bead_id,
        error_type: r.error_type,
        message: r.message,
        stack_trace: r.stack_trace || undefined,
        tool_name: r.tool_name || undefined,
        timestamp: r.timestamp,
        resolved: r.resolved,
        context: r.context || undefined,
      }));
    } catch {
      return [];
    }
  }

  async markErrorResolved(id: string): Promise<void> {
    // LanceDB doesn't support updates, so we need to read all errors,
    // update the one we want, and rewrite the table
    try {
      const table = await this.getTable("errors");
      if (!table) return;

      // Get all errors
      const allErrors = await table.query().toArray();
      
      // Find and update the specific error
      const updatedErrors = allErrors.map((r: any) => {
        if (r.id === id) {
          return { ...r, resolved: true };
        }
        return r;
      });

      // Add the updated record (new version with resolved=true)
      const errorToUpdate = allErrors.find((r: any) => r.id === id);
      if (errorToUpdate) {
        await table.add([{ ...errorToUpdate, resolved: true }]);
      }
    } catch (error) {
      console.error(`[storage] Failed to mark error ${id} as resolved:`, error);
    }
  }

  async getAllErrors(): Promise<ErrorEntry[]> {
    try {
      const table = await this.getTable("errors");
      if (!table) return [];

      const results = await table.query().toArray();

      // Group by id and keep only the most recent for each (for resolved updates)
      const byId = new Map<string, any>();
      for (const r of results) {
        const existing = byId.get(r.id);
        if (!existing || r.timestamp >= existing.timestamp) {
          byId.set(r.id, r);
        }
      }

      return Array.from(byId.values()).map((r: any) => ({
        id: r.id,
        bead_id: r.bead_id,
        error_type: r.error_type,
        message: r.message,
        stack_trace: r.stack_trace || undefined,
        tool_name: r.tool_name || undefined,
        timestamp: r.timestamp,
        resolved: r.resolved,
        context: r.context || undefined,
      }));
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // Specialization Operations
  // -------------------------------------------------------------------------

  async storeSpecializationScore(score: SpecializationScore): Promise<void> {
    const row = {
      agent_id: score.agent_id,
      dimension: score.dimension,
      value: score.value,
      success_count: score.success_count,
      failure_count: score.failure_count,
      avg_duration_ms: score.avg_duration_ms,
      avg_error_count: score.avg_error_count,
      competence: score.competence,
      confidence: score.confidence,
      last_updated: score.last_updated,
    };

    await this.ensureTableAndAdd("specialization-scores", row);
  }

  async getSpecializationScores(
    agentId: string,
    dimension: string,
    value: string,
  ): Promise<SpecializationScore[]> {
    try {
      const table = await this.getTable("specialization-scores");
      if (!table) return [];

      const results = await table
        .query()
        .where(
          `agent_id = '${agentId}' AND dimension = '${dimension}' AND value = '${value}'`,
        )
        .toArray();

      // Group by unique (agent_id, dimension, value) and keep most recent
      const byKey = new Map<string, any>();
      for (const r of results) {
        const key = `${r.agent_id}-${r.dimension}-${r.value}`;
        const existing = byKey.get(key);
        if (!existing || r.last_updated > existing.last_updated) {
          byKey.set(key, r);
        }
      }

      return Array.from(byKey.values()).map((r: any) => ({
        agent_id: r.agent_id,
        dimension: r.dimension,
        value: r.value,
        success_count: r.success_count,
        failure_count: r.failure_count,
        avg_duration_ms: r.avg_duration_ms,
        avg_error_count: r.avg_error_count,
        competence: r.competence,
        confidence: r.confidence,
        last_updated: r.last_updated,
      }));
    } catch {
      return [];
    }
  }

  async getAllSpecializationScores(
    agentId: string,
  ): Promise<SpecializationScore[]> {
    try {
      const table = await this.getTable("specialization-scores");
      if (!table) return [];

      const results = await table
        .query()
        .where(`agent_id = '${agentId}'`)
        .toArray();

      // Group by unique (agent_id, dimension, value) and keep most recent
      const byKey = new Map<string, any>();
      for (const r of results) {
        const key = `${r.agent_id}-${r.dimension}-${r.value}`;
        const existing = byKey.get(key);
        if (!existing || r.last_updated > existing.last_updated) {
          byKey.set(key, r);
        }
      }

      return Array.from(byKey.values()).map((r: any) => ({
        agent_id: r.agent_id,
        dimension: r.dimension,
        value: r.value,
        success_count: r.success_count,
        failure_count: r.failure_count,
        avg_duration_ms: r.avg_duration_ms,
        avg_error_count: r.avg_error_count,
        competence: r.competence,
        confidence: r.confidence,
        last_updated: r.last_updated,
      }));
    } catch {
      return [];
    }
  }

  async findSpecializationScores(
    dimension: string,
    value: string,
  ): Promise<SpecializationScore[]> {
    try {
      const table = await this.getTable("specialization-scores");
      if (!table) return [];

      const results = await table
        .query()
        .where(`dimension = '${dimension}' AND value = '${value}'`)
        .toArray();

      // Group by unique (agent_id, dimension, value) and keep most recent
      const byKey = new Map<string, any>();
      for (const r of results) {
        const key = `${r.agent_id}-${r.dimension}-${r.value}`;
        const existing = byKey.get(key);
        if (!existing || r.last_updated > existing.last_updated) {
          byKey.set(key, r);
        }
      }

      return Array.from(byKey.values()).map((r: any) => ({
        agent_id: r.agent_id,
        dimension: r.dimension,
        value: r.value,
        success_count: r.success_count,
        failure_count: r.failure_count,
        avg_duration_ms: r.avg_duration_ms,
        avg_error_count: r.avg_error_count,
        competence: r.competence,
        confidence: r.confidence,
        last_updated: r.last_updated,
      }));
    } catch {
      return [];
    }
  }

  async storeAgentSpecialization(profile: AgentSpecialization): Promise<void> {
    const row = {
      agent_id: profile.agent_id,
      total_tasks: profile.total_tasks,
      success_rate: profile.success_rate,
      top_specializations: profile.top_specializations.join(","),
      first_seen: profile.first_seen,
      last_seen: profile.last_seen,
      // Store scores separately (they're already in specialization-scores table)
    };

    await this.ensureTableAndAdd("agent-specializations", row);
  }

  async getAgentSpecialization(
    agentId: string,
  ): Promise<AgentSpecialization | null> {
    try {
      const table = await this.getTable("agent-specializations");
      if (!table) return null;

      const results = await table
        .query()
        .where(`agent_id = '${agentId}'`)
        .toArray();

      if (results.length === 0) {
        return null;
      }

      // Find most recent by last_seen
      let mostRecent = results[0] as any;
      for (const r of results) {
        if ((r as any).last_seen > mostRecent.last_seen) {
          mostRecent = r;
        }
      }

      const r = mostRecent;

      // Fetch all scores for this agent
      const scores = await this.getAllSpecializationScores(agentId);

      return {
        agent_id: r.agent_id,
        total_tasks: r.total_tasks,
        success_rate: r.success_rate,
        scores,
        top_specializations: r.top_specializations
          ? r.top_specializations.split(",").filter((s: string) => s)
          : [],
        first_seen: r.first_seen,
        last_seen: r.last_seen,
      };
    } catch {
      return null;
    }
  }

  async getAllAgentSpecializations(): Promise<AgentSpecialization[]> {
    try {
      const table = await this.getTable("agent-specializations");
      if (!table) return [];

      const results = await table.query().toArray();

      // Group by agent_id and keep most recent
      const byAgent = new Map<string, any>();
      for (const r of results) {
        const existing = byAgent.get(r.agent_id);
        if (!existing || r.last_seen > existing.last_seen) {
          byAgent.set(r.agent_id, r);
        }
      }

      // Fetch scores for each agent
      const profiles: AgentSpecialization[] = [];
      for (const r of byAgent.values()) {
        const scores = await this.getAllSpecializationScores(r.agent_id);
        profiles.push({
          agent_id: r.agent_id,
          total_tasks: r.total_tasks,
          success_rate: r.success_rate,
          scores,
          top_specializations: r.top_specializations
            ? r.top_specializations.split(",").filter((s: string) => s)
            : [],
          first_seen: r.first_seen,
          last_seen: r.last_seen,
        });
      }

      return profiles;
    } catch {
      return [];
    }
  }

  async close(): Promise<void> {
    // Close and remove the LanceDB connection for this directory
    const connection = lanceDbInstances.get(this.vectorDir);
    if (connection) {
      // LanceDB connections don't have explicit close, but we remove from cache
      lanceDbInstances.delete(this.vectorDir);
      initializedTables.delete(this.vectorDir);
    }
  }
}



// ============================================================================
// Factory
// ============================================================================

/**
 * Create a storage instance
 *
 * @param config - Storage configuration
 * @returns LanceDB storage instance
 *
 * @example
 * ```typescript
 * // Default LanceDB storage
 * const storage = createStorage();
 *
 * // Custom vector directory
 * const storage = createStorage({
 *   vectorDir: ".custom-vectors",
 * });
 * ```
 */
export function createStorage(
  config: Partial<StorageConfig> = {},
): LearningStorage {
  return new LanceDBStorage(config);
}

// ============================================================================
// Global Storage Instance
// ============================================================================

let globalStorage: LearningStorage | null = null;

/**
 * Get or create the global storage instance
 *
 * Uses LanceDB by default.
 * Creates a new instance on first call, then returns cached instance.
 */
export function getStorage(): LearningStorage {
  if (!globalStorage) {
    globalStorage = createStorage();
  }
  return globalStorage;
}

/**
 * Set the global storage instance
 *
 * Useful for testing or custom configurations.
 */
export function setStorage(storage: LearningStorage): void {
  globalStorage = storage;
}

/**
 * Reset the global storage instance
 */
export async function resetStorage(): Promise<void> {
  if (globalStorage) {
    await globalStorage.close();
    globalStorage = null;
  }
}
