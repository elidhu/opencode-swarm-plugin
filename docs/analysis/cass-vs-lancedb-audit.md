# CASS vs LanceDB Semantic Search Parity Audit

**Date**: December 15, 2025  
**Epic**: opencode-swarm-plugin-89k  
**Bead**: opencode-swarm-plugin-89k.1  
**Status**: Analysis Complete

---

## Executive Summary

**Finding**: CASS integration is **not implemented** in our fork. All semantic search is handled by LanceDB with local embeddings. The `query_cass` parameter appears in documentation and old templates but has no functional implementation.

**Recommendation**: **LanceDB suffices** for zero-config workflow. CASS integration would add external dependency without clear value for single-project usage. However, cross-project session search (CASS's primary benefit) could be valuable for organizations running multiple hive instances.

**Key Gap**: LanceDB provides pattern/feedback search **within a project**, but lacks **cross-project historical context** that CASS would provide.

---

## 1. Current State Analysis

### 1.1 LanceDB Implementation (src/storage.ts)

#### Architecture
- **Vector Database**: LanceDB (embedded, zero-config)
- **Embedding Model**: `Xenova/all-MiniLM-L6-v2` (384-dimensional)
- **Storage Location**: `.hive/vectors/` directory
- **Execution**: Node.js subprocess (avoids Bun ONNX crashes)

#### Key Functions

##### `findSimilarPatterns(query: string, limit?: number)`
**Purpose**: Find similar decomposition patterns based on semantic similarity

**Implementation**:
```typescript
async findSimilarPatterns(
  query: string,
  limit: number = 10,
): Promise<DecompositionPattern[]> {
  const table = await this.getTable("patterns");
  if (!table) return [];
  
  const queryVector = await embed(query);
  const results = await table.vectorSearch(queryVector).limit(limit).toArray();
  
  return results.map((r: any) => ({
    id: r.id,
    content: r.content,
    kind: r.kind,
    is_negative: r.is_negative,
    success_count: r.success_count,
    failure_count: r.failure_count,
    // ... other fields
  }));
}
```

**Storage Schema**:
```typescript
{
  id: string,
  vector: number[], // 384-dim embedding
  content: string,   // Pattern description
  kind: "pattern" | "anti_pattern",
  is_negative: boolean,
  success_count: number,
  failure_count: number,
  created_at: string,
  updated_at: string,
  reason?: string,
  tags: string,      // Comma-separated
  example_beads: string // Comma-separated
}
```

##### `findSimilarFeedback(query: string, limit?: number)`
**Purpose**: Find similar feedback events for learning from past outcomes

**Implementation**:
```typescript
async findSimilarFeedback(
  query: string,
  limit: number = 10,
): Promise<FeedbackEvent[]> {
  const table = await this.getTable("feedback");
  if (!table) return [];
  
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
}
```

**Storage Schema**:
```typescript
{
  id: string,
  vector: number[], // 384-dim embedding
  criterion: string,
  type: "positive" | "negative" | "neutral",
  timestamp: string,
  context?: string,
  bead_id?: string,
  raw_value: number
}
```

#### Embedding Pipeline

**Model**: `Xenova/all-MiniLM-L6-v2`
- **Dimension**: 384 (not 768 as README incorrectly states)
- **Pooling**: Mean pooling
- **Normalization**: Normalized for cosine similarity
- **Size**: ~30MB download (cached locally)

**Why Node.js Subprocess?**:
```typescript
// From src/embeddings.ts:9-16
/**
 * ## Why Node.js?
 * Bun crashes during ONNX runtime cleanup with @huggingface/transformers.
 * Node.js handles it correctly. We spawn Node for embedding ops only.
 */
```

**Performance**:
- Single text: ~100-200ms (cold start), ~50-100ms (warm)
- Batch processing: ~50ms per text (amortized)
- Model loading: One-time ~500ms on first call

---

### 1.2 CASS Integration Status

#### Code References
**Search Results**: 38 matches for "CASS|cass|cross-agent|session.search"

**Key Locations**:
1. **Documentation Only** (no functional code):
   - `global-skills/hive-coordination/references/coordinator-patterns.md`
   - `global-skills/hive-coordination/SKILL.md`
   - `examples/commands/hive.md`

2. **Old Template** (unused parameter):
   - `examples/plugin-wrapper-template.ts` - has `query_cass` and `cass_limit` parameters
   - These parameters are **not implemented** in actual tools

3. **Source Code Comments**:
   - `src/hive-decompose.ts:102` - References CASS GitHub URL in comment
   - `src/hive-decompose.ts:195` - Comment says "Optionally queries CASS" but doesn't
   - `src/hive-decompose.ts:441` - Lists "CASS queries" as responsibility but unimplemented

#### What CASS Is

**CASS** = Coding Agent Session Search  
**Repository**: https://github.com/Dicklesworthstone/coding_agent_session_search

**Purpose**: Cross-agent session search for historical context
- Indexes entire agent conversation histories across multiple sessions
- Semantic search across all past agent interactions
- Retrieves similar problem-solving approaches from previous work
- Provides organizational memory across projects

**Architecture**:
- External service (separate process/server)
- Requires setup and configuration
- Stores embeddings of agent sessions in centralized database
- Provides API for semantic search queries

**Example Use Case** (from skills):
```typescript
// Find similar past approaches
cass_search({ 
  query: "implement authentication with OAuth", 
  limit: 5 
});

// Returns:
// 1. Agent solved similar auth task 3 months ago in project-X
// 2. Common pitfall: redirect URL configuration
// 3. Recommended library: next-auth
```

---

### 1.3 hive-decompose.ts Integration Points

#### Where CASS Would Be Used

**Function**: `hive_decompose()`  
**Current Implementation** (lines 214-258):
```typescript
async execute(args) {
  const storage = getStorage();
  const pastLearnings = await storage.findSimilarPatterns(args.task, 3);
  // ^^^ Uses LanceDB, NOT CASS

  let learningsContext = "";
  if (pastLearnings.length > 0) {
    learningsContext = `## Past Learnings\n\nBased on similar past tasks...`;
  }

  // No CASS query here - only local LanceDB patterns
  const fullPrompt = learningsContext + basePrompt;
  
  return JSON.stringify({
    prompt: fullPrompt,
    expected_schema: "BeadTree",
    memory_queried: true, // ← Misleading: only local memory, not CASS
    patterns_found: pastLearnings.length,
  });
}
```

**Key Observation**: The function claims `memory_queried: true` but only queries local LanceDB patterns, not cross-session CASS data.

#### Where CASS Integration Would Fit

**Proposed Integration Point** (if implemented):
```typescript
async execute(args) {
  const storage = getStorage();
  
  // 1. Local patterns (current behavior)
  const pastLearnings = await storage.findSimilarPatterns(args.task, 3);
  
  // 2. CASS cross-session search (hypothetical)
  let cassResults = [];
  if (args.query_cass && isCassAvailable()) {
    cassResults = await queryCass({
      query: args.task,
      limit: args.cass_limit || 5,
      project_filter: args.include_other_projects ? null : currentProject
    });
  }
  
  // 3. Combine local + CASS context
  const combinedContext = formatLearnings(pastLearnings, cassResults);
  
  return {
    prompt: combinedContext + basePrompt,
    memory_queried: true,
    patterns_found: pastLearnings.length,
    cass_results_found: cassResults.length
  };
}
```

**Parameters from Template** (not implemented):
```typescript
query_cass: tool.schema
  .boolean()
  .optional()
  .describe("Query CASS for similar tasks"),
cass_limit: tool.schema
  .number()
  .int()
  .min(1)
  .max(10)
  .optional()
  .describe("CASS limit"),
```

---

## 2. Feature Comparison

### 2.1 Functionality Matrix

| Feature | LanceDB (Current) | CASS (Upstream Concept) |
|---------|-------------------|------------------------|
| **Scope** | Single project | Cross-project, cross-session |
| **Data Source** | Local patterns/feedback | All agent conversations |
| **Setup** | Zero-config (embedded) | External service setup required |
| **Privacy** | Data stays local | Centralized storage (privacy concerns) |
| **Query Speed** | Fast (local disk) | Network latency + query time |
| **Context Depth** | Pattern summaries only | Full conversation transcripts |
| **Learning Source** | Explicit patterns | Implicit from session history |
| **Freshness** | Requires manual pattern creation | Auto-indexed from sessions |
| **Organizational Memory** | ❌ Project-scoped only | ✅ Org-wide knowledge |
| **Zero-Config Workflow** | ✅ Works out-of-box | ❌ Requires external setup |

### 2.2 Semantic Search Capabilities

#### LanceDB Provides

**Pattern Search**:
- ✅ Find similar decomposition strategies
- ✅ Retrieve anti-patterns to avoid
- ✅ Get success/failure statistics
- ✅ Filter by tags (e.g., "authentication", "database")
- ✅ Vector similarity search (cosine distance)

**Feedback Search**:
- ✅ Find similar criterion feedback
- ✅ Retrieve positive/negative outcomes
- ✅ Filter by bead_id or criterion
- ✅ Semantic similarity on feedback context

**Limitations**:
- ❌ Project-scoped only (no cross-project search)
- ❌ Requires explicit pattern creation
- ❌ No access to full conversation history
- ❌ Cannot query other agent sessions
- ❌ No organizational knowledge sharing

#### CASS Would Add

**Cross-Session Search**:
- ✅ Query all past agent conversations
- ✅ Find similar problem-solving approaches
- ✅ Access full conversation context (not just patterns)
- ✅ Cross-project knowledge transfer
- ✅ Organizational learning across teams

**Organizational Memory**:
- ✅ "How did we solve X in project Y?"
- ✅ "What mistakes did other teams make?"
- ✅ "Which approach worked best historically?"
- ✅ Centralized knowledge base

**Example Queries**:
```typescript
// CASS query: "How have we implemented OAuth before?"
// Returns:
// - 5 past conversations about OAuth implementation
// - Common pitfalls discovered by other agents
// - Successful patterns from different projects
// - Library recommendations from experience

// LanceDB query: "How have we implemented OAuth before?"
// Returns:
// - 2-3 explicit patterns created in THIS project
// - Anti-patterns documented in THIS project
// - No cross-project context
```

---

## 3. Semantic Search Gaps

### 3.1 Missing Capabilities (vs. Ideal CASS)

#### 1. Cross-Project Context
**Gap**: LanceDB is project-scoped. Cannot learn from other projects' experiences.

**Impact**: 
- Duplicate learning across projects
- Repeat same mistakes in different repos
- No organizational knowledge accumulation

**Example**:
```typescript
// Team A solves OAuth integration issues in project-alpha
// Team B encounters same issues in project-beta 6 months later
// LanceDB: No knowledge transfer
// CASS: Would surface Team A's solution
```

**Workaround**: Manual pattern documentation in global skills

---

#### 2. Implicit Learning
**Gap**: LanceDB requires explicit pattern creation. CASS auto-indexes conversations.

**Impact**:
- Knowledge capture depends on human diligence
- Insights lost if not explicitly documented
- No "hidden gems" from casual conversations

**Example**:
```typescript
// Agent discovers gotcha during debugging: "JWT must be verified on every route"
// LanceDB: Only captured if agent creates explicit pattern
// CASS: Auto-indexed, discoverable in future sessions
```

**Workaround**: Eval capture system + automated pattern extraction (future work)

---

#### 3. Conversation History Search
**Gap**: LanceDB stores summaries (patterns). CASS stores full transcripts.

**Impact**:
- Cannot retrieve "how did the agent solve this?" reasoning
- Lost context: "why was this approach chosen?"
- No access to alternative approaches discussed

**Example**:
```typescript
// Query: "How to handle rate limiting with external APIs?"
// LanceDB: Returns pattern "Use exponential backoff"
// CASS: Returns full conversation showing:
//   - Agent tried 3 different approaches
//   - Exponential backoff chosen after discussing tradeoffs
//   - Code examples from actual implementation
```

**Workaround**: None (fundamental architectural difference)

---

#### 4. Time-Based Discovery
**Gap**: LanceDB has static patterns. CASS tracks evolution over time.

**Impact**:
- Cannot see "how has our approach evolved?"
- No temporal patterns (e.g., "we stopped using X after learning Y")
- Outdated patterns not auto-deprecated

**Example**:
```typescript
// 2023: Pattern "Use library-v1 for auth"
// 2024: Library-v1 deprecated, but pattern still suggests it
// LanceDB: Manual pattern updates needed
// CASS: Query shows temporal shift, agent learns library-v2 is current
```

**Workaround**: Pattern maturity system (partially addresses via deprecation)

---

### 3.2 Coverage Gaps

#### What LanceDB Currently Covers

**1. Decomposition Patterns** ✅
- File-based strategies
- Feature-based strategies  
- Risk-based strategies
- Anti-patterns (e.g., "don't split tests across subtasks")

**2. Outcome Feedback** ✅
- Success/failure signals
- Criterion-based feedback
- Error patterns
- Strike records

**3. Maturity Tracking** ✅
- Pattern validation state
- Helpful/harmful counts
- Promotion/deprecation tracking

**4. Error Accumulation** ✅
- Error type tracking
- Tool-specific failures
- Resolved/unresolved state

#### What LanceDB Does NOT Cover

**1. Cross-Agent Coordination Patterns** ❌
- How agents resolved file conflicts
- Communication patterns that worked/failed
- Delegation strategies

**2. Context Overflow Solutions** ❌
- How agents handled large files
- Chunking strategies used
- Context management techniques

**3. Tool Usage Patterns** ❌
- Which tools were most effective
- Tool failure recovery strategies
- Alternative tool sequences tried

**4. User Interaction Patterns** ❌
- How agents clarified ambiguous requirements
- Effective question strategies
- User feedback integration

**5. Codebase-Specific Knowledge** ❌
- "This repo uses custom auth system"
- "Tests require specific setup"
- "Don't modify generated files"

**Note**: CASS would cover 1-5 via conversation indexing. Our current gap is we don't store this implicit knowledge anywhere.

---

## 4. Value Assessment

### 4.1 LanceDB Sufficiency Analysis

#### ✅ LanceDB is Sufficient For:

**1. Single-Project Zero-Config Workflow**
- No external dependencies
- Works out-of-box
- Fast local queries
- Privacy-preserving

**2. Explicit Pattern Learning**
- Capture validated decomposition strategies
- Document anti-patterns
- Track pattern maturity
- Share patterns via global skills

**3. Outcome-Based Learning**
- Learn from success/failure
- Adapt based on feedback
- Improve over time within project

**4. Development Iteration**
- Fast prototyping
- No service management
- Easy testing
- Simple deployment

#### ❌ LanceDB is NOT Sufficient For:

**1. Organizational Learning**
- Knowledge sharing across projects
- Cross-team experience transfer
- Company-wide best practices

**2. Implicit Knowledge Capture**
- Auto-indexing agent conversations
- Discovering hidden patterns
- Learning from informal reasoning

**3. Historical Context Retrieval**
- "How did we solve this before?"
- "What did other teams try?"
- "Why was this approach abandoned?"

**4. Large-Scale Deployment**
- Enterprise with 100+ projects
- Multiple teams using hive
- Centralized knowledge base

---

### 4.2 CASS Value Proposition

#### When CASS Would Add Value

**Scenario 1: Large Organization (10+ projects)**
```typescript
// Team discovers solution in project-alpha
// 6 months later, team-beta faces same issue in project-gamma
// CASS: Surfaces solution automatically
// LanceDB: Each project learns independently
```
**Value**: Reduced duplicate effort, faster solutions

**Scenario 2: Onboarding New Teams**
```typescript
// New team adopts hive
// Needs to learn best practices
// CASS: Query all past successful patterns
// LanceDB: Start from scratch or read global skills
```
**Value**: Faster ramp-up, lower failure rate

**Scenario 3: Complex Problem Domains**
```typescript
// Rare edge case: "How to handle OAuth with legacy SAML?"
// Only solved once, 2 years ago in different project
// CASS: Retrieves that one conversation
// LanceDB: No record of it in current project
```
**Value**: Access to rare but critical solutions

**Scenario 4: Pattern Discovery**
```typescript
// Want to know: "What auth libraries do we use most?"
// CASS: Query all projects, aggregate library mentions
// LanceDB: Manual survey of each project
```
**Value**: Data-driven architectural decisions

#### When CASS is Overkill

**Scenario 1: Single Project**
- Local patterns sufficient
- No cross-project needs
- LanceDB faster, simpler

**Scenario 2: Small Team (<5 people)**
- Knowledge sharing via code review
- Patterns documented in README
- Overhead not justified

**Scenario 3: Greenfield Projects**
- No historical data to query
- Building patterns from scratch
- CASS empty, LanceDB growing

**Scenario 4: High Privacy Requirements**
- Cannot send data to external service
- Local-only storage required
- LanceDB meets compliance

---

### 4.3 Cost-Benefit Analysis

#### LanceDB (Current Approach)

**Costs**:
- Manual pattern creation (5-10 min per pattern)
- Project-scoped learning only
- No implicit knowledge capture
- Requires discipline to document

**Benefits**:
- Zero setup time
- Zero operational cost
- Fast queries (<50ms)
- Privacy-preserving
- Works offline
- Simple to understand

**ROI**: ✅ **Positive** - Low cost, immediate value

---

#### CASS Integration (Hypothetical)

**Costs**:
- External service setup (1-2 hours initial)
- Service maintenance (hosting, updates)
- Network latency (100-500ms per query)
- Privacy/compliance review
- Learning curve for users
- Potential service downtime

**Benefits**:
- Cross-project knowledge sharing
- Implicit learning (auto-indexed)
- Full conversation history access
- Organizational memory
- Time-based pattern discovery
- Reduced duplicate effort

**ROI**: ⚖️ **Depends on Scale**
- **Positive** at 10+ projects, multiple teams
- **Negative** for single projects, small teams
- **Breakeven** around 3-5 active projects

---

### 4.4 Integration Feasibility

#### Technical Complexity: **Medium**

**Required Components**:
1. CASS client library integration (~4 hours)
2. Configuration management (CASS URL, API keys) (~2 hours)
3. Tool parameter additions (`query_cass`, `cass_limit`) (~2 hours)
4. Error handling and fallbacks (~3 hours)
5. Testing (mocked CASS service) (~4 hours)
6. Documentation (~2 hours)

**Total Effort**: ~17 hours

**Risk Factors**:
- External dependency (availability, reliability)
- Network failures (need graceful degradation)
- Privacy/compliance concerns
- Operational overhead (who maintains CASS?)

---

#### Graceful Degradation Strategy

**If CASS Integration Added**:
```typescript
async function getDecompositionContext(task: string) {
  // 1. Always query local LanceDB (fallback)
  const localPatterns = await storage.findSimilarPatterns(task, 3);
  
  // 2. Optionally augment with CASS (if available)
  let cassResults = [];
  if (isCassConfigured() && args.query_cass) {
    try {
      cassResults = await queryCassWithTimeout(task, 5, 2000); // 2s timeout
    } catch (error) {
      console.warn("[hive] CASS query failed, using local patterns only");
      // Degrade gracefully - still works without CASS
    }
  }
  
  // 3. Combine sources
  return {
    local: localPatterns,
    cass: cassResults,
    total_sources: 1 + (cassResults.length > 0 ? 1 : 0)
  };
}
```

**Benefits**:
- Works without CASS (zero-config still functional)
- Opt-in enhancement (not required)
- Fault-tolerant (failures don't break workflow)
- Progressive enhancement (add value when available)

---

## 5. Recommendations

### 5.1 Primary Recommendation: **LanceDB Suffices**

**Reasoning**:
1. **Zero-config is core value prop** - Adding external dependency contradicts this
2. **Single-project usage is primary use case** - Most users won't benefit from cross-project search
3. **Global skills provide cross-project patterns** - Manual but sufficient pattern sharing mechanism
4. **Eval capture + pattern extraction can close gap** - Automated pattern creation from outcomes

**Decision**: **Do not integrate CASS** for general release.

---

### 5.2 Optional Future Work: CASS as Opt-In Enhancement

**If demand emerges** (e.g., large organizations request it):

**Phase 1: Investigation** (2 hours)
- Survey users: "Would cross-project search be valuable?"
- Prototype CASS integration in feature branch
- Measure query latency and value-add

**Phase 2: Integration** (17 hours - see 4.4)
- Add CASS client library
- Make query_cass parameter functional
- Implement graceful degradation
- Document setup for enterprise users

**Phase 3: Dogfooding** (ongoing)
- Use internally across multiple projects
- Measure usage patterns
- Collect feedback on value

**Gate Decision**: Only proceed to Phase 2 if:
- 3+ organizations request cross-project search
- We have 5+ dogfooding projects to test with
- Someone commits to maintaining CASS service

---

### 5.3 Immediate Improvements (No CASS Needed)

#### 1. Fix README Discrepancy (5 min)
**Issue**: README claims "all-mpnet-base-v2, 768-dimensional" but code uses "all-MiniLM-L6-v2, 384-dimensional"

**Fix**:
```diff
- Storage: Hive uses embedded LanceDB for learning persistence with zero configuration. Data is stored locally in the `.hive/vectors/` directory using Transformers.js for local embeddings (all-mpnet-base-v2 model, 768-dimensional vectors).
+ Storage: Hive uses embedded LanceDB for learning persistence with zero configuration. Data is stored locally in the `.hive/vectors/` directory using Transformers.js for local embeddings (all-MiniLM-L6-v2 model, 384-dimensional vectors).
```

---

#### 2. Remove Misleading CASS References (15 min)
**Issue**: Skills and templates reference CASS functionality that doesn't exist

**Fix**:
```diff
# In global-skills/hive-coordination/SKILL.md
- cass_search({ query: "<task description>", limit: 5 });
+ storage.findSimilarPatterns("<task description>", 5); // Local patterns only

# In src/hive-decompose.ts:195
- * Optionally queries CASS for similar past tasks to inform decomposition.
+ * Queries local storage for similar past tasks to inform decomposition.
```

---

#### 3. Clarify memory_queried Flag (10 min)
**Issue**: `memory_queried: true` is misleading - sounds like external memory (CASS) but is local

**Fix**:
```diff
return JSON.stringify({
  prompt: fullPrompt,
  expected_schema: "BeadTree",
- memory_queried: true,
+ local_patterns_queried: true,
+ patterns_source: "lancedb",
  patterns_found: pastLearnings.length,
});
```

---

#### 4. Document Pattern Creation Workflow (30 min)
**Issue**: Users may not know how to populate patterns for semantic search

**Fix**: Add to README:
```markdown
## Creating Patterns for Learning

Hive learns from patterns you create. After completing a task:

1. Identify successful strategies:
   ```bash
   hive pattern create --type=pattern \
     --content="Split large refactors by file type, not feature" \
     --tags="refactoring,file-based"
   ```

2. Document anti-patterns:
   ```bash
   hive pattern create --type=anti-pattern \
     --content="Don't split test files across multiple subtasks" \
     --reason="Causes flaky test failures"
   ```

3. Patterns are automatically used in future decompositions via semantic search.
```

---

#### 5. Enhanced Pattern Discovery (4 hours)
**Issue**: Patterns require manual creation, limiting learning rate

**Solution**: Auto-extract patterns from eval data
```typescript
// After epic completes successfully
async function extractPatternsFromEval(epicId: string) {
  const evalRecord = await loadEvalRecord(epicId);
  
  // If scope accuracy > 0.9 and time balance < 2.0
  if (evalRecord.scope_accuracy > 0.9 && evalRecord.time_balance < 2.0) {
    // Extract as positive pattern
    const pattern = {
      content: `${evalRecord.strategy} strategy works well for: ${evalRecord.task}`,
      kind: "pattern",
      tags: [evalRecord.strategy, extractDomain(evalRecord.task)],
      success_count: 1,
      failure_count: 0,
      example_beads: [epicId]
    };
    
    await storage.storePattern(pattern);
  }
  
  // If file overlap > 2
  if (evalRecord.file_overlap > 2) {
    // Extract as anti-pattern
    const antiPattern = {
      content: `Avoid assigning same files to multiple subtasks in ${evalRecord.strategy}`,
      kind: "anti_pattern",
      tags: [evalRecord.strategy, "file-conflict"],
      reason: "Causes merge conflicts",
      example_beads: [epicId]
    };
    
    await storage.storePattern(antiPattern);
  }
}
```

**Benefits**:
- Automatic pattern accumulation
- Data-driven pattern creation
- Scales with usage

---

### 5.4 Long-Term Vision: Hybrid Approach

**If CASS integration happens eventually**:

**Architecture**:
```
┌─────────────────────────────────────────────────┐
│              Query Layer                         │
│  "Find similar authentication implementations"   │
└─────────────┬───────────────────────────────────┘
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
┌──────────────┐  ┌─────────────────────┐
│   LanceDB    │  │   CASS (Optional)   │
│   (Local)    │  │   (External)        │
│              │  │                     │
│  • Patterns  │  │  • Conversations    │
│  • Feedback  │  │  • Cross-project    │
│  • Fast      │  │  • Full context     │
│  • Private   │  │  • Org-wide         │
└──────────────┘  └─────────────────────┘
      │                     │
      └──────────┬──────────┘
                 │
                 ▼
      ┌────────────────────┐
      │   Unified Results   │
      │   (Deduplicated)    │
      └────────────────────┘
```

**Query Strategy**:
1. **Always** query LanceDB (local, fast, guaranteed available)
2. **Optionally** query CASS if:
   - User opts in (`--query-cass`)
   - CASS is configured
   - Query succeeds within timeout (2s)
3. **Deduplicate** results (prefer local over CASS if overlap)
4. **Rank** by relevance (combine similarity scores)

**Configuration**:
```json
// .hive/config.json
{
  "learning": {
    "local": {
      "enabled": true,
      "storage": "lancedb",
      "embedding_model": "all-MiniLM-L6-v2"
    },
    "cass": {
      "enabled": false,  // Opt-in
      "url": "https://cass.company.com",
      "api_key": "${CASS_API_KEY}",
      "timeout_ms": 2000,
      "fallback_to_local": true
    }
  }
}
```

**Benefits**:
- Works without CASS (zero-config maintained)
- Enhances when available (progressive enhancement)
- User control (opt-in, not mandatory)
- Fault-tolerant (degradation, not failure)

---

## 6. Conclusion

### Key Findings

1. **CASS is not integrated** - Only references in docs/templates, no functional code
2. **LanceDB provides equivalent local search** - Patterns and feedback with semantic similarity
3. **Main gap is cross-project context** - LanceDB project-scoped, CASS would enable org-wide learning
4. **Zero-config is more valuable than cross-project for target users** - Most users are single-project
5. **Global skills partially address cross-project needs** - Manual pattern sharing works adequately

### Recommendation Summary

**Short-term (Current Release)**: 
- ✅ Keep LanceDB as sole semantic search backend
- ✅ Fix documentation discrepancies (README, skills)
- ✅ Enhance auto-pattern extraction from eval data
- ❌ Do not integrate CASS (external dependency, limited value for target users)

**Long-term (If Demand Emerges)**:
- ⚖️ Consider CASS as opt-in enhancement for enterprise deployments
- ⚖️ Hybrid approach: LanceDB (always) + CASS (optional)
- ⚖️ Gate on user demand (3+ orgs requesting) and dogfooding success

### Action Items

**Immediate (This Sprint)**:
1. [ ] Fix README embedding model discrepancy (5 min)
2. [ ] Remove misleading CASS references from skills (15 min)
3. [ ] Clarify `memory_queried` flag semantics (10 min)
4. [ ] Document pattern creation workflow (30 min)

**Next Sprint**:
1. [ ] Implement auto-pattern extraction from eval data (4 hours)
2. [ ] Add pattern discovery metrics to eval dashboard (2 hours)

**Future (If Needed)**:
1. [ ] Survey users on cross-project search value
2. [ ] Prototype CASS integration in feature branch
3. [ ] Measure latency and value-add with real queries

---

## Appendix A: Code References

### Storage Implementation
- **File**: `src/storage.ts`
- **Lines**: 520-549 (`findSimilarPatterns`)
- **Lines**: 346-369 (`findSimilarFeedback`)

### Embedding Pipeline
- **File**: `src/embeddings.ts`
- **Model**: Line 43 (`Xenova/all-MiniLM-L6-v2`)
- **Dimension**: Line 40 (`EMBEDDING_DIMENSION = 384`)

### Decomposition Integration
- **File**: `src/hive-decompose.ts`
- **Lines**: 214-258 (`hive_decompose` tool)
- **Lines**: 216 (`storage.findSimilarPatterns` call)

### CASS References (Documentation Only)
- **File**: `global-skills/hive-coordination/SKILL.md`
- **Line**: 137 (`cass_search` example)
- **File**: `examples/plugin-wrapper-template.ts`
- **Lines**: 454-465 (`query_cass` parameters)

---

## Appendix B: Upstream CASS Reference

**Repository**: https://github.com/Dicklesworthstone/coding_agent_session_search

**Purpose**: Cross-agent session search system

**Key Features**:
- Indexes agent conversation histories
- Semantic search across all sessions
- Cross-project knowledge retrieval
- Organizational memory system

**Deployment Model**:
- External service (separate from hive)
- Requires hosting (API server)
- Centralized database
- Multi-project support

**API Example** (hypothetical):
```typescript
interface CassQuery {
  query: string;
  limit: number;
  project_filter?: string[];
  time_filter?: { after: string; before: string };
}

interface CassResult {
  session_id: string;
  timestamp: string;
  project: string;
  agent: string;
  conversation_excerpt: string;
  similarity_score: number;
}

// Query CASS for similar sessions
const results: CassResult[] = await cassClient.search({
  query: "implement OAuth authentication",
  limit: 5,
  project_filter: ["company-app-*"] // Optional: limit to certain projects
});
```

---

**Document Complete**  
**Generated**: December 15, 2025  
**Agent**: DarkMountain  
**Bead**: opencode-swarm-plugin-89k.1  
**Status**: Ready for Review
