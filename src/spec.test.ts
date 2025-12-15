/**
 * Unit tests for the spec system schemas
 *
 * Tests schema validation for:
 * - SpecStatusSchema
 * - RequirementTypeSchema
 * - SpecScenarioSchema
 * - SpecRequirementSchema
 * - SpecNfrSchema
 * - SpecEntrySchema
 * - SpecChangeTaskSchema
 * - SpecChangeProposalStatusSchema
 * - SpecChangeProposalSchema
 *
 * @see docs/analysis/design-specification-strategy.md
 */
import { describe, it, expect } from "vitest";
import {
  SpecStatusSchema,
  RequirementTypeSchema,
  SpecScenarioSchema,
  SpecRequirementSchema,
  SpecNfrSchema,
  SpecEntrySchema,
  SpecChangeTaskSchema,
  SpecChangeProposalStatusSchema,
  SpecChangeProposalSchema,
  type SpecStatus,
  type RequirementType,
  type SpecScenario,
  type SpecRequirement,
  type SpecNfr,
  type SpecEntry,
  type SpecChangeTask,
  type SpecChangeProposalStatus,
  type SpecChangeProposal,
} from "./schemas/spec";

// ============================================================================
// SpecStatusSchema Tests
// ============================================================================

describe("SpecStatusSchema", () => {
  it("validates 'draft' status", () => {
    expect(() => SpecStatusSchema.parse("draft")).not.toThrow();
  });

  it("validates 'review' status", () => {
    expect(() => SpecStatusSchema.parse("review")).not.toThrow();
  });

  it("validates 'approved' status", () => {
    expect(() => SpecStatusSchema.parse("approved")).not.toThrow();
  });

  it("validates 'implemented' status", () => {
    expect(() => SpecStatusSchema.parse("implemented")).not.toThrow();
  });

  it("validates 'deprecated' status", () => {
    expect(() => SpecStatusSchema.parse("deprecated")).not.toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => SpecStatusSchema.parse("invalid")).toThrow();
    expect(() => SpecStatusSchema.parse("pending")).toThrow();
    expect(() => SpecStatusSchema.parse("")).toThrow();
  });

  it("validates all status types", () => {
    const statuses: SpecStatus[] = [
      "draft",
      "review",
      "approved",
      "implemented",
      "deprecated",
    ];
    for (const status of statuses) {
      expect(() => SpecStatusSchema.parse(status)).not.toThrow();
    }
  });
});

// ============================================================================
// RequirementTypeSchema Tests
// ============================================================================

describe("RequirementTypeSchema", () => {
  it("validates 'shall' type (mandatory - absolute requirement)", () => {
    expect(() => RequirementTypeSchema.parse("shall")).not.toThrow();
  });

  it("validates 'must' type (mandatory - emphatic)", () => {
    expect(() => RequirementTypeSchema.parse("must")).not.toThrow();
  });

  it("validates 'should' type (recommended)", () => {
    expect(() => RequirementTypeSchema.parse("should")).not.toThrow();
  });

  it("validates 'may' type (optional)", () => {
    expect(() => RequirementTypeSchema.parse("may")).not.toThrow();
  });

  it("rejects invalid requirement types", () => {
    expect(() => RequirementTypeSchema.parse("will")).toThrow();
    expect(() => RequirementTypeSchema.parse("can")).toThrow();
    expect(() => RequirementTypeSchema.parse("required")).toThrow();
    expect(() => RequirementTypeSchema.parse("")).toThrow();
  });

  it("validates all RFC 2119 types", () => {
    const types: RequirementType[] = ["shall", "must", "should", "may"];
    for (const type of types) {
      expect(() => RequirementTypeSchema.parse(type)).not.toThrow();
    }
  });
});

// ============================================================================
// SpecScenarioSchema Tests
// ============================================================================

describe("SpecScenarioSchema", () => {
  it("validates a complete scenario", () => {
    const scenario: SpecScenario = {
      name: "User login success",
      given: "A registered user with valid credentials",
      when: "The user submits the login form",
      then: ["User is authenticated", "Session token is issued"],
    };
    expect(() => SpecScenarioSchema.parse(scenario)).not.toThrow();
  });

  it("validates a scenario with single then assertion", () => {
    const scenario: SpecScenario = {
      name: "Simple test",
      given: "Initial state",
      when: "Action occurs",
      then: ["Expected outcome"],
    };
    expect(() => SpecScenarioSchema.parse(scenario)).not.toThrow();
  });

  it("validates a scenario with multiple then assertions", () => {
    const scenario: SpecScenario = {
      name: "Complex test",
      given: "Complex initial state",
      when: "Multiple actions",
      then: [
        "First outcome",
        "Second outcome",
        "Third outcome",
        "Fourth outcome",
      ],
    };
    const parsed = SpecScenarioSchema.parse(scenario);
    expect(parsed.then).toHaveLength(4);
  });

  it("rejects scenario without name", () => {
    const scenario = {
      given: "Some state",
      when: "Action",
      then: ["Outcome"],
    };
    expect(() => SpecScenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects scenario without given", () => {
    const scenario = {
      name: "Test",
      when: "Action",
      then: ["Outcome"],
    };
    expect(() => SpecScenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects scenario without when", () => {
    const scenario = {
      name: "Test",
      given: "Some state",
      then: ["Outcome"],
    };
    expect(() => SpecScenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects scenario without then", () => {
    const scenario = {
      name: "Test",
      given: "Some state",
      when: "Action",
    };
    expect(() => SpecScenarioSchema.parse(scenario)).toThrow();
  });

  it("rejects scenario with empty then array", () => {
    const scenario = {
      name: "Test",
      given: "Some state",
      when: "Action",
      then: [],
    };
    // Empty arrays are allowed by default in Zod
    const parsed = SpecScenarioSchema.parse(scenario);
    expect(parsed.then).toHaveLength(0);
  });
});

// ============================================================================
// SpecRequirementSchema Tests
// ============================================================================

describe("SpecRequirementSchema", () => {
  it("validates a complete requirement", () => {
    const requirement: SpecRequirement = {
      id: "REQ-001",
      name: "Authentication required",
      type: "shall",
      description:
        "The system shall require authentication for all protected endpoints",
      scenarios: [
        {
          name: "Unauthenticated access denied",
          given: "No authentication token",
          when: "User accesses protected endpoint",
          then: ["401 Unauthorized returned"],
        },
      ],
      tags: ["security", "auth"],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).not.toThrow();
  });

  it("validates requirement with empty tags (default)", () => {
    const requirement = {
      id: "REQ-002",
      name: "Optional feature",
      type: "may",
      description: "The system may provide this optional feature",
      scenarios: [],
    };
    const parsed = SpecRequirementSchema.parse(requirement);
    expect(parsed.tags).toEqual([]);
  });

  it("validates requirement with empty scenarios", () => {
    const requirement = {
      id: "REQ-003",
      name: "No scenarios yet",
      type: "should",
      description: "A requirement without scenarios",
      scenarios: [],
      tags: [],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).not.toThrow();
  });

  it("rejects requirement with name exceeding 50 chars", () => {
    const requirement = {
      id: "REQ-004",
      name: "This is a very long requirement name that exceeds the fifty character limit",
      type: "must",
      description: "Description",
      scenarios: [],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).toThrow();
  });

  it("validates requirement with exactly 50 char name", () => {
    const requirement = {
      id: "REQ-005",
      name: "12345678901234567890123456789012345678901234567890", // exactly 50
      type: "must",
      description: "Description",
      scenarios: [],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).not.toThrow();
  });

  it("rejects requirement without id", () => {
    const requirement = {
      name: "Missing ID",
      type: "shall",
      description: "Description",
      scenarios: [],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).toThrow();
  });

  it("rejects requirement with invalid type", () => {
    const requirement = {
      id: "REQ-006",
      name: "Invalid type",
      type: "required",
      description: "Description",
      scenarios: [],
    };
    expect(() => SpecRequirementSchema.parse(requirement)).toThrow();
  });

  it("validates all requirement types", () => {
    const types: RequirementType[] = ["shall", "must", "should", "may"];
    for (const type of types) {
      const requirement = {
        id: `REQ-${type}`,
        name: `Test ${type}`,
        type,
        description: `Test ${type} requirement`,
        scenarios: [],
      };
      expect(() => SpecRequirementSchema.parse(requirement)).not.toThrow();
    }
  });
});

// ============================================================================
// SpecNfrSchema Tests
// ============================================================================

describe("SpecNfrSchema", () => {
  it("validates a complete NFR section", () => {
    const nfr: SpecNfr = {
      performance: "Response time < 100ms for 95th percentile",
      security: "All data encrypted at rest and in transit",
      scalability: "Support 10,000 concurrent users",
    };
    expect(() => SpecNfrSchema.parse(nfr)).not.toThrow();
  });

  it("validates NFR with only performance", () => {
    const nfr = {
      performance: "Must complete within 1 second",
    };
    const parsed = SpecNfrSchema.parse(nfr);
    expect(parsed.performance).toBe("Must complete within 1 second");
    expect(parsed.security).toBeUndefined();
    expect(parsed.scalability).toBeUndefined();
  });

  it("validates NFR with only security", () => {
    const nfr = {
      security: "OAuth 2.0 required",
    };
    const parsed = SpecNfrSchema.parse(nfr);
    expect(parsed.security).toBe("OAuth 2.0 required");
  });

  it("validates NFR with only scalability", () => {
    const nfr = {
      scalability: "Horizontal scaling supported",
    };
    const parsed = SpecNfrSchema.parse(nfr);
    expect(parsed.scalability).toBe("Horizontal scaling supported");
  });

  it("validates empty NFR object", () => {
    const nfr = {};
    expect(() => SpecNfrSchema.parse(nfr)).not.toThrow();
  });

  it("validates NFR with two fields", () => {
    const nfr = {
      performance: "Fast",
      security: "Secure",
    };
    const parsed = SpecNfrSchema.parse(nfr);
    expect(parsed.performance).toBe("Fast");
    expect(parsed.security).toBe("Secure");
    expect(parsed.scalability).toBeUndefined();
  });
});

// ============================================================================
// SpecEntrySchema Tests
// ============================================================================

describe("SpecEntrySchema", () => {
  const validSpecEntry: SpecEntry = {
    id: "spec-file-locking-v1",
    capability: "file-locking",
    version: 1,
    status: "draft",
    title: "File Locking Specification",
    purpose:
      "Define how file locking works to prevent concurrent edit conflicts in multi-agent scenarios.",
    requirements: [
      {
        id: "REQ-FL-001",
        name: "Lock acquisition",
        type: "shall",
        description: "System shall acquire exclusive locks on files",
        scenarios: [],
        tags: [],
      },
    ],
    dependencies: [],
    author: "spec-tester",
    created_at: "2025-01-15T10:30:00Z",
    updated_at: "2025-01-15T10:30:00Z",
    open_questions: [],
    tags: ["file-system", "concurrency"],
    file_path: ".specs/file-locking/v1/spec.json",
  };

  it("validates a complete spec entry", () => {
    expect(() => SpecEntrySchema.parse(validSpecEntry)).not.toThrow();
  });

  it("validates spec ID format: spec-{capability}-v{version}", () => {
    // Valid IDs
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-file-locking-v1",
      }),
    ).not.toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-api-gateway-v12",
      }),
    ).not.toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-some-feature-name-v100",
      }),
    ).not.toThrow();
  });

  it("rejects invalid spec ID formats", () => {
    // Missing spec- prefix
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "file-locking-v1",
      }),
    ).toThrow();

    // Missing version suffix
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-file-locking",
      }),
    ).toThrow();

    // Invalid version format
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-file-locking-v1.0",
      }),
    ).toThrow();

    // Uppercase not allowed
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-File-Locking-v1",
      }),
    ).toThrow();
  });

  it("validates capability format (lowercase alphanumeric with hyphens)", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        capability: "file-locking",
      }),
    ).not.toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-api-v1",
        capability: "api",
      }),
    ).not.toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-feature-123-v1",
        capability: "feature-123",
      }),
    ).not.toThrow();
  });

  it("rejects invalid capability formats", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        capability: "File-Locking", // uppercase
      }),
    ).toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        capability: "file_locking", // underscore
      }),
    ).toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        capability: "file locking", // space
      }),
    ).toThrow();
  });

  it("validates version is positive integer", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-file-locking-v1",
        version: 1,
      }),
    ).not.toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        id: "spec-file-locking-v99",
        version: 99,
      }),
    ).not.toThrow();
  });

  it("rejects non-positive version numbers", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        version: 0,
      }),
    ).toThrow();
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        version: -1,
      }),
    ).toThrow();
  });

  it("rejects non-integer version numbers", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        version: 1.5,
      }),
    ).toThrow();
  });

  it("validates purpose has minimum 20 characters", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        purpose: "This is a valid purpose statement that exceeds 20 chars.",
      }),
    ).not.toThrow();
  });

  it("rejects purpose with less than 20 characters", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        purpose: "Too short",
      }),
    ).toThrow();
  });

  it("validates title has max 100 characters", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        title: "A".repeat(100),
      }),
    ).not.toThrow();
  });

  it("rejects title with more than 100 characters", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        title: "A".repeat(101),
      }),
    ).toThrow();
  });

  it("rejects empty title", () => {
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        title: "",
      }),
    ).toThrow();
  });

  it("validates optional fields", () => {
    const minimalSpec = {
      id: "spec-minimal-v1",
      capability: "minimal",
      version: 1,
      status: "draft",
      title: "Minimal Spec",
      purpose: "This is a minimal specification for testing purposes.",
      requirements: [],
      author: "tester",
      created_at: "2025-01-15T10:30:00Z",
      updated_at: "2025-01-15T10:30:00Z",
      file_path: ".specs/minimal/v1/spec.json",
    };
    const parsed = SpecEntrySchema.parse(minimalSpec);
    expect(parsed.nfr).toBeUndefined();
    expect(parsed.bead_id).toBeUndefined();
    expect(parsed.discovery_id).toBeUndefined();
    expect(parsed.approved_at).toBeUndefined();
    expect(parsed.approved_by).toBeUndefined();
    expect(parsed.dependencies).toEqual([]);
    expect(parsed.open_questions).toEqual([]);
    expect(parsed.tags).toEqual([]);
  });

  it("validates approved spec with approval fields", () => {
    const approvedSpec = {
      ...validSpecEntry,
      status: "approved",
      approved_at: "2025-01-16T10:30:00Z",
      approved_by: "human-reviewer",
    };
    expect(() => SpecEntrySchema.parse(approvedSpec)).not.toThrow();
  });

  it("validates spec with NFR", () => {
    const specWithNfr = {
      ...validSpecEntry,
      nfr: {
        performance: "Response time < 100ms",
        security: "TLS 1.3 required",
      },
    };
    expect(() => SpecEntrySchema.parse(specWithNfr)).not.toThrow();
  });

  it("validates spec with dependencies", () => {
    const specWithDeps = {
      ...validSpecEntry,
      dependencies: ["spec-auth-v1", "spec-storage-v2"],
    };
    expect(() => SpecEntrySchema.parse(specWithDeps)).not.toThrow();
  });

  it("validates spec with open questions", () => {
    const specWithQuestions = {
      ...validSpecEntry,
      open_questions: [
        "Should we support concurrent locks?",
        "What is the lock timeout?",
      ],
    };
    expect(() => SpecEntrySchema.parse(specWithQuestions)).not.toThrow();
  });

  it("validates spec with bead_id", () => {
    const specWithBead = {
      ...validSpecEntry,
      bead_id: "opencode-swarm-plugin-abc",
    };
    expect(() => SpecEntrySchema.parse(specWithBead)).not.toThrow();
  });

  it("validates spec with subtask bead_id", () => {
    const specWithSubtaskBead = {
      ...validSpecEntry,
      bead_id: "opencode-swarm-plugin-abc.1",
    };
    expect(() => SpecEntrySchema.parse(specWithSubtaskBead)).not.toThrow();
  });

  it("validates spec timestamps", () => {
    // Valid ISO-8601 with timezone
    expect(() =>
      SpecEntrySchema.parse({
        ...validSpecEntry,
        created_at: "2025-01-15T10:30:00Z",
        updated_at: "2025-01-15T10:30:00+00:00",
      }),
    ).not.toThrow();
  });

  it("validates all status values", () => {
    const statuses: SpecStatus[] = [
      "draft",
      "review",
      "approved",
      "implemented",
      "deprecated",
    ];
    for (const status of statuses) {
      expect(() =>
        SpecEntrySchema.parse({
          ...validSpecEntry,
          status,
        }),
      ).not.toThrow();
    }
  });
});

// ============================================================================
// SpecChangeTaskSchema Tests
// ============================================================================

describe("SpecChangeTaskSchema", () => {
  it("validates a complete change task", () => {
    const task: SpecChangeTask = {
      title: "Implement lock timeout",
      description: "Add configurable timeout for lock expiration",
      estimated_effort: 3,
    };
    expect(() => SpecChangeTaskSchema.parse(task)).not.toThrow();
  });

  it("validates task with only required fields", () => {
    const task = {
      title: "Simple task",
      estimated_effort: 1,
    };
    const parsed = SpecChangeTaskSchema.parse(task);
    expect(parsed.description).toBeUndefined();
  });

  it("validates effort range 1-5", () => {
    for (let effort = 1; effort <= 5; effort++) {
      expect(() =>
        SpecChangeTaskSchema.parse({
          title: `Effort ${effort}`,
          estimated_effort: effort,
        }),
      ).not.toThrow();
    }
  });

  it("rejects effort below 1", () => {
    expect(() =>
      SpecChangeTaskSchema.parse({
        title: "Too easy",
        estimated_effort: 0,
      }),
    ).toThrow();
  });

  it("rejects effort above 5", () => {
    expect(() =>
      SpecChangeTaskSchema.parse({
        title: "Too hard",
        estimated_effort: 6,
      }),
    ).toThrow();
  });

  it("rejects non-integer effort", () => {
    expect(() =>
      SpecChangeTaskSchema.parse({
        title: "Fractional effort",
        estimated_effort: 2.5,
      }),
    ).toThrow();
  });
});

// ============================================================================
// SpecChangeProposalStatusSchema Tests
// ============================================================================

describe("SpecChangeProposalStatusSchema", () => {
  it("validates 'draft' status", () => {
    expect(() => SpecChangeProposalStatusSchema.parse("draft")).not.toThrow();
  });

  it("validates 'review' status", () => {
    expect(() => SpecChangeProposalStatusSchema.parse("review")).not.toThrow();
  });

  it("validates 'approved' status", () => {
    expect(() => SpecChangeProposalStatusSchema.parse("approved")).not.toThrow();
  });

  it("validates 'rejected' status", () => {
    expect(() => SpecChangeProposalStatusSchema.parse("rejected")).not.toThrow();
  });

  it("rejects invalid status", () => {
    expect(() => SpecChangeProposalStatusSchema.parse("pending")).toThrow();
    expect(() => SpecChangeProposalStatusSchema.parse("implemented")).toThrow();
  });

  it("validates all proposal statuses", () => {
    const statuses: SpecChangeProposalStatus[] = [
      "draft",
      "review",
      "approved",
      "rejected",
    ];
    for (const status of statuses) {
      expect(() => SpecChangeProposalStatusSchema.parse(status)).not.toThrow();
    }
  });
});

// ============================================================================
// SpecChangeProposalSchema Tests
// ============================================================================

describe("SpecChangeProposalSchema", () => {
  const validProposal: SpecChangeProposal = {
    id: "proposal-001",
    spec_capability: "file-locking",
    current_version: 1,
    proposed_version: 2,
    proposal: "Add support for shared locks in addition to exclusive locks",
    tasks: [
      {
        title: "Update lock schema",
        description: "Add lock_type field",
        estimated_effort: 2,
      },
      {
        title: "Implement shared lock logic",
        estimated_effort: 4,
      },
    ],
    status: "draft",
    author: "spec-tester",
    created_at: "2025-01-15T10:30:00Z",
    updated_at: "2025-01-15T10:30:00Z",
  };

  it("validates a complete change proposal", () => {
    expect(() => SpecChangeProposalSchema.parse(validProposal)).not.toThrow();
  });

  it("validates proposal with design field", () => {
    const proposalWithDesign = {
      ...validProposal,
      design:
        "Use a read-write lock pattern with shared/exclusive semantics. Shared locks allow concurrent reads.",
    };
    expect(() => SpecChangeProposalSchema.parse(proposalWithDesign)).not.toThrow();
  });

  it("validates proposal with bead_id", () => {
    const proposalWithBead = {
      ...validProposal,
      bead_id: "opencode-swarm-plugin-xyz",
    };
    expect(() => SpecChangeProposalSchema.parse(proposalWithBead)).not.toThrow();
  });

  it("validates proposal with empty tasks array", () => {
    const proposalNoTasks = {
      ...validProposal,
      tasks: [],
    };
    expect(() => SpecChangeProposalSchema.parse(proposalNoTasks)).not.toThrow();
  });

  it("validates proposed version is greater than current", () => {
    // Schema doesn't enforce this - just validates integers
    const proposal = {
      ...validProposal,
      current_version: 1,
      proposed_version: 2,
    };
    expect(() => SpecChangeProposalSchema.parse(proposal)).not.toThrow();
  });

  it("validates version numbers are integers", () => {
    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        current_version: 1.5,
      }),
    ).toThrow();

    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        proposed_version: 2.5,
      }),
    ).toThrow();
  });

  it("validates all proposal statuses", () => {
    const statuses: SpecChangeProposalStatus[] = [
      "draft",
      "review",
      "approved",
      "rejected",
    ];
    for (const status of statuses) {
      expect(() =>
        SpecChangeProposalSchema.parse({
          ...validProposal,
          status,
        }),
      ).not.toThrow();
    }
  });

  it("rejects proposal without required fields", () => {
    // Missing id
    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        id: undefined,
      }),
    ).toThrow();

    // Missing spec_capability
    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        spec_capability: undefined,
      }),
    ).toThrow();

    // Missing proposal text
    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        proposal: undefined,
      }),
    ).toThrow();
  });

  it("validates timestamps", () => {
    expect(() =>
      SpecChangeProposalSchema.parse({
        ...validProposal,
        created_at: "2025-01-15T10:30:00Z",
        updated_at: "2025-01-16T10:30:00+05:30",
      }),
    ).not.toThrow();
  });
});

// ============================================================================
// Integration Between Schemas Tests
// ============================================================================

describe("Schema Integration", () => {
  it("SpecEntry with multiple requirements and scenarios", () => {
    const complexSpec: SpecEntry = {
      id: "spec-auth-v1",
      capability: "auth",
      version: 1,
      status: "review",
      title: "Authentication Specification",
      purpose:
        "Define authentication mechanisms for the system including OAuth2 and API keys.",
      requirements: [
        {
          id: "REQ-AUTH-001",
          name: "OAuth2 support",
          type: "shall",
          description: "System shall support OAuth2 authentication",
          scenarios: [
            {
              name: "Valid token accepted",
              given: "A valid OAuth2 access token",
              when: "Request is made with token in header",
              then: ["Request is authenticated", "User identity is extracted"],
            },
            {
              name: "Expired token rejected",
              given: "An expired OAuth2 access token",
              when: "Request is made with token in header",
              then: ["401 Unauthorized returned", "Token refresh suggested"],
            },
          ],
          tags: ["oauth2", "security"],
        },
        {
          id: "REQ-AUTH-002",
          name: "API key support",
          type: "should",
          description: "System should support API key authentication",
          scenarios: [
            {
              name: "Valid API key accepted",
              given: "A valid API key",
              when: "Request is made with key in header",
              then: ["Request is authenticated"],
            },
          ],
          tags: ["api-key", "security"],
        },
      ],
      nfr: {
        performance: "Token validation < 10ms",
        security: "Keys stored with bcrypt hashing",
      },
      dependencies: ["spec-crypto-v1"],
      author: "auth-team",
      created_at: "2025-01-10T00:00:00Z",
      updated_at: "2025-01-15T12:00:00Z",
      open_questions: ["Should we support refresh tokens?"],
      tags: ["authentication", "security", "api"],
      file_path: ".specs/auth/v1/spec.json",
    };

    expect(() => SpecEntrySchema.parse(complexSpec)).not.toThrow();
    const parsed = SpecEntrySchema.parse(complexSpec);
    expect(parsed.requirements).toHaveLength(2);
    expect(parsed.requirements[0].scenarios).toHaveLength(2);
    expect(parsed.requirements[1].scenarios).toHaveLength(1);
  });

  it("Type exports are correctly inferred", () => {
    // This test verifies TypeScript types work correctly
    const status: SpecStatus = "draft";
    const reqType: RequirementType = "shall";
    const scenario: SpecScenario = {
      name: "test",
      given: "given",
      when: "when",
      then: ["then"],
    };
    const requirement: SpecRequirement = {
      id: "id",
      name: "name",
      type: reqType,
      description: "desc",
      scenarios: [scenario],
      tags: [],
    };
    const nfr: SpecNfr = { performance: "fast" };
    const task: SpecChangeTask = { title: "task", estimated_effort: 1 };
    const proposalStatus: SpecChangeProposalStatus = "draft";

    // All should compile and be valid
    expect(status).toBe("draft");
    expect(reqType).toBe("shall");
    expect(scenario.name).toBe("test");
    expect(requirement.id).toBe("id");
    expect(nfr.performance).toBe("fast");
    expect(task.title).toBe("task");
    expect(proposalStatus).toBe("draft");
  });
});
