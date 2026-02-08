# SHEEP AI - MASTER IMPLEMENTATION PLAN
## Sleep-based Hierarchical Emergent Entity Protocol for Artificial Intelligence

**Created**: January 28, 2026
**Vision**: The world's first Distributed Cognitive Mesh for Personal AI
**Built On**: Moltbot (https://github.com/moltbot/moltbot)

---

```
███████╗██╗  ██╗███████╗███████╗██████╗      █████╗ ██╗
██╔════╝██║  ██║██╔════╝██╔════╝██╔══██╗    ██╔══██╗██║
███████╗███████║█████╗  █████╗  ██████╔╝    ███████║██║
╚════██║██╔══██║██╔══╝  ██╔══╝  ██╔═══╝     ██╔══██║██║
███████║██║  ██║███████╗███████╗██║         ██║  ██║██║
╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝         ╚═╝  ╚═╝╚═╝

    "Memory is not storage. Memory is cognition."
```

---

## EXECUTIVE SUMMARY

SHEEP AI transforms Moltbot from a personal AI assistant into a **Distributed Cognitive Mesh** - a federated network of personal AIs that:
- Sleep-consolidate memories like human brains
- Share patterns (not data) to create collective wisdom
- Lend idle compute/memory to the mesh
- Develop emergent intelligence no single node possesses

**Breakthrough Potential**: 9.5/10
**Novelty Score**: 10/10 (No one has done this)
**Phase 0 Success Probability**: 75-85%

---

## ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHEEP AI ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LAYER 4: APPLICATION                              │   │
│  │  Moltbot Interface │ Voice │ Multi-Channel │ Native Apps             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LAYER 3: COGNITIVE MEMORY                         │   │
│  │  Episodes │ Facts │ Procedures │ Causal Links │ Knowledge Graph      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LAYER 2: FEDERATION                               │   │
│  │  Pattern Distillation │ Template Sharing │ Secure Aggregation        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LAYER 1: PRIVACY                                  │   │
│  │  Differential Privacy │ Homomorphic Encryption │ Secure MPC          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    LAYER 0: TRANSPORT                                │   │
│  │  Matrix/ActivityPub │ E2EE │ mDNS/DHT Discovery │ WebRTC P2P         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 0: COGNITIVE MEMORY CORE
### Timeline: Weeks 1-16 | Success Probability: 75-85%

**Goal**: Make a single SHEEP AI instance have radically better memory than any existing personal AI.

---

### MILESTONE 0.1: Data Schema & Storage Layer
**Timeline**: Weeks 1-3

#### TODO 0.1.1: Create Cognitive Memory Schema
- [ ] Create `src/sheep/memory/schema.ts`
- [ ] Define `Episode` interface (what happened, when, participants, topic, salience, utility)
- [ ] Define `Fact` interface (subject-predicate-object with confidence, evidence, timestamps)
- [ ] Define `CausalLink` interface (cause → effect → mechanism → confidence)
- [ ] Define `Procedure` interface (trigger → action → examples → success rate)
- [ ] Define `MemoryHierarchy` interface combining all layers
- [ ] Add TypeBox schemas for validation
- [ ] Write unit tests for schema validation

#### TODO 0.1.2: SQLite Database Extension
- [ ] Create `src/sheep/memory/database.ts`
- [ ] Extend existing `~/.clawdbot/memory/<agentId>.sqlite`
- [ ] Create `episodes` table with indexes on timestamp, topic, salience
- [ ] Create `facts` table with indexes on subject, predicate, confidence
- [ ] Create `causal_links` table with indexes on cause_id, effect_id
- [ ] Create `procedures` table with indexes on trigger
- [ ] Create `memory_changes` table for differential encoding (track what changed)
- [ ] Create `consolidation_runs` table for tracking sleep cycles
- [ ] Write migration script from existing memory format
- [ ] Add foreign key constraints and indexes
- [ ] Write CRUD operations for each table
- [ ] Write unit tests for database operations

#### TODO 0.1.3: Memory Index Integration
- [ ] Update `src/memory/manager.ts` to support new schema
- [ ] Add cognitive memory tables to existing vector index
- [ ] Create hybrid search: BM25 + vector + structured query
- [ ] Add entity-aware chunking for facts
- [ ] Write integration tests with existing memory system

---

### MILESTONE 0.2: Episode Extraction Pipeline
**Timeline**: Weeks 4-5

#### TODO 0.2.1: Session-to-Episode Converter
- [ ] Create `src/sheep/extraction/episode-extractor.ts`
- [ ] Parse existing JSONL session transcripts
- [ ] Group messages into coherent episodes (topic + time window)
- [ ] Calculate episode metadata:
  - [ ] Emotional salience (sentiment analysis)
  - [ ] Utility score (action taken? question answered?)
  - [ ] Topic extraction (LLM-based or keyword)
  - [ ] Participant identification
- [ ] Handle multi-turn conversations as single episodes
- [ ] Write tests with sample session data

#### TODO 0.2.2: Episode Summarization
- [ ] Create `src/sheep/extraction/episode-summarizer.ts`
- [ ] Use small/cheap model for summarization (Haiku/GPT-4o-mini/local)
- [ ] Generate one-sentence summaries for each episode
- [ ] Extract key entities mentioned
- [ ] Link episodes to existing memory files
- [ ] Write tests for summarization quality

---

### MILESTONE 0.3: Fact Extraction Pipeline
**Timeline**: Weeks 5-7

#### TODO 0.3.1: Fact Extractor
- [ ] Create `src/sheep/extraction/fact-extractor.ts`
- [ ] Extract subject-predicate-object triples from episodes
- [ ] Use Named Entity Recognition (spaCy via API or local)
- [ ] Use Relation Extraction model
- [ ] Calculate initial confidence scores
- [ ] Link facts to source episodes
- [ ] Handle negations and conditionals
- [ ] Write tests for extraction accuracy

#### TODO 0.3.2: Contradiction Detector
- [ ] Create `src/sheep/extraction/contradiction-detector.ts`
- [ ] Compare new facts against existing facts
- [ ] Detect semantic contradictions (not just string matching)
- [ ] Use embedding similarity for fuzzy matching
- [ ] Flag potential contradictions for resolution
- [ ] Write tests for contradiction detection

#### TODO 0.3.3: Fact Resolver
- [ ] Create `src/sheep/extraction/fact-resolver.ts`
- [ ] Resolution rules:
  - [ ] More recent facts win (recency)
  - [ ] Higher confidence facts win
  - [ ] User-affirmed facts always win
  - [ ] Facts with more evidence win
- [ ] Update confidence scores on resolution
- [ ] Keep contradiction history (don't delete, demote)
- [ ] Write tests for resolution logic

---

### MILESTONE 0.4: Causal Reasoning Engine
**Timeline**: Weeks 7-9

#### TODO 0.4.1: Causal Link Extractor
- [ ] Create `src/sheep/causal/extractor.ts`
- [ ] Identify cause-effect patterns in episodes
- [ ] Extract mechanism (why cause led to effect)
- [ ] Parse temporal relationships (before/after/during)
- [ ] Calculate causal confidence scores
- [ ] Use prompting: "What caused X to change to Y?"
- [ ] Write tests for causal extraction

#### TODO 0.4.2: Causal Graph Builder
- [ ] Create `src/sheep/causal/graph.ts`
- [ ] Build directed graph of causal relationships
- [ ] Detect causal chains (A → B → C)
- [ ] Detect causal loops (feedback)
- [ ] Visualize graph for debugging
- [ ] Query interface: "Why did X happen?"
- [ ] Write tests for graph operations

#### TODO 0.4.3: Temporal Reasoning
- [ ] Create `src/sheep/causal/temporal.ts`
- [ ] Track when facts became true/false
- [ ] Support point-in-time queries ("What did I believe on Jan 15?")
- [ ] Track fact evolution over time
- [ ] Write tests for temporal queries

---

### MILESTONE 0.5: Procedural Memory
**Timeline**: Weeks 9-10

#### TODO 0.5.1: Procedure Extractor
- [ ] Create `src/sheep/procedures/extractor.ts`
- [ ] Identify behavioral patterns from episodes
- [ ] Extract: trigger condition → action taken → outcome
- [ ] Track success rate of procedures
- [ ] Link to supporting episodes
- [ ] Write tests for extraction

#### TODO 0.5.2: Procedure Matcher
- [ ] Create `src/sheep/procedures/matcher.ts`
- [ ] Match incoming queries to known procedures
- [ ] Rank by relevance and success rate
- [ ] Support fuzzy trigger matching
- [ ] Write tests for matching accuracy

---

### MILESTONE 0.6: Consolidation Daemon ("Sleep")
**Timeline**: Weeks 10-12

#### TODO 0.6.1: Consolidation Scheduler
- [ ] Create `src/sheep/consolidation/scheduler.ts`
- [ ] Detect idle periods (configurable, default: 2+ hours no activity)
- [ ] Schedule consolidation during idle
- [ ] Support manual trigger via `moltbot sheep consolidate`
- [ ] Support cron-based scheduling (e.g., 3 AM daily)
- [ ] Prevent duplicate runs
- [ ] Write tests for scheduling logic

#### TODO 0.6.2: Consolidation Pipeline
- [ ] Create `src/sheep/consolidation/pipeline.ts`
- [ ] Step 1: Load recent raw sessions (last 24h or since last run)
- [ ] Step 2: Extract episodes from sessions
- [ ] Step 3: Extract facts from episodes
- [ ] Step 4: Detect and resolve contradictions
- [ ] Step 5: Extract causal links
- [ ] Step 6: Extract procedures
- [ ] Step 7: Update memory indexes
- [ ] Step 8: Run active forgetting (prune low-value)
- [ ] Step 9: Log consolidation results
- [ ] Write end-to-end tests

#### TODO 0.6.3: Active Forgetting Engine
- [ ] Create `src/sheep/consolidation/forgetting.ts`
- [ ] Calculate retention score for each memory:
  - [ ] Access frequency (20% weight)
  - [ ] Emotional salience (15% weight)
  - [ ] Causal importance (25% weight)
  - [ ] Recency (15% weight)
  - [ ] Uniqueness (15% weight)
  - [ ] User explicit marking (10% weight)
- [ ] Prune memories below threshold
- [ ] Demote instead of delete (raw → episode → fact)
- [ ] Keep memories with unique causal links
- [ ] Write tests for forgetting logic

---

### MILESTONE 0.7: Predictive Memory Prefetch
**Timeline**: Weeks 12-14

#### TODO 0.7.1: Intent Classifier
- [ ] Create `src/sheep/prefetch/intent-classifier.ts`
- [ ] Classify incoming messages into:
  - [ ] `factual_recall` - looking for stored facts
  - [ ] `episodic_recall` - referencing past conversations
  - [ ] `procedural` - asking how to do something
  - [ ] `causal_reasoning` - asking why something happened
  - [ ] `general` - no specific memory need
- [ ] Use fast model (local or API)
- [ ] <100ms latency requirement
- [ ] Write tests for classification accuracy

#### TODO 0.7.2: Entity Extractor
- [ ] Create `src/sheep/prefetch/entity-extractor.ts`
- [ ] Extract entities from incoming message
- [ ] Link to known entities in memory
- [ ] Handle coreference ("it", "that", "the thing")
- [ ] Write tests for extraction

#### TODO 0.7.3: Temporal Hint Parser
- [ ] Create `src/sheep/prefetch/temporal-parser.ts`
- [ ] Parse temporal references:
  - [ ] "remember when" → episodic
  - [ ] "like we discussed" → recent episodic
  - [ ] "you always" → procedural
  - [ ] "last time" → recent episodic
  - [ ] "why did" → causal
- [ ] Write tests for parsing

#### TODO 0.7.4: Memory Router
- [ ] Create `src/sheep/prefetch/router.ts`
- [ ] Route to appropriate memory type based on:
  - [ ] Intent classification
  - [ ] Entities mentioned
  - [ ] Temporal hints
- [ ] Parallel fetch from multiple sources
- [ ] Respect token budget (configurable, default 4000)
- [ ] Rank and select most relevant memories
- [ ] Write tests for routing logic

#### TODO 0.7.5: Prefetch Integration
- [ ] Modify `src/auto-reply/reply/agent-runner.ts`
- [ ] Add prefetch hook before LLM call
- [ ] Inject prefetched memories into context
- [ ] Log what was prefetched and why
- [ ] Track prefetch hit rate
- [ ] Write integration tests

---

### MILESTONE 0.8: Memory Tools & CLI
**Timeline**: Weeks 14-15

#### TODO 0.8.1: SHEEP Memory Tools for Agent
- [ ] Create `src/sheep/tools/memory-tools.ts`
- [ ] Tool: `sheep_remember` - explicit memory storage
- [ ] Tool: `sheep_recall` - explicit memory retrieval
- [ ] Tool: `sheep_why` - causal chain query
- [ ] Tool: `sheep_forget` - explicit forgetting request
- [ ] Tool: `sheep_correct` - user correction of facts
- [ ] Register tools with Pi runtime
- [ ] Write tests for each tool

#### TODO 0.8.2: CLI Commands
- [ ] Create `src/sheep/cli/commands.ts`
- [ ] `moltbot sheep status` - show memory statistics
- [ ] `moltbot sheep consolidate` - trigger manual consolidation
- [ ] `moltbot sheep query <question>` - query memory directly
- [ ] `moltbot sheep graph` - visualize knowledge graph
- [ ] `moltbot sheep export` - export memory as JSON
- [ ] `moltbot sheep import` - import memory from JSON
- [ ] `moltbot sheep forget <topic>` - forget specific topic
- [ ] Write CLI tests

---

### MILESTONE 0.9: Evaluation & Testing
**Timeline**: Week 15-16

#### TODO 0.9.1: Memory Benchmark Suite
- [ ] Create `src/sheep/tests/benchmark.ts`
- [ ] Test: Fact recall accuracy (given prompt, retrieve correct fact)
- [ ] Test: Episode recall accuracy (given reference, find episode)
- [ ] Test: Causal reasoning accuracy (given "why", trace causality)
- [ ] Test: Contradiction detection (insert conflicting facts)
- [ ] Test: Forgetting appropriateness (high-value kept, low-value pruned)
- [ ] Test: Prefetch hit rate (did we load the right memories?)
- [ ] Generate benchmark report

#### TODO 0.9.2: A/B Testing Framework
- [ ] Create `src/sheep/tests/ab-framework.ts`
- [ ] Compare SHEEP memory vs existing memory
- [ ] Metrics:
  - [ ] User satisfaction rating
  - [ ] Memory recall accuracy
  - [ ] Response relevance
  - [ ] Context utilization
- [ ] Statistical significance testing
- [ ] Generate comparison report

#### TODO 0.9.3: Beta User Onboarding
- [ ] Create onboarding docs for beta testers
- [ ] Set up feedback collection mechanism
- [ ] Create opt-in flag for SHEEP features
- [ ] Monitor for errors and edge cases
- [ ] Iterate based on feedback

---

## PHASE 1: FEDERATION LAYER
### Timeline: Weeks 17-28 | Success Probability: 45-60%

**Goal**: Enable two or more SHEEP AI instances to share patterns without sharing data.

---

### MILESTONE 1.1: Pattern Distillation
**Timeline**: Weeks 17-19

#### TODO 1.1.1: Template Extractor
- [ ] Create `src/sheep/federation/template-extractor.ts`
- [ ] Extract anonymized causal templates from local causal graph
- [ ] Example: `[concern_type] → [separation_strategy] → [outcome]`
- [ ] Remove all PII from templates
- [ ] Calculate template confidence based on local evidence
- [ ] Write tests for anonymization completeness

#### TODO 1.1.2: Procedural Recipe Extractor
- [ ] Create `src/sheep/federation/recipe-extractor.ts`
- [ ] Extract generic procedural patterns
- [ ] Example: "When debugging X, verbose output helps"
- [ ] Remove user-specific details
- [ ] Include success metrics
- [ ] Write tests for generalization

#### TODO 1.1.3: Retrieval Heuristic Extractor
- [ ] Create `src/sheep/federation/heuristic-extractor.ts`
- [ ] Track which memory retrieval strategies worked
- [ ] Extract patterns: "For queries mentioning X, episodic memory was most useful"
- [ ] Anonymize and generalize
- [ ] Write tests

---

### MILESTONE 1.2: Privacy Layer
**Timeline**: Weeks 19-22

#### TODO 1.2.1: Differential Privacy Implementation
- [ ] Create `src/sheep/privacy/differential.ts`
- [ ] Implement DP noise addition to aggregates
- [ ] Configure privacy budget (epsilon)
- [ ] Track cumulative privacy loss
- [ ] Refuse sharing if budget exhausted
- [ ] Write tests for privacy guarantees

#### TODO 1.2.2: Secure Aggregation
- [ ] Create `src/sheep/privacy/secure-aggregation.ts`
- [ ] Implement secure multi-party computation for aggregates
- [ ] No single party sees individual contributions
- [ ] Support 3+ party aggregation
- [ ] Write tests for aggregation correctness

#### TODO 1.2.3: PII Detector
- [ ] Create `src/sheep/privacy/pii-detector.ts`
- [ ] Detect names, emails, phone numbers, addresses
- [ ] Detect custom PII patterns (configurable)
- [ ] Block any template with detected PII
- [ ] Write tests for detection accuracy

---

### MILESTONE 1.3: Transport Layer
**Timeline**: Weeks 22-25

#### TODO 1.3.1: Mesh Discovery
- [ ] Create `src/sheep/transport/discovery.ts`
- [ ] mDNS for local network discovery
- [ ] DHT (Kademlia) for global discovery
- [ ] Support Tailscale-only mode (trusted network)
- [ ] Node identity with public key
- [ ] Write tests for discovery

#### TODO 1.3.2: E2EE Communication
- [ ] Create `src/sheep/transport/crypto.ts`
- [ ] Implement Signal protocol (double ratchet)
- [ ] Key exchange and rotation
- [ ] Message signing for authenticity
- [ ] Write tests for encryption/decryption

#### TODO 1.3.3: Federation Protocol
- [ ] Create `src/sheep/transport/protocol.ts`
- [ ] Message types:
  - [ ] `ANNOUNCE` - declare presence
  - [ ] `TEMPLATE_OFFER` - offer template for sharing
  - [ ] `TEMPLATE_REQUEST` - request templates
  - [ ] `TEMPLATE_EXCHANGE` - exchange templates
  - [ ] `PING/PONG` - keepalive
- [ ] Implement request/response flow
- [ ] Handle network partitions gracefully
- [ ] Write protocol tests

---

### MILESTONE 1.4: Trust & Reputation
**Timeline**: Weeks 25-28

#### TODO 1.4.1: Node Identity
- [ ] Create `src/sheep/trust/identity.ts`
- [ ] Generate persistent node keypair
- [ ] Support key rotation
- [ ] Store in secure location
- [ ] Write tests for key management

#### TODO 1.4.2: Template Signing
- [ ] Create `src/sheep/trust/signing.ts`
- [ ] Sign all shared templates
- [ ] Verify signatures on received templates
- [ ] Reject unsigned or invalid templates
- [ ] Write tests for signing/verification

#### TODO 1.4.3: Reputation System
- [ ] Create `src/sheep/trust/reputation.ts`
- [ ] Track template quality from each node
- [ ] Upvote templates that improved local performance
- [ ] Downvote templates that degraded performance
- [ ] Share reputation scores across mesh (carefully)
- [ ] Write tests for reputation calculation

#### TODO 1.4.4: Poisoning Resistance
- [ ] Create `src/sheep/trust/anti-poison.ts`
- [ ] Detect anomalous templates (outliers)
- [ ] Quarantine suspicious templates
- [ ] Require quorum for template acceptance
- [ ] Rate-limit new/unknown nodes
- [ ] Write tests for poison detection

---

## PHASE 2: COLLECTIVE INTELLIGENCE
### Timeline: Weeks 29-44 | Success Probability: 20-35%

**Goal**: N SHEEP AI nodes form a mesh with emergent collective intelligence.

---

### MILESTONE 2.1: Federated Sleep Consolidation
**Timeline**: Weeks 29-33

#### TODO 2.1.1: Coordinated Consolidation
- [ ] Create `src/sheep/collective/federated-sleep.ts`
- [ ] Coordinate consolidation timing across mesh
- [ ] Share consolidation insights (not data)
- [ ] Aggregate pattern frequencies across nodes
- [ ] Identify globally common patterns
- [ ] Write tests for coordination

#### TODO 2.1.2: Pattern Aggregation
- [ ] Create `src/sheep/collective/pattern-aggregator.ts`
- [ ] Collect distilled patterns from participating nodes
- [ ] Apply differential privacy to aggregates
- [ ] Calculate global confidence scores
- [ ] Identify patterns that appear across many users
- [ ] Write tests for aggregation

#### TODO 2.1.3: Wisdom Distribution
- [ ] Create `src/sheep/collective/wisdom-distributor.ts`
- [ ] Distribute high-confidence global patterns to nodes
- [ ] Prioritize novel patterns not yet seen locally
- [ ] Rate-limit to prevent overwhelming nodes
- [ ] Write tests for distribution

---

### MILESTONE 2.2: Causal Knowledge Federation
**Timeline**: Weeks 33-37

#### TODO 2.2.1: Causal Template Sharing
- [ ] Create `src/sheep/collective/causal-federation.ts`
- [ ] Share causal template structures (anonymized)
- [ ] Example: `[concern] → [action] → [resolution]`
- [ ] No specific values, only structure
- [ ] Write tests for template sharing

#### TODO 2.2.2: Causal Chain Discovery
- [ ] Create `src/sheep/collective/causal-discovery.ts`
- [ ] Discover causal patterns across the mesh
- [ ] Identify common cause-effect relationships
- [ ] Build collective causal knowledge
- [ ] Write tests for discovery

#### TODO 2.2.3: Causal Reasoning Enhancement
- [ ] Create `src/sheep/collective/causal-enhancement.ts`
- [ ] Use collective causal knowledge to enhance local reasoning
- [ ] "Users with concern X often found solution Y"
- [ ] Maintain privacy (no individual data shared)
- [ ] Write tests for enhancement

---

### MILESTONE 2.3: Resource Lending (Careful!)
**Timeline**: Weeks 37-41

#### TODO 2.3.1: Compute Lending Protocol
- [ ] Create `src/sheep/lending/compute.ts`
- [ ] Define lending request/offer protocol
- [ ] Only lend for public tasks (open models, open data)
- [ ] Sandboxed execution environment
- [ ] Resource quotas (CPU, memory, time)
- [ ] Write tests for lending protocol

#### TODO 2.3.2: Memory Lending Protocol
- [ ] Create `src/sheep/lending/memory.ts`
- [ ] Lend unused vector index capacity
- [ ] Sharded index distribution
- [ ] Encrypted shard storage
- [ ] Write tests for memory lending

#### TODO 2.3.3: Credit System
- [ ] Create `src/sheep/lending/credits.ts`
- [ ] Track lending contributions
- [ ] Track borrowing usage
- [ ] Simple credit balance (no blockchain required)
- [ ] Optional: token-based incentives
- [ ] Write tests for credit accounting

#### TODO 2.3.4: Personal Device Mesh (Safe First)
- [ ] Create `src/sheep/lending/personal-mesh.ts`
- [ ] Start with lending between user's own devices only
- [ ] Phone ↔ Mac Mini ↔ Desktop
- [ ] Much safer than public mesh
- [ ] Prove the concept before opening up
- [ ] Write tests for personal mesh

---

### MILESTONE 2.4: Emergent Pattern Detection
**Timeline**: Weeks 41-44

#### TODO 2.4.1: Pattern Emergence Monitor
- [ ] Create `src/sheep/emergence/monitor.ts`
- [ ] Track patterns that appear across many nodes
- [ ] Identify emergent collective behaviors
- [ ] Distinguish signal from noise
- [ ] Write tests for emergence detection

#### TODO 2.4.2: Collective Wisdom Synthesizer
- [ ] Create `src/sheep/emergence/synthesizer.ts`
- [ ] Synthesize high-confidence collective knowledge
- [ ] "Humans generally do X when facing Y"
- [ ] Weight by evidence count and diversity
- [ ] Write tests for synthesis

#### TODO 2.4.3: New User Bootstrap
- [ ] Create `src/sheep/emergence/bootstrap.ts`
- [ ] Provide collective wisdom to new SHEEP AI instances
- [ ] Day-1 intelligence from collective learning
- [ ] Privacy-preserving (no individual data)
- [ ] Write tests for bootstrap effectiveness

---

## PHASE 3: PRODUCTION SCALE
### Timeline: Weeks 45-60+ | Success Probability: 10-25%

**Goal**: Production-ready SHEEP AI mesh for thousands of users.

---

### MILESTONE 3.1: Scale & Performance
**Timeline**: Weeks 45-50

#### TODO 3.1.1: Performance Optimization
- [ ] Profile and optimize hot paths
- [ ] Caching layer for frequent queries
- [ ] Batch processing for consolidation
- [ ] Async/parallel operations where possible
- [ ] Benchmark at 1K, 10K, 100K nodes

#### TODO 3.1.2: Storage Optimization
- [ ] Implement differential encoding (store changes, not duplicates)
- [ ] Compression for archived episodes
- [ ] Tiered storage (hot/warm/cold)
- [ ] Automatic cleanup of expired data

#### TODO 3.1.3: Network Optimization
- [ ] Gossip protocol for efficient propagation
- [ ] Connection pooling
- [ ] Bandwidth throttling
- [ ] Geographic clustering for latency

---

### MILESTONE 3.2: Security Hardening
**Timeline**: Weeks 50-55

#### TODO 3.2.1: Security Audit
- [ ] Third-party security audit of crypto
- [ ] Penetration testing of federation layer
- [ ] Privacy audit of shared data
- [ ] Fix all critical/high findings

#### TODO 3.2.2: Formal Verification
- [ ] Formal verification of privacy guarantees
- [ ] Prove DP budget calculations correct
- [ ] Verify no data leakage paths
- [ ] Document verification results

#### TODO 3.2.3: Sybil Resistance
- [ ] Implement proof-of-humanity (optional)
- [ ] Rate limiting per identity
- [ ] Reputation gates for participation
- [ ] Detect and block botnet patterns

---

### MILESTONE 3.3: User Experience
**Timeline**: Weeks 55-58

#### TODO 3.3.1: Simple Onboarding
- [ ] One-click mesh join
- [ ] Clear privacy explanations
- [ ] Granular control over what's shared
- [ ] Easy opt-out

#### TODO 3.3.2: Dashboard
- [ ] Web dashboard for SHEEP AI stats
- [ ] Memory health visualization
- [ ] Mesh connectivity status
- [ ] Privacy budget remaining
- [ ] Contribution/consumption balance

#### TODO 3.3.3: Notifications
- [ ] Notify when consolidation runs
- [ ] Notify when new wisdom received
- [ ] Notify on unusual activity
- [ ] Configurable notification preferences

---

### MILESTONE 3.4: Enterprise & Family
**Timeline**: Weeks 58-60+

#### TODO 3.4.1: Family Mesh
- [ ] Private mesh for family members
- [ ] Shared family knowledge base
- [ ] Privacy controls between members
- [ ] Easy setup via invite codes

#### TODO 3.4.2: Enterprise Mesh
- [ ] Organization-wide SHEEP AI deployment
- [ ] Admin controls and policies
- [ ] Compliance features (GDPR, HIPAA)
- [ ] Audit logging

#### TODO 3.4.3: API & Integrations
- [ ] REST API for SHEEP AI memory
- [ ] Webhook for consolidation events
- [ ] Integration with external tools
- [ ] SDK for developers

---

## SUCCESS METRICS

### Phase 0 Metrics (Must Achieve)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Fact recall accuracy | >85% | Benchmark suite |
| Episode recall accuracy | >80% | Benchmark suite |
| Causal reasoning accuracy | >70% | Manual evaluation |
| Prefetch hit rate | >60% | Runtime logging |
| User satisfaction | 4+ / 5 | Beta user survey |
| Memory consolidation time | <5 min/day | Performance logging |

### Phase 1 Metrics (Must Achieve)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Template exchange success | >95% | Protocol logging |
| Zero PII leakage | 100% | Security audit |
| Privacy budget utilization | <50% | DP accounting |
| Mesh latency (local) | <500ms | Performance logging |

### Phase 2 Metrics (Stretch Goals)
| Metric | Target | How to Measure |
|--------|--------|----------------|
| Emergent pattern detection | >10 patterns | Emergence monitor |
| New user bootstrap improvement | 20%+ better recall | A/B testing |
| Collective wisdom accuracy | >75% | Manual evaluation |

---

## FILE STRUCTURE

```
src/sheep/
├── memory/
│   ├── schema.ts              # Data types
│   ├── database.ts            # SQLite operations
│   └── index.ts               # Exports
│
├── extraction/
│   ├── episode-extractor.ts   # Session → Episodes
│   ├── episode-summarizer.ts  # Episode summaries
│   ├── fact-extractor.ts      # Episodes → Facts
│   ├── contradiction-detector.ts
│   ├── fact-resolver.ts
│   └── index.ts
│
├── causal/
│   ├── extractor.ts           # Causal link extraction
│   ├── graph.ts               # Causal graph operations
│   ├── temporal.ts            # Temporal reasoning
│   └── index.ts
│
├── procedures/
│   ├── extractor.ts           # Procedure extraction
│   ├── matcher.ts             # Procedure matching
│   └── index.ts
│
├── consolidation/
│   ├── scheduler.ts           # Sleep scheduling
│   ├── pipeline.ts            # Consolidation pipeline
│   ├── forgetting.ts          # Active forgetting
│   └── index.ts
│
├── prefetch/
│   ├── intent-classifier.ts   # Intent classification
│   ├── entity-extractor.ts    # Entity extraction
│   ├── temporal-parser.ts     # Temporal hint parsing
│   ├── router.ts              # Memory routing
│   └── index.ts
│
├── tools/
│   ├── memory-tools.ts        # Agent tools
│   └── index.ts
│
├── cli/
│   ├── commands.ts            # CLI commands
│   └── index.ts
│
├── tests/
│   ├── benchmark.ts           # Benchmark suite
│   ├── ab-framework.ts        # A/B testing
│   └── index.ts
│
├── federation/                 # Phase 1
│   ├── template-extractor.ts
│   ├── recipe-extractor.ts
│   ├── heuristic-extractor.ts
│   └── index.ts
│
├── privacy/                    # Phase 1
│   ├── differential.ts
│   ├── secure-aggregation.ts
│   ├── pii-detector.ts
│   └── index.ts
│
├── transport/                  # Phase 1
│   ├── discovery.ts
│   ├── crypto.ts
│   ├── protocol.ts
│   └── index.ts
│
├── trust/                      # Phase 1
│   ├── identity.ts
│   ├── signing.ts
│   ├── reputation.ts
│   ├── anti-poison.ts
│   └── index.ts
│
├── collective/                 # Phase 2
│   ├── federated-sleep.ts
│   ├── pattern-aggregator.ts
│   ├── wisdom-distributor.ts
│   ├── causal-federation.ts
│   ├── causal-discovery.ts
│   ├── causal-enhancement.ts
│   └── index.ts
│
├── lending/                    # Phase 2
│   ├── compute.ts
│   ├── memory.ts
│   ├── credits.ts
│   ├── personal-mesh.ts
│   └── index.ts
│
├── emergence/                  # Phase 2
│   ├── monitor.ts
│   ├── synthesizer.ts
│   ├── bootstrap.ts
│   └── index.ts
│
└── index.ts                    # Main export
```

---

## HOW TO USE THIS DOCUMENT

### For Cursor AI Agents:

1. **Read this entire document first**
2. **Start with Phase 0, Milestone 0.1**
3. **Complete each TODO in order within a milestone**
4. **Test each component before moving on**
5. **Do not skip to later phases until current phase metrics are met**

### For Human Developers:

1. **Review the architecture diagram**
2. **Understand the data flow**
3. **Assign milestones to sprints**
4. **Track progress against success metrics**
5. **Adjust timeline based on learnings**

---

## REMEMBER

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   "Memory is not storage. Memory is cognition."                     │
│                                                                     │
│   Phase 0 ALONE is valuable.                                        │
│   Phase 1 requires Phase 0 to prove value first.                    │
│   Phase 2+ is moonshot territory.                                   │
│                                                                     │
│   Build incrementally.                                              │
│   Test obsessively.                                                 │
│   Ship fast, iterate faster.                                        │
│                                                                     │
│   The goal is not to build everything.                              │
│   The goal is to build something that WORKS.                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

**Document Version**: 1.0.0
**Last Updated**: January 28, 2026
**Next Review**: After Phase 0, Milestone 0.3 completion
