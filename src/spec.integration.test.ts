/**
 * Integration tests for the spec system
 *
 * Tests the end-to-end specification workflow:
 * - draft → submit → approve → implement flow
 *
 * NOTE: These tests require the spec.ts implementation which may not be
 * available yet. Tests are structured to work when the implementation exists.
 *
 * Run with: bun test src/spec.integration.test.ts
 *
 * @see docs/analysis/design-specification-strategy.md
 */
import { describe, it, expect } from "vitest";
import {
  SpecEntrySchema,
  SpecChangeProposalSchema,
  type SpecEntry,
  type SpecChangeProposal,
} from "./schemas/spec";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Create a valid draft spec entry for testing
 */
function createTestSpec(overrides: Partial<SpecEntry> = {}): SpecEntry {
  const now = new Date().toISOString();
  return {
    id: "spec-test-feature-v1",
    capability: "test-feature",
    version: 1,
    status: "draft",
    title: "Test Feature Specification",
    purpose:
      "Define the test feature functionality for integration testing purposes.",
    requirements: [
      {
        id: "REQ-TF-001",
        name: "Basic functionality",
        type: "shall",
        description: "The system shall provide basic test functionality",
        scenarios: [
          {
            name: "Happy path",
            given: "System is initialized",
            when: "Test action is performed",
            then: ["Expected result is returned"],
          },
        ],
        tags: ["core"],
      },
    ],
    dependencies: [],
    author: "test-agent",
    created_at: now,
    updated_at: now,
    open_questions: [],
    tags: ["test", "integration"],
    file_path: ".specs/test-feature/v1/spec.json",
    ...overrides,
  };
}

/**
 * Create a valid change proposal for testing
 */
function createTestProposal(
  overrides: Partial<SpecChangeProposal> = {},
): SpecChangeProposal {
  const now = new Date().toISOString();
  return {
    id: "proposal-test-001",
    spec_capability: "test-feature",
    current_version: 1,
    proposed_version: 2,
    proposal: "Add new capability to the test feature",
    tasks: [
      {
        title: "Implement new capability",
        description: "Add the implementation",
        estimated_effort: 3,
      },
    ],
    status: "draft",
    author: "test-agent",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// ============================================================================
// Schema Validation Integration Tests
// ============================================================================

describe("Spec Schema Integration", () => {
  describe("Draft Spec Validation", () => {
    it("creates a valid draft spec", () => {
      const spec = createTestSpec({ status: "draft" });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.status).toBe("draft");
      expect(parsed.approved_at).toBeUndefined();
      expect(parsed.approved_by).toBeUndefined();
    });

    it("draft spec can have open questions", () => {
      const spec = createTestSpec({
        status: "draft",
        open_questions: [
          "What is the expected performance?",
          "Should we support caching?",
        ],
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.open_questions).toHaveLength(2);
    });

    it("draft spec validates requirements structure", () => {
      const spec = createTestSpec({
        requirements: [
          {
            id: "REQ-001",
            name: "First requirement",
            type: "shall",
            description: "Must do this",
            scenarios: [],
            tags: [],
          },
          {
            id: "REQ-002",
            name: "Second requirement",
            type: "should",
            description: "Should do this",
            scenarios: [],
            tags: [],
          },
        ],
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.requirements).toHaveLength(2);
      expect(parsed.requirements[0].type).toBe("shall");
      expect(parsed.requirements[1].type).toBe("should");
    });
  });

  describe("Spec Status Transitions", () => {
    it("draft -> review transition", () => {
      const draft = createTestSpec({ status: "draft" });
      const review = createTestSpec({
        ...draft,
        status: "review",
        updated_at: new Date().toISOString(),
      });
      const parsed = SpecEntrySchema.parse(review);
      expect(parsed.status).toBe("review");
    });

    it("review -> approved transition with approval metadata", () => {
      const review = createTestSpec({ status: "review" });
      const approved = createTestSpec({
        ...review,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "human-reviewer",
        open_questions: [], // cleared on approval
        updated_at: new Date().toISOString(),
      });
      const parsed = SpecEntrySchema.parse(approved);
      expect(parsed.status).toBe("approved");
      expect(parsed.approved_at).toBeDefined();
      expect(parsed.approved_by).toBe("human-reviewer");
      expect(parsed.open_questions).toHaveLength(0);
    });

    it("approved -> implemented transition", () => {
      const approved = createTestSpec({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "reviewer",
      });
      const implemented = createTestSpec({
        ...approved,
        status: "implemented",
        updated_at: new Date().toISOString(),
      });
      const parsed = SpecEntrySchema.parse(implemented);
      expect(parsed.status).toBe("implemented");
      // Approval metadata should be preserved
      expect(parsed.approved_at).toBeDefined();
      expect(parsed.approved_by).toBe("reviewer");
    });

    it("any status -> deprecated transition", () => {
      const statuses = ["draft", "review", "approved", "implemented"] as const;
      for (const status of statuses) {
        const spec = createTestSpec({ status });
        const deprecated = createTestSpec({
          ...spec,
          status: "deprecated",
          updated_at: new Date().toISOString(),
        });
        const parsed = SpecEntrySchema.parse(deprecated);
        expect(parsed.status).toBe("deprecated");
      }
    });
  });

  describe("Submit Validation Rules", () => {
    it("spec with open questions should block submission", () => {
      // This test documents the expected behavior when spec_submit is implemented
      // A spec with open questions should NOT be submittable for review
      const specWithQuestions = createTestSpec({
        status: "draft",
        open_questions: ["Unresolved question here"],
      });

      // The schema validates, but business logic should block submission
      const parsed = SpecEntrySchema.parse(specWithQuestions);
      expect(parsed.open_questions).toHaveLength(1);

      // When spec_submit is implemented, it should check:
      // if (spec.open_questions.length > 0) throw new Error("Cannot submit spec with open questions")
    });

    it("spec without requirements should block submission", () => {
      // A spec without requirements shouldn't be submittable
      const emptySpec = createTestSpec({
        status: "draft",
        requirements: [],
      });

      const parsed = SpecEntrySchema.parse(emptySpec);
      expect(parsed.requirements).toHaveLength(0);

      // When spec_submit is implemented, it should check:
      // if (spec.requirements.length === 0) throw new Error("Cannot submit spec without requirements")
    });

    it("valid spec can be submitted for review", () => {
      // A valid spec with requirements and no open questions should be submittable
      const validSpec = createTestSpec({
        status: "draft",
        requirements: [
          {
            id: "REQ-001",
            name: "Core requirement",
            type: "shall",
            description: "The system shall do something",
            scenarios: [
              {
                name: "Test scenario",
                given: "Precondition",
                when: "Action",
                then: ["Result"],
              },
            ],
            tags: [],
          },
        ],
        open_questions: [], // No open questions
      });

      const parsed = SpecEntrySchema.parse(validSpec);
      expect(parsed.requirements.length).toBeGreaterThan(0);
      expect(parsed.open_questions).toHaveLength(0);
      // This spec should be valid for submission
    });
  });

  describe("Change Proposal Flow", () => {
    it("creates a valid change proposal", () => {
      const proposal = createTestProposal();
      const parsed = SpecChangeProposalSchema.parse(proposal);
      expect(parsed.status).toBe("draft");
      expect(parsed.current_version).toBe(1);
      expect(parsed.proposed_version).toBe(2);
    });

    it("proposal draft -> review transition", () => {
      const draft = createTestProposal({ status: "draft" });
      const review = {
        ...draft,
        status: "review" as const,
        updated_at: new Date().toISOString(),
      };
      const parsed = SpecChangeProposalSchema.parse(review);
      expect(parsed.status).toBe("review");
    });

    it("proposal review -> approved transition", () => {
      const review = createTestProposal({ status: "review" });
      const approved = {
        ...review,
        status: "approved" as const,
        updated_at: new Date().toISOString(),
      };
      const parsed = SpecChangeProposalSchema.parse(approved);
      expect(parsed.status).toBe("approved");
    });

    it("proposal review -> rejected transition", () => {
      const review = createTestProposal({ status: "review" });
      const rejected = {
        ...review,
        status: "rejected" as const,
        updated_at: new Date().toISOString(),
      };
      const parsed = SpecChangeProposalSchema.parse(rejected);
      expect(parsed.status).toBe("rejected");
    });

    it("proposal links to bead for tracking", () => {
      const proposal = createTestProposal({
        bead_id: "opencode-swarm-plugin-abc",
      });
      const parsed = SpecChangeProposalSchema.parse(proposal);
      expect(parsed.bead_id).toBe("opencode-swarm-plugin-abc");
    });
  });

  describe("Version Management", () => {
    it("creates new version of spec", () => {
      const v1 = createTestSpec({
        id: "spec-versioned-v1",
        capability: "versioned",
        version: 1,
        status: "implemented",
      });

      const v2 = createTestSpec({
        id: "spec-versioned-v2",
        capability: "versioned",
        version: 2,
        status: "draft",
        dependencies: ["spec-versioned-v1"], // depends on previous version
      });

      const parsedV1 = SpecEntrySchema.parse(v1);
      const parsedV2 = SpecEntrySchema.parse(v2);

      expect(parsedV1.version).toBe(1);
      expect(parsedV2.version).toBe(2);
      expect(parsedV2.dependencies).toContain("spec-versioned-v1");
    });

    it("deprecates old version when new version is approved", () => {
      const oldVersion = createTestSpec({
        id: "spec-feature-v1",
        capability: "feature",
        version: 1,
        status: "deprecated",
      });

      const newVersion = createTestSpec({
        id: "spec-feature-v2",
        capability: "feature",
        version: 2,
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "reviewer",
      });

      const parsedOld = SpecEntrySchema.parse(oldVersion);
      const parsedNew = SpecEntrySchema.parse(newVersion);

      expect(parsedOld.status).toBe("deprecated");
      expect(parsedNew.status).toBe("approved");
    });
  });

  describe("Dependencies and Relationships", () => {
    it("spec can depend on multiple other specs", () => {
      const spec = createTestSpec({
        dependencies: ["spec-auth-v1", "spec-storage-v2", "spec-api-v1"],
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.dependencies).toHaveLength(3);
      expect(parsed.dependencies).toContain("spec-auth-v1");
      expect(parsed.dependencies).toContain("spec-storage-v2");
      expect(parsed.dependencies).toContain("spec-api-v1");
    });

    it("spec can link to discovery", () => {
      const spec = createTestSpec({
        discovery_id: "discovery-file-locking-001",
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.discovery_id).toBe("discovery-file-locking-001");
    });

    it("spec can link to bead for tracking", () => {
      const spec = createTestSpec({
        bead_id: "opencode-swarm-plugin-xyz",
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.bead_id).toBe("opencode-swarm-plugin-xyz");
    });

    it("spec can link to subtask bead", () => {
      const spec = createTestSpec({
        bead_id: "opencode-swarm-plugin-xyz.3",
      });
      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.bead_id).toBe("opencode-swarm-plugin-xyz.3");
    });
  });

  describe("Requirements with Scenarios", () => {
    it("requirement has multiple scenarios", () => {
      const spec = createTestSpec({
        requirements: [
          {
            id: "REQ-001",
            name: "File locking",
            type: "shall",
            description: "System shall support file locking",
            scenarios: [
              {
                name: "Acquire lock success",
                given: "File is not locked",
                when: "Agent requests lock",
                then: ["Lock is acquired", "Lock ID is returned"],
              },
              {
                name: "Acquire lock conflict",
                given: "File is already locked by another agent",
                when: "Agent requests lock",
                then: ["Lock request fails", "Error indicates conflict"],
              },
              {
                name: "Release lock",
                given: "Agent holds lock on file",
                when: "Agent releases lock",
                then: ["Lock is released", "File is available"],
              },
            ],
            tags: ["locking", "concurrency"],
          },
        ],
      });

      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.requirements[0].scenarios).toHaveLength(3);
      expect(parsed.requirements[0].scenarios[0].then).toHaveLength(2);
    });

    it("scenarios use Given-When-Then format", () => {
      const spec = createTestSpec({
        requirements: [
          {
            id: "REQ-001",
            name: "Test",
            type: "shall",
            description: "Test requirement",
            scenarios: [
              {
                name: "BDD style scenario",
                given: "An initial context or state",
                when: "An action or event occurs",
                then: [
                  "An expected outcome",
                  "Another expected outcome",
                  "Yet another outcome",
                ],
              },
            ],
            tags: [],
          },
        ],
      });

      const parsed = SpecEntrySchema.parse(spec);
      const scenario = parsed.requirements[0].scenarios[0];
      expect(scenario.given).toBeTruthy();
      expect(scenario.when).toBeTruthy();
      expect(scenario.then.length).toBeGreaterThan(0);
    });
  });

  describe("NFR (Non-Functional Requirements)", () => {
    it("spec with complete NFR section", () => {
      const spec = createTestSpec({
        nfr: {
          performance: "Response time < 50ms at p95",
          security: "All data encrypted with AES-256",
          scalability: "Support 100,000 concurrent connections",
        },
      });

      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.nfr).toBeDefined();
      expect(parsed.nfr?.performance).toContain("50ms");
      expect(parsed.nfr?.security).toContain("AES-256");
      expect(parsed.nfr?.scalability).toContain("100,000");
    });

    it("spec with partial NFR section", () => {
      const spec = createTestSpec({
        nfr: {
          security: "OAuth 2.0 with PKCE required",
        },
      });

      const parsed = SpecEntrySchema.parse(spec);
      expect(parsed.nfr?.security).toContain("OAuth");
      expect(parsed.nfr?.performance).toBeUndefined();
      expect(parsed.nfr?.scalability).toBeUndefined();
    });
  });
});

// ============================================================================
// Semantic Search Integration Tests (placeholder for when spec_query exists)
// ============================================================================

describe("Spec Query Integration", () => {
  // These tests document expected behavior when spec_query is implemented

  it("placeholder: should find specs by capability keyword", () => {
    // When spec_query is implemented:
    // const results = await spec_query("file locking");
    // expect(results).toContainEqual(expect.objectContaining({ capability: "file-locking" }));

    // For now, just verify the spec structure supports search
    const spec = createTestSpec({
      capability: "file-locking",
      title: "File Locking Specification",
      purpose: "Define file locking mechanisms for concurrent access control",
      tags: ["locking", "concurrency", "files"],
    });
    const parsed = SpecEntrySchema.parse(spec);

    // These fields would be used for semantic search
    expect(parsed.capability).toContain("locking");
    expect(parsed.title).toContain("Locking");
    expect(parsed.purpose).toContain("locking");
    expect(parsed.tags).toContain("locking");
  });

  it("placeholder: should find specs by requirement description", () => {
    // When spec_query is implemented:
    // const results = await spec_query("authentication");
    // expect(results[0].requirements).toContainEqual(
    //   expect.objectContaining({ description: expect.stringContaining("auth") })
    // );

    const spec = createTestSpec({
      requirements: [
        {
          id: "REQ-001",
          name: "Auth required",
          type: "shall",
          description: "All endpoints require OAuth2 authentication",
          scenarios: [],
          tags: ["auth"],
        },
      ],
    });
    const parsed = SpecEntrySchema.parse(spec);

    // Requirements have searchable descriptions
    expect(parsed.requirements[0].description).toContain("authentication");
  });

  it("placeholder: should filter specs by status", () => {
    // When spec_query is implemented:
    // const results = await spec_query("*", { status: "approved" });
    // expect(results.every(s => s.status === "approved")).toBe(true);

    const approvedSpec = createTestSpec({ status: "approved" });
    const draftSpec = createTestSpec({ status: "draft" });

    expect(approvedSpec.status).toBe("approved");
    expect(draftSpec.status).toBe("draft");
  });

  it("placeholder: should find specs by tags", () => {
    // When spec_query is implemented:
    // const results = await spec_query({ tags: ["security"] });

    const spec = createTestSpec({
      tags: ["security", "authentication", "api"],
    });
    const parsed = SpecEntrySchema.parse(spec);

    expect(parsed.tags).toContain("security");
    expect(parsed.tags).toContain("authentication");
  });
});

// ============================================================================
// Workflow End-to-End Tests
// ============================================================================

describe("Complete Spec Lifecycle", () => {
  it("simulates complete draft -> submit -> approve -> implement flow", () => {
    const now = () => new Date().toISOString();

    // Step 1: Create draft
    const draft = createTestSpec({
      id: "spec-lifecycle-test-v1",
      capability: "lifecycle-test",
      status: "draft",
      open_questions: ["What is the timeout value?"],
      created_at: now(),
      updated_at: now(),
    });
    expect(SpecEntrySchema.parse(draft).status).toBe("draft");

    // Step 2: Resolve open questions and submit for review
    const forReview: SpecEntry = {
      ...draft,
      status: "review",
      open_questions: [], // Questions resolved
      updated_at: now(),
    };
    const reviewParsed = SpecEntrySchema.parse(forReview);
    expect(reviewParsed.status).toBe("review");
    expect(reviewParsed.open_questions).toHaveLength(0);

    // Step 3: Human approves spec
    const approved: SpecEntry = {
      ...forReview,
      status: "approved",
      approved_at: now(),
      approved_by: "human-reviewer@example.com",
      updated_at: now(),
    };
    const approvedParsed = SpecEntrySchema.parse(approved);
    expect(approvedParsed.status).toBe("approved");
    expect(approvedParsed.approved_by).toBe("human-reviewer@example.com");

    // Step 4: Implementation complete
    const implemented: SpecEntry = {
      ...approved,
      status: "implemented",
      updated_at: now(),
    };
    const implementedParsed = SpecEntrySchema.parse(implemented);
    expect(implementedParsed.status).toBe("implemented");

    // Verify approval metadata preserved
    expect(implementedParsed.approved_at).toBe(approved.approved_at);
    expect(implementedParsed.approved_by).toBe(approved.approved_by);
  });

  it("simulates change proposal flow for existing spec", () => {
    const now = () => new Date().toISOString();

    // Existing implemented spec v1
    const existingSpec = createTestSpec({
      id: "spec-existing-v1",
      capability: "existing",
      version: 1,
      status: "implemented",
    });

    // Step 1: Create change proposal
    const proposal = createTestProposal({
      spec_capability: "existing",
      current_version: 1,
      proposed_version: 2,
      proposal: "Add caching support to improve performance",
      tasks: [
        { title: "Add cache layer", estimated_effort: 3 },
        { title: "Update tests", estimated_effort: 2 },
      ],
      status: "draft",
    });
    expect(SpecChangeProposalSchema.parse(proposal).status).toBe("draft");

    // Step 2: Submit for review
    const proposalForReview: SpecChangeProposal = {
      ...proposal,
      status: "review",
      updated_at: now(),
    };
    expect(SpecChangeProposalSchema.parse(proposalForReview).status).toBe("review");

    // Step 3: Proposal approved
    const approvedProposal: SpecChangeProposal = {
      ...proposalForReview,
      status: "approved",
      updated_at: now(),
    };
    expect(SpecChangeProposalSchema.parse(approvedProposal).status).toBe("approved");

    // Step 4: Create new spec version
    const newSpecVersion = createTestSpec({
      id: "spec-existing-v2",
      capability: "existing",
      version: 2,
      status: "draft",
      dependencies: ["spec-existing-v1"],
    });
    expect(SpecEntrySchema.parse(newSpecVersion).version).toBe(2);

    // Step 5: Deprecate old version when new one is approved
    const deprecatedOld: SpecEntry = {
      ...existingSpec,
      status: "deprecated",
      updated_at: now(),
    };
    expect(SpecEntrySchema.parse(deprecatedOld).status).toBe("deprecated");
  });
});
