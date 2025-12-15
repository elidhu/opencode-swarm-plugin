# Upstream Integration Recommendations

**Date**: December 15, 2025  
**Epic**: opencode-swarm-plugin-0bj  
**Status**: Final Recommendations

## Executive Summary

After analyzing 4 upstream features from opencode-swarm-plugin, we recommend integrating **3 high-value patterns** that significantly improve hive's reliability, testability, and learning capabilities. The adapter pattern provides immediate testing benefits (~19 hours), checkpoint/recovery adds production resilience (~10 hours), and eval-capture enables data-driven improvements (~12 hours). We recommend skipping the UBS verification gate due to external dependencies.

**Total Estimated Effort**: 41 hours (~1 week sprint)  
**Expected ROI**: High - addresses critical gaps in reliability, testability, and observability

---

## Priority Matrix

### MUST-HAVE (Integrate ASAP)

#### 1. Adapter Pattern (19 hours) ⭐ START HERE
**Priority**: HIGHEST - Unblocks testing and future database flexibility

**What It Does**:
- Decouples database implementation from business logic
- Enables in-memory testing (10x faster, no shared state)
- Allows database swapping (PGLite → PostgreSQL → SQLite) without code changes

**Why It Matters**:
- **Current Pain**: Integration tests share database state, causing flakiness
- **Current Limitation**: Locked into PGLite, can't easily migrate
- **Immediate Benefit**: Fast, isolated unit tests for all hive-mail operations

**Key Findings**:
- Two-layer abstraction: `DatabaseAdapter` (SQL) → `SwarmMailAdapter` (business logic)
- Factory pattern with dependency injection
- Non-breaking migration path (add `dbOverride` parameters)

**Implementation Path**:
1. Copy type definitions (`DatabaseAdapter`, `SwarmMailAdapter` interfaces) - 1h
2. Create adapter factory (`createSwarmMailAdapter()`) - 2h
3. Add `dbOverride` parameters to store/projection functions - 4h
4. Refactor plugin tools to use adapter instances - 4h
5. Create test utilities (`createInMemorySwarmMail()`) - 2h
6. Update integration tests with isolated adapters - 4h
7. Documentation and examples - 2h

**Files to Modify**:
- NEW: `src/types/database.ts`, `src/types/adapter.ts`, `src/adapter.ts`
- MODIFY: `src/streams/store.ts`, `src/streams/projections.ts`, `src/hive-mail.ts`
- NEW: `src/streams/test-utils.ts`

**Success Criteria**:
- [ ] All integration tests run in parallel without conflicts
- [ ] Test suite execution time reduces by 50%+
- [ ] Can swap to different database without changing business logic
- [ ] 90%+ test coverage on adapter layer

---

#### 2. Checkpoint/Recovery System (10 hours)
**Priority**: HIGH - Critical for production reliability

**What It Does**:
- Agents checkpoint progress at 25%, 50%, 75% milestones
- Resume work after crashes without losing context
- Share coordinator directives (API contracts, gotchas) to all workers

**Why It Matters**:
- **Current Gap**: Agent crashes = lost progress, restart from 0%
- **Current Pain**: No way to share discovered context across agents
- **Production Risk**: Long-running tasks vulnerable to rate limits, context overflows

**Key Findings**:
- Event-sourced with materialized view (fast recovery queries)
- `SwarmBeadContext` schema captures: files, strategy, directives, recovery state
- Auto-checkpoint on progress updates (non-intrusive)
- Directives enable "discovery phase" patterns (coordinator learns, then shares)

**Implementation Path**:
1. Add `SwarmBeadContext` schema to `src/schemas/` - 1h
2. Add checkpoint/recovery events to event stream - 1h
3. Add `swarm_contexts` table migration - 1h
4. Implement checkpoint storage (event append + table upsert) - 2h
5. Implement recovery query (latest context by epic_id) - 1h
6. Create `hive_checkpoint` and `hive_recover` tools - 2h
7. Integrate auto-checkpoint into `hive_progress` tool - 1h
8. End-to-end testing (crash/recovery scenarios) - 2h

**Files to Modify**:
- NEW: `src/schemas/checkpoint.ts`
- MODIFY: `src/streams/events.ts`, `src/streams/migrations.ts`
- NEW: `src/checkpoint.ts` (storage + recovery logic)
- MODIFY: `src/hive-orchestrate.ts` (auto-checkpoint in progress)
- NEW: Integration tests for recovery flow

**Success Criteria**:
- [ ] Agent resumes from last checkpoint after crash (not 0%)
- [ ] Coordinator directives flow to all spawned workers
- [ ] Progress checkpoints occur automatically at milestones
- [ ] Recovery time < 5 seconds
- [ ] 95%+ recovery success rate

---

#### 3. Eval Capture System (12 hours)
**Priority**: HIGH - Enables data-driven improvement

**What It Does**:
- Records every hive decomposition (input/output/outcome) to `.opencode/eval-data.jsonl`
- Computes quality metrics: scope accuracy, time balance, file overlap
- Exports data for Evalite testing (ground truth for strategy evaluation)

**Why It Matters**:
- **Current Blindness**: No visibility into decomposition quality in production
- **Learning Gap**: Can't measure strategy effectiveness (file-based vs. feature-based)
- **Eval Challenge**: `evals/hive-decompose.eval.ts` lacks real-world data

**Key Findings**:
- Captures complete lifecycle: decompose → execute → finalize
- 31-field `EvalRecord` schema with computed metrics
- JSONL append-only storage (streaming, large datasets)
- Optional human feedback signals for supervised learning

**Computed Metrics**:
- **Scope Accuracy**: `actual_files / planned_files` (goal: 0.8-1.2)
- **Time Balance**: `max_duration / min_duration` (goal: < 3.0)
- **File Overlap**: Count of files in multiple subtasks (goal: 0)

**Implementation Path**:
1. Copy `eval-capture.ts` from upstream, rename swarm→hive - 1h
2. Add integration points in `hive-decompose.ts` (capture decomposition) - 2h
3. Add integration points in `hive-orchestrate.ts` (capture outcomes) - 2h
4. Add finalization on epic completion - 1h
5. Create `hive eval stats` command for metrics dashboard - 2h
6. Update `hive-decompose.eval.ts` to load captured data - 2h
7. Add scorers for metrics (scope accuracy, time balance, file overlap) - 2h

**Files to Modify**:
- NEW: `src/eval-capture.ts`, `src/eval-capture.test.ts`
- MODIFY: `src/hive-decompose.ts` (call captureDecomposition)
- MODIFY: `src/hive-orchestrate.ts` (call captureSubtaskOutcome, finalizeEvalRecord)
- MODIFY: `evals/hive-decompose.eval.ts` (use real data)
- NEW: `evals/scorers/metrics.ts` (file overlap, scope accuracy, time balance)

**Success Criteria**:
- [ ] Every epic produces an eval record in `.opencode/eval-data.jsonl`
- [ ] Metrics computed automatically (scope accuracy, time balance, file overlap)
- [ ] `hive eval stats` shows aggregate success rate, avg metrics
- [ ] Eval tests run against production data
- [ ] Can identify which strategy performs best on which task types

---

### NICE-TO-HAVE (Consider for v2)

#### 4. Human Feedback Loop
**Effort**: 8 hours  
**Dependency**: Requires Eval Capture (above)

**What It Adds**:
- Interactive CLI: `hive eval review <epic-id>`
- Prompts: Accept (y), Modify (m), Reject (n), Notes
- Updates eval record with `human_accepted`, `human_modified`, `human_notes`

**Why Later**:
- Eval capture provides value without human feedback (implicit signals)
- Can implement after accumulating eval data
- Needs UX design for effective prompts

**Implementation Notes**:
- Could integrate with GitHub PR comment parsing
- Could use mandate system votes as implicit feedback
- Consider post-completion survey in coordinator

---

#### 5. Advanced Verification Steps
**Effort**: 4-8 hours per step

**Potential Additions** (beyond current typecheck + tests):
- **Linting**: Add ESLint/Prettier verification (4h)
- **Coverage Threshold**: Block completion if test coverage < X% (4h)
- **Bundle Size Check**: Warn if bundle size increases significantly (6h)
- **Breaking Change Detection**: Check for breaking API changes (8h)

**Why Later**:
- Current 2-step gate (typecheck + tests) covers critical checks
- Each addition adds complexity and potential false positives
- Should be configurable per-project, not global

**Implementation Notes**:
- Follow same pattern as existing steps (return `VerificationStep`)
- Add skip parameters if needed (escape hatches)
- Make pluggable via config (`.hive/config.json`)

---

#### 6. Checkpoint Enhancements
**Effort**: 6-12 hours

**Potential Additions**:
- **TTL/Cleanup**: Auto-delete checkpoints older than N days (3h)
- **Checkpoint Compression**: zlib compress long directives (4h)
- **Checkpoint Diffing**: Track changes between checkpoints (6h)
- **Multi-Bead Recovery**: Recover entire epic at once (4h)
- **Time-Based Triggers**: Checkpoint every N minutes (2h)

**Why Later**:
- Core checkpoint/recovery provides immediate value
- Enhancements address edge cases and optimization
- Should wait for production usage data

---

### SKIP (Not Worth the Cost)

#### 7. UBS (Universal Bug Scanner) Integration
**Reason**: External dependency with uncertain availability

**What It Is**:
- Static analysis tool that detects bugs before commit
- Upstream verification gate includes UBS scan step
- Blocks completion on `critical` bugs

**Why Skip**:
1. **External Dependency**: UBS not widely available, setup burden
2. **Portability**: Our 2-step gate (typecheck + tests) is self-contained
3. **Graceful Degradation**: UBS scan is skippable in upstream anyway
4. **Already Decided**: We removed UBS in initial hive implementation
5. **TypeScript Coverage**: TypeCheck catches most issues UBS would find

**Alternative**:
- If UBS becomes a first-party OpenCode tool: Revisit in future
- Current mitigation: TypeScript strict mode + comprehensive tests

**Code Reference**:
- Upstream: `swarm-orchestrate.ts:262-336` (runUbsScan function)
- Our version: `hive-orchestrate.ts` (no UBS step, intentionally removed)

---

#### 8. Effect Library Migration
**Reason**: Major refactor with unclear ROI

**What It Is**:
- Upstream uses Effect library for streams, deferred initialization, resource management
- Provides structured concurrency, composable error handling, dependency injection

**Why Skip (For Now)**:
1. **Adapter Pattern First**: Dependency injection achievable without Effect
2. **Learning Curve**: Effect is a paradigm shift, requires team training
3. **Migration Risk**: Refactoring all async code is high-risk, low-visibility
4. **Current Architecture Works**: PGLite + async/await is sufficient

**Future Consideration**:
- After adapter pattern stabilizes
- If we need advanced concurrency patterns (streams, fibers)
- If upstream makes Effect mandatory

**Migration Path (If Needed Later)**:
- Start with Effect streams for event replay (cursor-based)
- Add Effect layers for dependency injection
- Gradually refactor tools to use Effect Context

---

## Implementation Roadmap

### Phase 1: Testing Foundation (Week 1) - 19 hours
**Goal**: Enable fast, isolated testing

1. **Day 1-2: Adapter Pattern Core** (7 hours)
   - Copy type definitions (database.ts, adapter.ts)
   - Create factory function (adapter.ts)
   - Add `dbOverride` parameters to store/projections
   - Create in-memory test utility

2. **Day 3-4: Plugin Tool Refactoring** (8 hours)
   - Refactor `hive-mail.ts` to use adapter instances
   - Store adapter in session state
   - Update all tool functions to use session adapter
   - Add backward compatibility fallbacks

3. **Day 5: Test Migration** (4 hours)
   - Update integration tests to use isolated adapters
   - Add `beforeEach`/`afterEach` cleanup
   - Verify parallel test execution works
   - Measure test speed improvement

**Milestone**: Tests run 50%+ faster, no shared state issues

---

### Phase 2: Production Resilience (Week 2) - 10 hours
**Goal**: Enable agent recovery after failures

1. **Day 1: Checkpoint Schema** (3 hours)
   - Add `SwarmBeadContext` schema
   - Add checkpoint/recovery events
   - Run database migration (swarm_contexts table)

2. **Day 2: Storage & Recovery** (4 hours)
   - Implement checkpoint storage (event + table)
   - Implement recovery query (latest by epic_id)
   - Add tests for checkpoint round-trip

3. **Day 3: Tool Integration** (3 hours)
   - Create `hive_checkpoint` and `hive_recover` tools
   - Add auto-checkpoint to `hive_progress` (25/50/75%)
   - Test coordinator→worker directive flow
   - End-to-end crash/recovery test

**Milestone**: Agent successfully resumes from checkpoint after simulated crash

---

### Phase 3: Learning Loop (Week 3) - 12 hours
**Goal**: Capture production data for strategy improvement

1. **Day 1: Eval Capture Core** (4 hours)
   - Copy and adapt `eval-capture.ts` (swarm→hive rename)
   - Add EvalRecord schemas
   - Integrate into `hive-decompose.ts` (capture input/output)

2. **Day 2: Outcome Tracking** (4 hours)
   - Integrate into `hive-orchestrate.ts` (capture outcomes)
   - Add finalization logic on epic completion
   - Implement metric computation (scope accuracy, time balance, file overlap)
   - Test full lifecycle (decompose → execute → finalize)

3. **Day 3: Analytics & Integration** (4 hours)
   - Create `hive eval stats` command
   - Update `hive-decompose.eval.ts` to load real data
   - Add metric scorers to `evals/scorers/`
   - Document eval workflow

**Milestone**: Every hive execution produces eval record, `hive eval stats` shows metrics

---

### Phase 4: Documentation & Polish (Ongoing) - 4 hours
**Goal**: Ensure maintainability and knowledge transfer

1. **Developer Docs** (2 hours)
   - README sections for adapter pattern, checkpoint/recovery, eval-capture
   - Architecture diagrams (update existing docs)
   - Migration guide for users

2. **Skill Updates** (2 hours)
   - Update `hive-coordination` skill with new patterns
   - Create examples in `examples/` directory
   - Add integration test examples

**Milestone**: New contributors can understand and extend features

---

## Action Items

### Immediate (This Sprint)
1. **Create Implementation Epic** in beads system
   - [ ] Bead 1: Adapter Pattern (19h) - Agent: testing-specialist
   - [ ] Bead 2: Checkpoint/Recovery (10h) - Agent: reliability-engineer
   - [ ] Bead 3: Eval Capture (12h) - Agent: observability-engineer
   - [ ] Dependencies: Bead 2 & 3 can run parallel after Bead 1

2. **Reserve File Paths** via HiveMail
   - Adapter: `src/types/database.ts`, `src/types/adapter.ts`, `src/adapter.ts`
   - Checkpoint: `src/schemas/checkpoint.ts`, `src/checkpoint.ts`
   - Eval: `src/eval-capture.ts`, `src/eval-capture.test.ts`

3. **Set Up Monitoring**
   - Track test execution time (before/after adapter)
   - Track recovery success rate (after checkpoint)
   - Track eval data accumulation (after eval-capture)

4. **Coordinate with Upstream**
   - Watch for UBS tool release (reconsider if first-party)
   - Track Effect adoption (future consideration)
   - Submit PR if we improve patterns

### Short-Term (Next Quarter)
1. **Human Feedback Loop** (after eval capture stabilizes)
   - Interactive `hive eval review` command
   - GitHub PR comment parsing
   - Mandate system vote integration

2. **Advanced Verification Steps** (project-specific)
   - Pluggable verification config (`.hive/config.json`)
   - Linting, coverage, bundle size checks
   - Per-file-type verification strategies

3. **Checkpoint Enhancements** (after production data)
   - TTL-based cleanup (prevent disk bloat)
   - Compression for large directives
   - Checkpoint diffing for debugging

### Long-Term (Future)
1. **Effect Migration** (if upstream mandates)
   - Start with event replay cursors
   - Add Effect layers for DI
   - Gradual refactor of async code

2. **Advanced Analytics** (after eval data accumulates)
   - Similar task retrieval (embeddings)
   - Anomaly detection (extreme time imbalance)
   - Transfer learning (successful pattern reuse)

---

## Risk Assessment

### High-Risk Items
**None** - All recommended features are non-breaking, opt-in, and production-tested upstream.

### Medium-Risk Items

#### 1. Adapter Pattern Migration
**Risk**: Breaking backward compatibility for existing users  
**Mitigation**: Gradual adoption with fallbacks, keep `getDatabase()` deprecated but functional  
**Rollback**: Remove adapter layer, revert to singleton (low cost)

#### 2. Checkpoint State Loss
**Risk**: In-memory checkpoint map lost on crash before persisted  
**Mitigation**: Dual-write pattern (event stream + table), recover from events on restart  
**Rollback**: Disable auto-checkpoint, manual checkpoint only

#### 3. Eval Data Privacy
**Risk**: Task descriptions or context may contain sensitive info  
**Mitigation**: Add `.opencode/eval-data.jsonl` to `.gitignore`, document privacy considerations  
**Rollback**: Disable eval capture via config flag

### Low-Risk Items
- All other features are isolated, testable, and gracefully degrade on failure

---

## Success Metrics

### Adapter Pattern
- [ ] Test execution time reduced by 50%+
- [ ] Integration tests run in parallel without conflicts
- [ ] Test coverage on adapter layer ≥ 90%
- [ ] Can swap database backend in < 1 hour

### Checkpoint/Recovery
- [ ] Agent recovery success rate ≥ 95%
- [ ] Time to recovery < 5 seconds
- [ ] Progress preservation ≥ 90% (if crash at 60%, resume at ≥54%)
- [ ] Checkpoint overhead < 100ms per progress update
- [ ] Directive propagation to workers = 100%

### Eval Capture
- [ ] Every epic completion produces eval record
- [ ] Metrics computed accurately (scope accuracy, time balance, file overlap)
- [ ] `hive eval stats` command functional
- [ ] Eval tests run against real production data
- [ ] Can identify best strategy per task type within 3 sprints

---

## Conclusion

These three integrations—**Adapter Pattern**, **Checkpoint/Recovery**, and **Eval Capture**—address critical gaps in hive's architecture:

1. **Adapter Pattern** unlocks fast, reliable testing (immediate productivity gain)
2. **Checkpoint/Recovery** enables production resilience (prevents catastrophic failures)
3. **Eval Capture** provides visibility for continuous improvement (data-driven strategy tuning)

All three are **production-tested** in upstream, **non-breaking** to adopt, and **high-value** relative to implementation cost. The sequential roadmap minimizes risk and maximizes learning between phases.

**Recommendation**: Start with Adapter Pattern (Week 1), then parallelize Checkpoint/Recovery + Eval Capture (Weeks 2-3). Defer UBS and Effect migrations indefinitely unless upstream requirements change.

**Total Effort**: 41 hours (~1 sprint with 3 parallel agents)  
**Expected Impact**: Foundational improvements to reliability, testability, and observability

---

## Appendix A: File Modification Summary

### New Files (10 files)
- `src/types/database.ts` - DatabaseAdapter interface
- `src/types/adapter.ts` - SwarmMailAdapter interface
- `src/adapter.ts` - Factory function
- `src/streams/test-utils.ts` - In-memory test utilities
- `src/schemas/checkpoint.ts` - SwarmBeadContext schema
- `src/checkpoint.ts` - Checkpoint storage + recovery
- `src/eval-capture.ts` - Eval recording system
- `src/eval-capture.test.ts` - Eval capture unit tests
- `evals/scorers/metrics.ts` - Metric scorers (file overlap, scope accuracy, time balance)
- `docs/integration-guide.md` - User-facing integration guide

### Modified Files (8 files)
- `src/streams/store.ts` - Add dbOverride parameters
- `src/streams/projections.ts` - Add dbOverride parameters
- `src/streams/events.ts` - Add checkpoint/recovery events
- `src/streams/migrations.ts` - Add swarm_contexts table
- `src/hive-mail.ts` - Refactor to use adapter instances
- `src/hive-decompose.ts` - Add eval capture calls
- `src/hive-orchestrate.ts` - Add checkpoint + eval capture calls
- `evals/hive-decompose.eval.ts` - Use real eval data

### Test Files (3 files)
- `src/adapter.test.ts` - Adapter factory tests
- `src/checkpoint.integration.test.ts` - Checkpoint/recovery tests
- `src/eval-capture.integration.test.ts` - Eval capture lifecycle tests

---

## Appendix B: Upstream Source References

### Adapter Pattern
- **Repository**: https://github.com/joelhooks/opencode-swarm-plugin.git
- **Branch**: upstream/main
- **Files**:
  - `packages/swarm-mail/src/adapter.ts`
  - `packages/swarm-mail/src/types/adapter.ts`
  - `packages/swarm-mail/src/types/database.ts`

### Checkpoint/Recovery
- **Repository**: https://github.com/joelhooks/opencode-swarm-plugin.git
- **Branch**: upstream/main
- **Files**:
  - `packages/opencode-swarm-plugin/src/schemas/swarm-context.ts`
  - `packages/swarm-mail/src/streams/events.ts` (checkpoint events)
  - `packages/opencode-swarm-plugin/src/swarm-orchestrate.ts` (recovery tools)

### Eval Capture
- **Repository**: https://github.com/joelhooks/opencode-swarm-plugin.git
- **Branch**: upstream/main
- **Files**:
  - `packages/opencode-swarm-plugin/src/eval-capture.ts`

### Verification Gate
- **Repository**: https://github.com/joelhooks/opencode-swarm-plugin.git
- **Branch**: upstream/main
- **Files**:
  - `packages/opencode-swarm-plugin/src/swarm-orchestrate.ts:262-336` (UBS scan)
  - `packages/opencode-swarm-plugin/src/swarm-orchestrate.ts:324-373` (gate implementation)

---

**Document Complete**  
**Generated**: December 15, 2025  
**Agent**: synthesis-agent  
**Bead**: opencode-swarm-plugin-0bj.5  
**Status**: Ready for Coordinator Review
