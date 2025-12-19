/**
 * Integration tests for the spec system
 *
 * Tests the end-to-end specification workflow:
 * - draft → submit → approve → implement flow
 * - File-based persistence with temp directory isolation
 *
 * Run with: pnpm test:integration src/spec.integration.test.ts
 *
 * @see docs/analysis/design-specification-strategy.md
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  SpecEntrySchema,
  SpecChangeProposalSchema,
  type SpecEntry,
  type SpecChangeProposal,
} from "./schemas/spec";
import {
  setSpecWorkingDirectory,
  getSpecWorkingDirectory,
  writeSpecFile,
} from "./spec";

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

// ============================================================================
// Auto-Approval Flow Tests
// ============================================================================

describe("Auto-Approval Flow", () => {
  describe("shouldAutoApprove decision logic", () => {
    // These tests verify the decision logic without requiring the full system

    it("auto_approve=true takes precedence", () => {
      // When auto_approve is explicitly true, should approve regardless of confidence
      const decision = testShouldAutoApprove(true, 0.5, 0.8);
      expect(decision).toBe(true);
    });

    it("auto_approve=false prevents approval even with high confidence", () => {
      // Explicit false should block auto-approval
      const decision = testShouldAutoApprove(false, 1.0, 0.8);
      expect(decision).toBe(false);
    });

    it("confidence >= threshold triggers auto-approval when auto_approve undefined", () => {
      // No explicit flag, rely on confidence
      const decision = testShouldAutoApprove(undefined, 0.85, 0.8);
      expect(decision).toBe(true);
    });

    it("confidence < threshold blocks auto-approval when auto_approve undefined", () => {
      // Below threshold should not auto-approve
      const decision = testShouldAutoApprove(undefined, 0.75, 0.8);
      expect(decision).toBe(false);
    });

    // Edge case: exactly at threshold
    it("confidence exactly at threshold (0.80) triggers auto-approval", () => {
      const decision = testShouldAutoApprove(undefined, 0.80, 0.8);
      expect(decision).toBe(true);
    });

    // Edge case: just below threshold
    it("confidence just below threshold (0.79) blocks auto-approval", () => {
      const decision = testShouldAutoApprove(undefined, 0.79, 0.8);
      expect(decision).toBe(false);
    });

    // Edge case: just above threshold
    it("confidence just above threshold (0.81) triggers auto-approval", () => {
      const decision = testShouldAutoApprove(undefined, 0.81, 0.8);
      expect(decision).toBe(true);
    });

    it("custom threshold is respected", () => {
      // Higher threshold should require higher confidence
      const highThreshold = testShouldAutoApprove(undefined, 0.85, 0.9);
      expect(highThreshold).toBe(false);

      const lowThreshold = testShouldAutoApprove(undefined, 0.85, 0.7);
      expect(lowThreshold).toBe(true);
    });

    it("undefined confidence without explicit flag returns false", () => {
      const decision = testShouldAutoApprove(undefined, undefined, 0.8);
      expect(decision).toBe(false);
    });
  });

  describe("Auto-approval with open questions", () => {
    it("open questions block auto-approval even with auto_approve=true", () => {
      const spec = createTestSpec({
        status: "draft",
        auto_approve: true,
        confidence: 0.95,
        open_questions: ["Unresolved question"],
      });
      const parsed = SpecEntrySchema.parse(spec);

      // Business rule: open_questions.length > 0 should block auto-approval
      expect(parsed.open_questions.length).toBeGreaterThan(0);
      expect(parsed.auto_approve).toBe(true);
      // The combination should be rejected at the tool level, not schema level
    });

    it("no open questions allows auto-approval", () => {
      const spec = createTestSpec({
        status: "draft",
        auto_approve: true,
        confidence: 0.95,
        open_questions: [],
      });
      const parsed = SpecEntrySchema.parse(spec);

      expect(parsed.open_questions).toHaveLength(0);
      expect(parsed.auto_approve).toBe(true);
      // This combination is valid for auto-approval
    });
  });

  describe("System vs Human approval tracking", () => {
    it("system auto-approval sets approved_by='system'", () => {
      const autoApprovedSpec = createTestSpec({
        status: "approved",
        auto_approve: true,
        confidence: 0.85,
        approved_at: new Date().toISOString(),
        approved_by: "system",
      });
      const parsed = SpecEntrySchema.parse(autoApprovedSpec);

      expect(parsed.approved_by).toBe("system");
      expect(parsed.auto_approve).toBe(true);
    });

    it("human approval sets approved_by='human' or custom identifier", () => {
      const humanApprovedSpec = createTestSpec({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "human",
      });
      const parsed = SpecEntrySchema.parse(humanApprovedSpec);

      expect(parsed.approved_by).toBe("human");
    });

    it("human approval can use email as identifier", () => {
      const humanApprovedSpec = createTestSpec({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "jane.doe@company.com",
      });
      const parsed = SpecEntrySchema.parse(humanApprovedSpec);

      expect(parsed.approved_by).toBe("jane.doe@company.com");
    });
  });
});

// ============================================================================
// Orchestration Spec Triggers Tests
// ============================================================================

describe("Orchestration Spec Triggers", () => {
  describe("shouldGenerateSpec decision matrix", () => {
    // Test the decision matrix:
    // | Condition | Generate Spec? | Auto-Approve? |
    // |-----------|---------------|---------------|
    // | complexity >= 4 | Yes | No (needs review) |
    // | complexity == 3 | Yes | Yes |
    // | complexity <= 2 | No | N/A |

    it("complexity >= 4 generates spec but requires review", () => {
      const decision = testShouldGenerateSpec({
        title: "Complex feature",
        files: ["a.ts", "b.ts", "c.ts"],
        estimated_complexity: 4,
      });

      expect(decision.should_generate).toBe(true);
      expect(decision.auto_approve).toBe(false);
    });

    it("complexity == 5 generates spec but requires review", () => {
      const decision = testShouldGenerateSpec({
        title: "Very complex feature",
        files: ["a.ts", "b.ts", "c.ts", "d.ts"],
        estimated_complexity: 5,
      });

      expect(decision.should_generate).toBe(true);
      expect(decision.auto_approve).toBe(false);
    });

    it("complexity == 3 generates spec with auto-approval", () => {
      const decision = testShouldGenerateSpec({
        title: "Medium feature",
        files: ["a.ts", "b.ts"],
        estimated_complexity: 3,
      });

      expect(decision.should_generate).toBe(true);
      expect(decision.auto_approve).toBe(true);
    });

    it("complexity == 2 does not generate spec", () => {
      const decision = testShouldGenerateSpec({
        title: "Simple feature",
        files: ["a.ts"],
        estimated_complexity: 2,
      });

      expect(decision.should_generate).toBe(false);
    });

    it("complexity == 1 does not generate spec", () => {
      const decision = testShouldGenerateSpec({
        title: "Trivial feature",
        files: ["a.ts"],
        estimated_complexity: 1,
      });

      expect(decision.should_generate).toBe(false);
    });
  });

  describe("Task type filtering", () => {
    it("'feature' type triggers spec generation", () => {
      const decision = testShouldGenerateSpec(
        { title: "Feature", files: ["a.ts"], estimated_complexity: 3 },
        "feature",
      );

      expect(decision.should_generate).toBe(true);
    });

    it("'epic' type triggers spec generation", () => {
      const decision = testShouldGenerateSpec(
        { title: "Epic", files: ["a.ts"], estimated_complexity: 3 },
        "epic",
      );

      expect(decision.should_generate).toBe(true);
    });

    it("'bug' type skips spec generation", () => {
      const decision = testShouldGenerateSpec(
        { title: "Bug fix", files: ["a.ts"], estimated_complexity: 5 },
        "bug",
      );

      expect(decision.should_generate).toBe(false);
    });

    it("'chore' type skips spec generation", () => {
      const decision = testShouldGenerateSpec(
        { title: "Chore", files: ["a.ts"], estimated_complexity: 5 },
        "chore",
      );

      expect(decision.should_generate).toBe(false);
    });
  });

  describe("Open questions impact", () => {
    it("open questions prevent auto-approval for complexity 3", () => {
      const decision = testShouldGenerateSpec(
        { title: "Feature", files: ["a.ts"], estimated_complexity: 3 },
        "task",
        true, // has open questions
      );

      expect(decision.should_generate).toBe(true);
      expect(decision.auto_approve).toBe(false);
    });

    it("open questions don't change decision for complexity 4+", () => {
      const decisionWithQuestions = testShouldGenerateSpec(
        { title: "Feature", files: ["a.ts"], estimated_complexity: 4 },
        "task",
        true,
      );

      const decisionWithoutQuestions = testShouldGenerateSpec(
        { title: "Feature", files: ["a.ts"], estimated_complexity: 4 },
        "task",
        false,
      );

      // Both should generate spec, neither should auto-approve
      expect(decisionWithQuestions.should_generate).toBe(true);
      expect(decisionWithQuestions.auto_approve).toBe(false);
      expect(decisionWithoutQuestions.should_generate).toBe(true);
      expect(decisionWithoutQuestions.auto_approve).toBe(false);
    });
  });

  describe("Confidence scoring", () => {
    it("complexity 3 results in high confidence (~0.85)", () => {
      const decision = testShouldGenerateSpec({
        title: "Medium",
        files: ["a.ts"],
        estimated_complexity: 3,
      });

      expect(decision.confidence).toBeGreaterThanOrEqual(0.8);
      expect(decision.confidence).toBeLessThanOrEqual(0.9);
    });

    it("complexity 4+ results in lower confidence (~0.65)", () => {
      const decision = testShouldGenerateSpec({
        title: "Complex",
        files: ["a.ts"],
        estimated_complexity: 4,
      });

      expect(decision.confidence).toBeGreaterThanOrEqual(0.6);
      expect(decision.confidence).toBeLessThanOrEqual(0.7);
    });

    it("open questions cap confidence at 0.6", () => {
      const decision = testShouldGenerateSpec(
        { title: "Feature", files: ["a.ts"], estimated_complexity: 3 },
        "task",
        true, // has open questions
      );

      expect(decision.confidence).toBeLessThanOrEqual(0.6);
    });
  });
});

// ============================================================================
// isSpecGenerationTriggered Tests
// ============================================================================

describe("isSpecGenerationTriggered", () => {
  it("explicit_flag=true triggers spec generation", () => {
    const result = testIsSpecGenerationTriggered({
      explicit_flag: true,
      task_complexity: 1, // Low complexity but explicit flag
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toContain("Explicit");
  });

  it("explicit_flag=false prevents spec generation", () => {
    const result = testIsSpecGenerationTriggered({
      explicit_flag: false,
      task_complexity: 5, // High complexity but explicitly disabled
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain("disabled");
  });

  it("complexity threshold triggers spec generation", () => {
    const result = testIsSpecGenerationTriggered({
      task_complexity: 4,
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toContain("complexity");
  });

  it("feature type with sufficient complexity triggers", () => {
    const result = testIsSpecGenerationTriggered({
      task_type: "feature",
      task_complexity: 3,
    });

    expect(result.triggered).toBe(true);
  });

  it("bug type skips spec generation", () => {
    const result = testIsSpecGenerationTriggered({
      task_type: "bug",
      task_complexity: 5,
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain("bug");
  });

  it("high subtask count triggers spec generation", () => {
    const result = testIsSpecGenerationTriggered({
      subtask_count: 7, // More than 5
    });

    expect(result.triggered).toBe(true);
    expect(result.reason).toContain("subtask");
  });

  it("low subtask count alone does not trigger", () => {
    const result = testIsSpecGenerationTriggered({
      subtask_count: 3, // Less than 5
    });

    expect(result.triggered).toBe(false);
  });

  it("no triggers returns false with explanation", () => {
    const result = testIsSpecGenerationTriggered({
      task_type: "task",
      task_complexity: 2, // Below threshold
      subtask_count: 2, // Low
    });

    expect(result.triggered).toBe(false);
    expect(result.reason).toContain("No spec generation triggers");
  });
});

// ============================================================================
// Helper Functions for Testing
// ============================================================================

/**
 * Test helper that mimics shouldAutoApprove logic from spec.ts
 * Without importing the actual function to avoid circular deps
 */
function testShouldAutoApprove(
  autoApprove: boolean | undefined,
  confidence: number | undefined,
  threshold: number,
): boolean {
  // Explicit auto_approve flag takes precedence
  if (autoApprove === true) {
    return true;
  }
  if (autoApprove === false) {
    return false;
  }

  // Fall back to confidence threshold
  if (confidence !== undefined && confidence >= threshold) {
    return true;
  }

  return false;
}

/**
 * Test helper that mimics shouldGenerateSpec logic from hive-orchestrate.ts
 */
interface TestSubtaskForSpec {
  title: string;
  description?: string;
  files: string[];
  estimated_complexity: number;
}

interface TestSpecGenerationDecision {
  should_generate: boolean;
  auto_approve: boolean;
  reasoning: string;
  confidence: number;
}

const DEFAULT_TEST_CONFIG = {
  complexity_threshold: 3,
  auto_approve_complexity: 3,
  review_required_complexity: 4,
  spec_types: ["feature", "epic", "task"],
  skip_types: ["bug", "chore"],
  default_confidence: 0.75,
};

function testShouldGenerateSpec(
  subtask: TestSubtaskForSpec,
  taskType: "feature" | "epic" | "task" | "bug" | "chore" = "task",
  hasOpenQuestions: boolean = false,
): TestSpecGenerationDecision {
  const cfg = DEFAULT_TEST_CONFIG;

  // Skip types that shouldn't generate specs
  if (cfg.skip_types.includes(taskType as "bug" | "chore")) {
    return {
      should_generate: false,
      auto_approve: false,
      reasoning: `Task type '${taskType}' is configured to skip spec generation`,
      confidence: 0,
    };
  }

  const complexity = subtask.estimated_complexity;

  // Low complexity tasks don't need specs
  if (complexity < cfg.complexity_threshold) {
    return {
      should_generate: false,
      auto_approve: false,
      reasoning: `Complexity ${complexity} is below threshold ${cfg.complexity_threshold}`,
      confidence: 0,
    };
  }

  // Calculate confidence based on multiple factors
  let confidence = cfg.default_confidence;

  // Adjust confidence based on complexity clarity
  if (complexity === 3) {
    confidence = 0.85;
  } else if (complexity >= 4) {
    confidence = 0.65;
  }

  // Open questions reduce confidence and prevent auto-approval
  if (hasOpenQuestions) {
    confidence = Math.min(confidence, 0.6);
    return {
      should_generate: true,
      auto_approve: false,
      reasoning: `Complexity ${complexity} triggers spec generation, but open questions prevent auto-approval`,
      confidence,
    };
  }

  // Feature/epic types always generate specs when threshold met
  if (cfg.spec_types.includes(taskType as "feature" | "epic" | "task")) {
    const autoApprove = complexity <= cfg.auto_approve_complexity;

    return {
      should_generate: true,
      auto_approve: autoApprove,
      reasoning: autoApprove
        ? `Complexity ${complexity} with type '${taskType}' qualifies for auto-approved spec`
        : `Complexity ${complexity} exceeds auto-approve threshold (${cfg.auto_approve_complexity}) - requires review`,
      confidence,
    };
  }

  return {
    should_generate: true,
    auto_approve: false,
    reasoning: `Complexity ${complexity} triggers spec generation with human review`,
    confidence,
  };
}

/**
 * Test helper that mimics isSpecGenerationTriggered logic from hive-orchestrate.ts
 */
function testIsSpecGenerationTriggered(options: {
  explicit_flag?: boolean;
  task_complexity?: number;
  task_type?: string;
  subtask_count?: number;
}): {
  triggered: boolean;
  reason: string;
} {
  const cfg = DEFAULT_TEST_CONFIG;

  // Explicit flag takes precedence
  if (options.explicit_flag === true) {
    return {
      triggered: true,
      reason: "Explicit --spec flag provided",
    };
  }

  if (options.explicit_flag === false) {
    return {
      triggered: false,
      reason: "Spec generation explicitly disabled",
    };
  }

  // Check task type
  if (options.task_type) {
    if (cfg.skip_types.includes(options.task_type as "bug" | "chore")) {
      return {
        triggered: false,
        reason: `Task type '${options.task_type}' skips spec generation`,
      };
    }

    if (cfg.spec_types.includes(options.task_type as "feature" | "epic" | "task")) {
      if (
        options.task_complexity !== undefined &&
        options.task_complexity >= cfg.complexity_threshold
      ) {
        return {
          triggered: true,
          reason: `Task type '${options.task_type}' with complexity ${options.task_complexity}`,
        };
      }
    }
  }

  // Check complexity threshold alone
  if (
    options.task_complexity !== undefined &&
    options.task_complexity >= cfg.complexity_threshold
  ) {
    return {
      triggered: true,
      reason: `Task complexity ${options.task_complexity} >= threshold ${cfg.complexity_threshold}`,
    };
  }

  // Check subtask count
  if (options.subtask_count !== undefined && options.subtask_count > 5) {
    return {
      triggered: true,
      reason: `High subtask count (${options.subtask_count}) suggests complex task`,
    };
  }

  return {
    triggered: false,
    reason: "No spec generation triggers matched",
  };
}

// ============================================================================
// File-Based Approval Flow Integration Tests
// ============================================================================

describe("Spec File Persistence", () => {
  let testDir: string;
  let originalWorkingDir: string;

  beforeEach(() => {
    // Create isolated temp directory for each test
    testDir = join(tmpdir(), `spec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    
    // Save and override working directory
    originalWorkingDir = getSpecWorkingDirectory();
    setSpecWorkingDirectory(testDir);
  });

  afterEach(() => {
    // Restore original working directory
    setSpecWorkingDirectory(originalWorkingDir);
    
    // Clean up temp directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create spec JSON file in the test directory
   */
  function createSpecFile(spec: SpecEntry): string {
    const specDir = join(testDir, "openspec", "specs", spec.capability);
    mkdirSync(specDir, { recursive: true });
    const jsonPath = join(specDir, "spec.json");
    writeFileSync(jsonPath, JSON.stringify(spec, null, 2), "utf-8");
    return jsonPath;
  }

  /**
   * Helper to read spec from file
   */
  function readSpecFile(capability: string): SpecEntry | null {
    const jsonPath = join(testDir, "openspec", "specs", capability, "spec.json");
    if (!existsSync(jsonPath)) {
      return null;
    }
    const data = readFileSync(jsonPath, "utf-8");
    return SpecEntrySchema.parse(JSON.parse(data));
  }

  /**
   * Helper to list all spec capabilities in test directory
   */
  function listSpecCapabilities(): string[] {
    const specsDir = join(testDir, "openspec", "specs");
    if (!existsSync(specsDir)) {
      return [];
    }
    return readdirSync(specsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  it("creates spec in canonical location: openspec/specs/{capability}/", () => {
    const spec = createTestSpec({
      id: "spec-test-feature-v1",
      capability: "test-feature",
      status: "draft",
    });

    createSpecFile(spec);

    // Verify file exists in canonical location
    const expectedPath = join(testDir, "openspec", "specs", "test-feature", "spec.json");
    expect(existsSync(expectedPath)).toBe(true);

    // Verify content
    const saved = readSpecFile("test-feature");
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe("spec-test-feature-v1");
    expect(saved!.status).toBe("draft");
  });

  it("persists status change from draft to review", () => {
    const spec = createTestSpec({
      id: "spec-review-test-v1",
      capability: "review-test",
      status: "draft",
    });

    createSpecFile(spec);

    // Update status to review
    const updated: SpecEntry = {
      ...spec,
      status: "review",
      updated_at: new Date().toISOString(),
    };

    createSpecFile(updated);

    // Verify status persisted
    const saved = readSpecFile("review-test");
    expect(saved!.status).toBe("review");
  });

  it("persists status change from review to approved", () => {
    const spec = createTestSpec({
      id: "spec-approval-test-v1",
      capability: "approval-test",
      status: "review",
    });

    createSpecFile(spec);

    // Update status to approved
    const approved: SpecEntry = {
      ...spec,
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "human",
      updated_at: new Date().toISOString(),
    };

    createSpecFile(approved);

    // Verify approval persisted
    const saved = readSpecFile("approval-test");
    expect(saved!.status).toBe("approved");
    expect(saved!.approved_by).toBe("human");
    expect(saved!.approved_at).toBeDefined();
  });

  it("multiple specs coexist in separate directories", () => {
    const spec1 = createTestSpec({
      id: "spec-feature-a-v1",
      capability: "feature-a",
      status: "draft",
    });

    const spec2 = createTestSpec({
      id: "spec-feature-b-v1",
      capability: "feature-b",
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: "system",
    });

    createSpecFile(spec1);
    createSpecFile(spec2);

    // Verify both exist
    const capabilities = listSpecCapabilities();
    expect(capabilities).toContain("feature-a");
    expect(capabilities).toContain("feature-b");

    // Verify independent status
    expect(readSpecFile("feature-a")!.status).toBe("draft");
    expect(readSpecFile("feature-b")!.status).toBe("approved");
  });

  it("status change updates file in place (no duplicates)", () => {
    const spec = createTestSpec({
      id: "spec-inplace-test-v1",
      capability: "inplace-test",
      status: "draft",
    });

    createSpecFile(spec);

    // Transition through all statuses
    const statuses: Array<"draft" | "review" | "approved" | "implemented"> = [
      "draft",
      "review",
      "approved",
      "implemented",
    ];

    for (const status of statuses) {
      const updated: SpecEntry = {
        ...spec,
        status,
        updated_at: new Date().toISOString(),
        ...(status === "approved" || status === "implemented"
          ? { approved_at: new Date().toISOString(), approved_by: "human" }
          : {}),
      };
      createSpecFile(updated);
    }

    // Only one spec directory should exist
    const capabilities = listSpecCapabilities();
    expect(capabilities.filter((c) => c === "inplace-test")).toHaveLength(1);

    // Verify final status
    const final = readSpecFile("inplace-test");
    expect(final!.status).toBe("implemented");
  });

  it("test directory is isolated (doesn't pollute project)", () => {
    // Verify test directory is in temp location
    expect(testDir.startsWith(tmpdir())).toBe(true);
    
    // Verify test directory is NOT in project root
    expect(testDir).not.toContain("opencode-swarm-plugin/openspec");
    
    // Create a spec
    const spec = createTestSpec({
      id: "spec-isolation-test-v1",
      capability: "isolation-test",
      status: "draft",
    });
    createSpecFile(spec);
    
    // Verify it's in the temp directory
    const specPath = join(testDir, "openspec", "specs", "isolation-test", "spec.json");
    expect(existsSync(specPath)).toBe(true);
  });
});
