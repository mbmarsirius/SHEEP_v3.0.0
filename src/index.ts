/**
 * SHEEP AI - Sleep-based Hierarchical Emergent Entity Protocol
 *
 * A cognitive memory system for AI agents that:
 * - Extracts facts and causal relationships from conversations
 * - Consolidates memories during sleep-like cycles
 * - Retrieves memories with causal reasoning
 * - Complies with GDPR/privacy requirements
 *
 * @module @sheep-ai/core
 */

// Memory module - schemas and database
export * from "./memory/index.js";

// Extraction module - episode and fact extraction
export * from "./extraction/index.js";

// Causal module - causal reasoning engine
export * from "./causal/index.js";

// Procedures module - procedural memory
export * from "./procedures/index.js";

// Consolidation module - sleep-like processing
export * from "./consolidation/index.js";

// Prefetch module - predictive memory loading
export * from "./prefetch/index.js";

// Privacy module - GDPR/HIPAA compliance
export * from "./privacy/index.js";

// Tools module - agent memory tools
export * from "./tools/index.js";

// Retrieval module - recall and query
export * from "./retrieval/index.js";
