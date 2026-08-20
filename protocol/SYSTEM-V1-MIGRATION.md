# System Protocol Pack v1 migration map

The system-level assets that previously existed as documentation and helper-script conventions are now first-class plugin resources:

| Previous asset role | ArchScope v1 destination | Runtime treatment |
|---|---|---|
| State and document conventions | `protocol/contracts/` | Loaded and enforced by TypeScript validators |
| Analysis and safety guidance | `protocol/policies/` | Versioned, packaged, and available to model tasks |
| System writer and evidence-worker instructions | `protocol/prompts/` | Versioned task resources, not one global prompt |
| Contract helpers and validation scripts | `src/protocol/` | Native runtime implementation with tests |
| Per-repository codebase indexing scripts | `src/system/analyzer.ts` | DSH MCP orchestration with exact-root reuse, refresh, readiness checks, and bounded concurrency |
| Per-project evidence task builders | `src/system/analyzer.ts` + `protocol/prompts/system-evidence-task.md` | Isolated read-only `spawn` workers with a one-project tool scope and structured output |
| Registry and index-manifest builders | `src/system/discovery.ts` + `src/system/artifacts.ts` | Deterministic TypeScript generation with one-to-one coverage checks |
| System document validators | `src/protocol/validation.ts` + `src/system/artifacts.ts` | Deterministic heading, metadata, artifact, redaction, evidence, and gate validation |
| Script-generated provenance | `system/protocol-lock.json` | Per-run content digests for reproducibility |

Python and shell utilities are not runtime dependencies of the plugin. Their durable semantics have moved into contracts and TypeScript instead of being copied verbatim. The original scripts remain useful as migration references until parity is reviewed; environment-specific adapters can be added later behind capability interfaces.
