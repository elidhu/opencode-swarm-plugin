/**
 * Swarm Mail Adapter Interface
 *
 * Business logic abstraction for Swarm Mail operations.
 * Built on top of DatabaseAdapter for storage independence.
 *
 * This interface enables:
 * - In-memory testing without database overhead
 * - Alternative storage backends (Redis, IndexedDB, etc.)
 * - Checkpoint/recovery implementations
 * - Eval capture for analysis
 */

import type { AgentEvent } from "../streams/events";

/**
 * Message structure for Swarm Mail
 */
export interface SwarmMessage {
  id: number;
  from_agent: string;
  subject: string;
  body: string;
  thread_id?: string;
  importance: "low" | "normal" | "high" | "urgent";
  ack_required: boolean;
  created_at: number;
}

/**
 * File reservation structure
 */
export interface FileReservation {
  id: number;
  project_key: string;
  agent_name: string;
  path_pattern: string;
  exclusive: boolean;
  reason?: string;
  created_at: number;
  expires_at: number;
  released_at?: number;
}

/**
 * Agent registration structure
 */
export interface AgentInfo {
  id: number;
  project_key: string;
  name: string;
  program: string;
  model: string;
  task_description?: string;
  registered_at: number;
  last_active_at: number;
}

/**
 * Swarm Mail adapter interface
 *
 * Abstracts all Swarm Mail business logic operations.
 * Implementations handle event storage, projections, and queries.
 *
 * @example
 * ```typescript
 * // Register an agent
 * const agent = await adapter.registerAgent(
 *   "my-project",
 *   "agent-1",
 *   { program: "opencode", model: "claude-3-5-sonnet" }
 * );
 *
 * // Send a message
 * const result = await adapter.sendMessage(
 *   "my-project",
 *   "agent-1",
 *   ["agent-2"],
 *   "Hello",
 *   "Message body"
 * );
 *
 * // Reserve files
 * const reservations = await adapter.reserveFiles(
 *   "my-project",
 *   "agent-1",
 *   ["src/file.ts"],
 *   { exclusive: true }
 * );
 * ```
 */
export interface SwarmMailAdapter {
  // =========================================================================
  // Agent Operations
  // =========================================================================

  /**
   * Register a new agent or update existing agent
   *
   * @param projectKey - Project identifier
   * @param agentName - Unique agent name
   * @param options - Agent configuration
   * @returns Agent information
   */
  registerAgent(
    projectKey: string,
    agentName: string,
    options?: {
      program?: string;
      model?: string;
      taskDescription?: string;
    },
  ): Promise<AgentInfo>;

  /**
   * Get agent information
   *
   * @param projectKey - Project identifier
   * @param agentName - Agent name
   * @returns Agent information or null if not found
   */
  getAgent(projectKey: string, agentName: string): Promise<AgentInfo | null>;

  /**
   * List all agents in a project
   *
   * @param projectKey - Project identifier
   * @returns Array of agent information
   */
  listAgents(projectKey: string): Promise<AgentInfo[]>;

  // =========================================================================
  // Message Operations
  // =========================================================================

  /**
   * Send a message to one or more agents
   *
   * @param projectKey - Project identifier
   * @param fromAgent - Sender agent name
   * @param toAgents - Recipient agent names
   * @param subject - Message subject
   * @param body - Message body
   * @param options - Message options
   * @returns Message ID and metadata
   */
  sendMessage(
    projectKey: string,
    fromAgent: string,
    toAgents: string[],
    subject: string,
    body: string,
    options?: {
      threadId?: string;
      importance?: "low" | "normal" | "high" | "urgent";
      ackRequired?: boolean;
    },
  ): Promise<{
    messageId: number;
    threadId?: string;
    recipientCount: number;
  }>;

  /**
   * Get messages for an agent (inbox)
   *
   * @param projectKey - Project identifier
   * @param agentName - Agent name
   * @param options - Query options
   * @returns Array of messages
   */
  getInbox(
    projectKey: string,
    agentName: string,
    options?: {
      limit?: number;
      urgentOnly?: boolean;
      includeBodies?: boolean;
      unreadOnly?: boolean;
    },
  ): Promise<SwarmMessage[]>;

  /**
   * Get a specific message by ID
   *
   * @param projectKey - Project identifier
   * @param messageId - Message ID
   * @returns Message or null if not found
   */
  getMessage(projectKey: string, messageId: number): Promise<SwarmMessage | null>;

  /**
   * Mark a message as read
   *
   * @param projectKey - Project identifier
   * @param messageId - Message ID
   * @param agentName - Agent name
   * @returns Success status
   */
  markMessageRead(
    projectKey: string,
    messageId: number,
    agentName: string,
  ): Promise<{ success: boolean }>;

  /**
   * Acknowledge a message
   *
   * @param projectKey - Project identifier
   * @param messageId - Message ID
   * @param agentName - Agent name
   * @returns Acknowledgement timestamp
   */
  acknowledgeMessage(
    projectKey: string,
    messageId: number,
    agentName: string,
  ): Promise<{ acknowledged: boolean; acknowledgedAt: number }>;

  // =========================================================================
  // File Reservation Operations
  // =========================================================================

  /**
   * Reserve file paths for exclusive or shared access
   *
   * @param projectKey - Project identifier
   * @param agentName - Agent name
   * @param paths - File paths or glob patterns
   * @param options - Reservation options
   * @returns Granted reservations and conflicts
   */
  reserveFiles(
    projectKey: string,
    agentName: string,
    paths: string[],
    options?: {
      reason?: string;
      exclusive?: boolean;
      ttlSeconds?: number;
    },
  ): Promise<{
    granted: FileReservation[];
    conflicts: Array<{ path: string; heldBy: string }>;
  }>;

  /**
   * Release file reservations
   *
   * @param projectKey - Project identifier
   * @param agentName - Agent name
   * @param options - Release options
   * @returns Number of reservations released
   */
  releaseFiles(
    projectKey: string,
    agentName: string,
    options?: {
      paths?: string[];
      reservationIds?: number[];
    },
  ): Promise<{ released: number; releasedAt: number }>;

  /**
   * Get active reservations for an agent
   *
   * @param projectKey - Project identifier
   * @param agentName - Agent name
   * @returns Array of active reservations
   */
  getActiveReservations(
    projectKey: string,
    agentName: string,
  ): Promise<FileReservation[]>;

  /**
   * Check if paths have conflicts with existing reservations
   *
   * @param projectKey - Project identifier
   * @param paths - Paths to check
   * @param excludeAgent - Optionally exclude an agent from conflict check
   * @returns Array of conflicts
   */
  checkReservationConflicts(
    projectKey: string,
    paths: string[],
    excludeAgent?: string,
  ): Promise<Array<{ path: string; heldBy: string; exclusive: boolean }>>;

  // =========================================================================
  // Event Operations
  // =========================================================================

  /**
   * Append an event to the event log
   *
   * @param event - Event to append
   * @returns Event with ID and sequence number
   */
  appendEvent(
    event: AgentEvent,
  ): Promise<AgentEvent & { id: number; sequence: number }>;

  /**
   * Read events with filters
   *
   * @param options - Query options
   * @returns Array of events
   */
  readEvents(options?: {
    projectKey?: string;
    types?: AgentEvent["type"][];
    since?: number;
    until?: number;
    afterSequence?: number;
    limit?: number;
  }): Promise<Array<AgentEvent & { id: number; sequence: number }>>;

  /**
   * Get the latest sequence number for a project
   *
   * @param projectKey - Project identifier (optional)
   * @returns Latest sequence number
   */
  getLatestSequence(projectKey?: string): Promise<number>;

  // =========================================================================
  // Health & Lifecycle
  // =========================================================================

  /**
   * Check if the adapter is healthy
   *
   * @returns Health status
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get adapter statistics
   *
   * @param projectKey - Project identifier (optional)
   * @returns Statistics
   */
  getStats(projectKey?: string): Promise<{
    events: number;
    agents: number;
    messages: number;
    reservations: number;
  }>;

  /**
   * Close the adapter and release resources
   */
  close(): Promise<void>;
}
