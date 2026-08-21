# System Protocol Pack v1 migration map

The system-level assets that previously existed as documentation and helper-script conventions are now first-class plugin resources:

| Previous asset role | ArchScope v1 destination | Runtime treatment |
|---|---|---|
| State and document conventions | `protocol/contracts/` | Loaded and enforced by TypeScript validators |
| Analysis and safety guidance | `protocol/policies/` | Versioned, packaged, and available to model tasks |
| System writer and evidence-worker instructions | `protocol/prompts/` | Full writer protocol injected into the current DSH main agent; focused worker envelope injected per project |
| Contract helpers and validation scripts | `src/protocol/` | Native runtime implementation with tests |
| Per-repository codebase indexing scripts | `src/system/analyzer.ts` | DSH MCP orchestration with exact-root reuse, refresh, readiness checks, and bounded concurrency |
| Per-project evidence task builders | `src/system/analyzer.ts` + `protocol/prompts/system-evidence-task.md` | Isolated read-only `spawn` workers with a one-project tool scope and structured output |
| Cross-project relation candidates | `system/relations.json` + `src/system/relations.ts` | Preserve individually reviewable typed worker candidates, add deterministic low-confidence name matches, validate coverage, and inject the complete catalog into synthesis without truncation |
| Registry and index-manifest builders | `src/system/discovery.ts` + `src/system/artifacts.ts` | Deterministic TypeScript generation with one-to-one coverage checks |
| Main-agent worldview synthesis | `src/system/synthesis.ts` + `src/tools/system-synthesis.ts` | Persist run-scoped evidence, inject up to 512 KiB in full by default, hand off to the invoking DSH main agent, allow bounded per-project evidence retrieval above the threshold, always inject complete relations, record provenance, archive every attempt, then accept one validated repair |
| System document validators | `src/protocol/validation.ts` + `src/system/artifacts.ts` | Deterministic heading, metadata, artifact, relation-statistic consistency, credential leakage, portable-path, diagram semantics, evidence, and semantic gate validation |
| Script-generated provenance | `system/protocol-lock.json` | Per-run content digests for reproducibility |
| Document history and retention | `system/history.json` + `runs/<run-id>/system/` | Monotonic fact-base revisions, immutable terminal snapshots, current-version promotion only after validation, and keep-all retention |

Python and shell utilities are not runtime dependencies of the plugin. Their durable semantics have moved into contracts and TypeScript instead of being copied verbatim. The original scripts remain useful as migration references until parity is reviewed; environment-specific adapters can be added later behind capability interfaces.
