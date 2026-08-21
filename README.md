# ArchScope

**English** | [简体中文](./README.zh-CN.md)

> Evidence-driven architecture reconnaissance for complex, multi-repository software systems—built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

**See the system before changing the code.**

ArchScope helps AI agents genuinely take over an unfamiliar software system—not merely browse directories, count files, or produce an architecture summary that sounds complete.

It brings source discovery, evidence collection, system modeling, project profiling, layer gates, parallel orchestration, deterministic validation, and an architecture portal into one recoverable, verifiable, and extensible scanning protocol, delivered as a native DeepSeek Harness plugin.

**Project status: v0.1.0 establishes the first runnable source-level system scan preview; the npm package is not yet published.** ArchScope can discover Git projects, build or reuse an independent codebase-memory index for each project, run isolated read-only evidence workers, hand their evidence to the current DSH main agent for a 22-section system synthesis, and enforce gates over both machine-readable and Markdown artifacts. Runtime evidence, project scans, and resume orchestration are still under development.

> **Core model: system level defines the worldview, project level defines the engineering profile, module level defines internal boundaries, and code level defines concrete paths.**

Module analysis maps capabilities and responsibilities horizontally; code analysis follows real execution paths vertically.

## Why ArchScope

When an agent enters a large codebase for the first time, the easiest result to produce is one that is locally correct but globally wrong:

- seeing a dependency and assuming it is enabled in production;
- seeing a few directories and treating them as the real business boundaries;
- scanning one repository while ignoring its role in the wider system;
- generating pages of conclusions with no traceable evidence;
- dispatching parallel agents without a shared fact base or conflict resolution;
- losing a session and no longer knowing what was completed or which results remain trustworthy.

ArchScope starts from a different premise:

> Architecture understanding is not a one-shot code summary. It is an engineering process—from evidence to conclusions and from local detail to system context—that must be verifiable and recoverable.

## What makes ArchScope different

### Evidence before conclusions

Every important conclusion should point to reviewable evidence. Anything that cannot be proven must be marked for confirmation. A capability visible in source code is not necessarily enabled in production.

### Establish the system worldview before profiling projects

ArchScope does not let multiple agents independently interpret a system without shared context. A system-level fact base first aligns production boundaries, project identities, infrastructure, entry points, and terminology. Project-level analysis then inherits those facts.

### Let models reason; let programs enforce discipline

Models handle judgment and synthesis. Deterministic programs handle state machines, task plans, contract validation, identity resolution, batch recovery, exact relation statistics, portable-path checks, and credential-secret checks.

### Multi-repository from day one

Project identity is based on the workspace-relative path, not the directory basename. Repositories with the same name, nested repositories, aggregation directories, and composite projects are never silently merged.

### Native to the plugin runtime

ArchScope is not a long prompt wrapped in an npm package. It is designed around Cordis services, model-facing tools, capability providers, and a Harness bundle so that scanning capabilities can be composed, replaced, hot-reloaded, and reused.

## Analysis model

ArchScope uses layers to control analysis order and the boundaries of each conclusion:

| Layer | Question | Primary artifact |
|---|---|---|
| System | What kind of system is this? What are its boundaries, entry points, projects, and infrastructure? | System fact base |
| Project | What role does this project play? How is it built, run, and connected to external capabilities? | Project profile |
| Internal map | Which business-capability candidates, technical components, and contract components are visible in source? | Navigable project map |
| Module study | How are the boundaries, entry points, data, and dependencies of one responsibility organized? | Module report |
| Code trace | How does a specific endpoint, task, message, exception, or data flow execute? | Traceable execution path |

The internal map is optional navigation and does not claim to be the one correct module decomposition. Module studies and code traces both require a project profile, but neither depends on the other.

## How it works

```mermaid
flowchart LR
    A["Workspace and repositories"] --> B["Project discovery and code intelligence"]
    B --> C["System fact base"]
    C --> D["Project profiles"]
    D --> E["Internal maps"]
    D --> F["Module studies"]
    D --> G["Code traces"]
    C -. "fact inheritance" .-> D
    H["Evidence fidelity and credential rules"] -.-> C
    H -.-> D
    I["Contracts, gates, and validation"] -.-> C
    I -.-> D
    I -.-> E
    I -.-> F
    I -.-> G
    C --> J["Documents, machine state, and architecture portal"]
    D --> J
    E --> J
    F --> J
    G --> J
```

A complete scan is not one giant prompt. It is a sequence of inspectable stages:

1. Recursively discover real Git repositories and assign stable identities.
2. Select and record the available code-intelligence capability, such as a code graph, LSP, or file search.
3. Collect system-level evidence; a single writer normalizes terminology and resolves conflicts.
4. Pass the system gate before analyzing projects in isolated contexts.
5. Use immutable task snapshots and machine-readable run state for parallel work.
6. Deterministically validate document structure, evidence references, state fields, and sensitive values.
7. Enter internal maps, module studies, or code traces only when needed.
8. Aggregate the result into human-readable reports and a navigable architecture portal.

## Current MVP experience

ArchScope is designed to accept natural-language intent through Harness tools. The user-facing tools are `archscope_scan_system` and `archscope_status`; internal context and commit tools support the main-agent synthesis handoff, and deeper analysis tools will be added behind the same service boundary.

```text
Build a system-level fact base for this workspace.

Analyze the role of order-service in the wider system.

Scan every project that passes the gate in parallel. Preserve failed tasks so the run can resume.

Trace the order endpoint from its controller to database writes and message publication.
```

For deterministic, scriptable control, the same intents use one strict command namespace:

```text
/archscope system [--refresh]
/archscope help
```

The Chinese aliases `系统级扫描` and `帮助` are also accepted. Slash-command input is parsed strictly and never guessed; invalid input returns usage guidance. `system` performs discovery, independent indexing, and per-project evidence collection, then hands the run to the current DSH main agent. The main agent loads the complete system protocol and structured evidence, synthesizes the fact base and three diagrams, and submits them for deterministic validation. Progress and quarter milestones remain visible in the main conversation. A first scan—or a run with `--refresh`—can take substantial time; a normal run reuses indexes matched by the project's exact absolute root. Completed runs, and compatible runs awaiting main-agent synthesis, can be reused; `BLOCKED` runs are retried instead of permanently caching failure.

DeepSeek Harness currently does not dispatch Slash Commands from a completely blank new session. Select an existing session, or send a normal message to create the session before running `/archscope`. The command candidate itself displays this limitation so a silent first interaction is less surprising.

`/archscope` and `/archscope help` publish the guide back into the conversation as a normal assistant response. The command result itself stays empty, avoiding a long help document that looks like a tool or thinking card.

The project gate can become `READY` once source-level indexes and evidence are complete. This does not claim that the production topology has been confirmed. Missing MCP tools, failed indexes, failed workers, or scope violations keep the gate `BLOCKED`. `system` and `help` are the current public Slash Commands. Project scans and resume remain reserved internally and are not advertised until their workflows exist. Machine-readable status remains available to model orchestration through `archscope_status` rather than as a manual slash subcommand.

The planned model-facing surface will grow around capabilities like these:

```text
scan system
scan project
scan all projects
build project map
scan module
trace code
show status
resume run
validate artifacts
```

Users should interact with a small set of clear analysis intents, not a long list of platform-specific commands.

## Current system-scan artifacts

By default, ArchScope writes analysis artifacts to an isolated output directory and does not modify business code:

```text
archscope_docs/
├── system/
│   ├── 00-system-fact-base.md
│   ├── project-registry.json
│   ├── index-manifest.json
│   ├── evidence/
│   │   ├── index.json
│   │   └── <project-key>.json
│   ├── relations.json
│   ├── protocol-lock.json
│   ├── synthesis.json
│   ├── validation.json
│   ├── history.json
│   └── diagrams/
│       ├── 01-system-context.mmd
│       ├── 02-internal-relations.mmd
│       └── 03-entry-overview.mmd
├── runs/
│   ├── latest.json
│   └── <run-id>/
│       ├── state.json
│       ├── system/                    # immutable terminal snapshot
│       │   ├── 00-system-fact-base.md
│       │   ├── evidence/
│       │   └── diagrams/
│       └── synthesis/
│           └── attempt-<n>/
│               ├── attempt.json
│               ├── 00-system-fact-base.md
│               └── diagrams/
```

`system/` always represents the latest validated, published fact base. A fresh scan stages all registry, index, and evidence files below its own `runs/<run-id>/system/`, so an in-progress or failed run cannot erase the previous usable documents. Each terminal synthesis receives a monotonic document revision such as `S0001`; terminal snapshots and every synthesis attempt are retained by default. `system/history.json` links revisions to run ids, validation and gate states, immutable artifact roots, and the revision currently published under `system/`.

Each project's raw structured evidence is written separately before the current DSH main agent synthesizes the fact base. Parallel workers never compete to write the document or consume one another's output. In `auto` mode, evidence up to 512 KiB is injected in full; larger bundles use a bounded representation and allow the writer to selectively retrieve complete persisted evidence for one to eight high-impact project keys without receiving filesystem or code-search access. Independently, every worker emits typed relation candidates and ArchScope persists their complete, untruncated aggregate in `system/relations.json`, which is always injected into synthesis. The main agent owns cross-project understanding, terminology, relationship judgment, conflict arbitration, and final prose; deterministic regex and name matching remain candidates rather than final conclusions.

ArchScope records the writer session, model, and input/output digests in `system/synthesis.json`, and preserves every submitted draft plus its validation report under the run's `synthesis/attempt-<n>/` directory. It validates Markdown and Mermaid artifacts for structure, evidence boundaries, exact agreement with machine-owned relation statistics, portable paths, credential leakage, explicit diagram edge semantics, and agreement between active project blockers and the downstream gate. Route, symbol, configuration, and implementation details remain in per-project evidence JSON. With complete source evidence and no active project-level blocker, the document may be marked complete for the source view and the project gate may open; runtime facts remain explicitly unconfirmed.

Code definitions, routes, and call relationships remain codebase-memory-first. For manifests, READMEs, CI, containers, and deployment configuration that graphs often miss, ArchScope collects a bounded metadata baseline in the parent process with project-root containment, symlink rejection, file and aggregate size limits, and credential-value removal before model injection. Local fact artifacts preserve real service names, domains, IPs, routes, tables, topics, queues, and other architecture identifiers. Evidence workers do not receive arbitrary filesystem reads, shell access, or write capabilities.

### System Protocol Pack

ArchScope ships system-level analysis knowledge as a versioned `protocol/` directory. The pack contains machine contracts for evidence, project identity, index state, the 22-section system document, and layer gates; Markdown policies for analysis boundaries, local fact fidelity and credential handling, output paths, and validation; a complete system-writer instruction that is actually injected into the current DSH main agent; and a focused prompt for read-only evidence workers.

The plugin loads and validates this catalog at runtime. Every scan writes `system/protocol-lock.json` with the pack version plus SHA-256 digests for the manifest and every resource. A changed pack therefore creates a new run instead of silently reusing results produced under different rules. Script-worthy invariants are implemented in TypeScript and tested; the Markdown remains inspectable protocol content, not an unenforced appendix.

### Configuration

| Option | Default | Purpose |
|---|---|---|
| `workspaceRoot` | Current DSH session workspace | Optional scan-root override; relative values resolve from the session workspace |
| `outputDirectory` | `archscope_docs` | Artifact directory inside the workspace |
| `discoveryMaxDepth` | `3` | Maximum recursive depth for Git-root discovery |
| `codebaseMemoryServerName` | `codebase_memory_mcp` | DSH namespace for codebase-memory MCP tools |
| `indexMode` | `moderate` | `fast`, `moderate`, or `full` mode for new or refreshed indexes |
| `evidenceProvider` | `spawn` | DSH subagent provider for isolated read-only evidence workers |
| `systemConcurrency` | `4` | Maximum concurrent index and evidence tasks |
| `evidenceContextMode` | `auto` | `auto` uses full evidence within the byte limit, `full` always injects it, and `bounded` always compacts it |
| `fullEvidenceMaxBytes` | `524288` | UTF-8 byte limit for full evidence injection in `auto` mode |
| `registerCommand` | `true` | Register the optional `/archscope` command |
| `registerSystemScanTool` | `true` | Register `archscope_scan_system` |
| `registerStatusTool` | `true` | Register `archscope_status` |
Canonical naming is recorded in [`docs/brand.md`](./docs/brand.md).

The ArchScope bundle also mounts the official DeepSeek Harness `@deepseek-ai/dsh-mcp-client` and starts `codebase-memory-mcp` over stdio. Before starting DSH, make sure that executable is available on `PATH`:

```bash
command -v codebase-memory-mcp
```

After installing the plugin, verify that both configuration layers are present:

```bash
dsh --profile web --dump-config | rg -n -C 6 "archscope-codebase-memory|codebase_memory_mcp|dsh-archscope"
```

For local development, run `pnpm install` followed by `pnpm check`. ArchScope is not yet published to npm, so the public install command will be documented with the first release.

## Plugin architecture direction

ArchScope is designed around the following internal boundaries:

```text
ArchScope Bundle
├── ArchScope Service
│   ├── Scan state machine
│   ├── Tasks and recovery
│   ├── Artifact management
│   └── Contract validation
├── Model-facing Tools
├── Capability Providers
│   ├── Code Intelligence
│   ├── Workspace Discovery
│   ├── Subagent Orchestration
│   └── Runtime Evidence
├── Analysis Protocol
│   ├── Prompts
│   ├── Evidence Rules
│   └── Layer Gates
└── Report and Portal Generator
```

A code graph will be the preferred discovery mechanism, but never the only one. ArchScope will use capability interfaces to support codebase-memory, LSP, file search, and future providers.

## Discovery and distribution

ArchScope will follow the official DeepSeek Harness plugin discovery convention. At public release, this repository will carry the exact [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic so it can appear in the Harness plugin discovery ecosystem.

Discoverability alone is not enough. Every release must also:

- ship as an installable bundle with a `dsh.bundle` manifest;
- provide a prebuilt npm package so ordinary users do not need to build source during installation;
- support installation and removal with `dsh plugin --profile <name> add <package>`;
- expose its configuration layer through `dsh --profile <name> --dump-config`;
- document a copyable install command, compatible Harness versions, and a minimal verification path;
- manage compatibility changes with semantic versions, GitHub Releases, and explicit migration notes.

Being indexed by the topic does not imply endorsement by DeepSeek. ArchScope treats “discoverable, installable, and verifiable” as one release gate—not as a label alone.

## Design principles

- **Traceable evidence:** Important conclusions must lead back to source, configuration, runtime material, operations documentation, or human confirmation.
- **Bounded facts:** “Visible in source,” “declared in configuration,” “runtime-confirmed,” and “enabled in production” are different states.
- **Explicit uncertainty:** Missing, conflicting, and low-confidence information is part of the formal result.
- **Inherited upstream facts:** Lower layers report conflicts for review instead of silently rewriting the system worldview.
- **Deterministic gates:** Rules that programs can decide should not depend on a model remembering to comply.
- **Context isolation:** Project and module tasks receive only the context required to complete their responsibility.
- **Recoverable execution:** Long-running, multi-project scans expose status, preserve failures, and resume after interruption.
- **Local fact fidelity:** Default artifacts preserve architecture identifiers exactly; later share-safe export must create a derived copy rather than rewrite the fact base.
- **Safe defaults:** ArchScope does not modify business code or expose secrets, tokens, passwords, private keys, API keys, or embedded credentials.
- **Replaceable models and tools:** The core protocol does not depend on one model, index engine, or code-search tool.

## What ArchScope is not

- It is not a counter for lines, directories, and dependencies.
- It is not a giant prompt that pours every repository into one context.
- It is not an architecture-fiction generator that infers production topology from source alone.
- It is not an automatic source of truth that replaces architects, developers, or operations confirmation.
- It is not a coding agent that modifies or “helpfully refactors” the scanned business code by default.

ArchScope aims to provide a more trustworthy starting point and a path for analysis that can be deepened and reviewed over time.

## Roadmap

### Phase 1: Minimum trustworthy loop

- [x] Establish the TypeScript plugin project and Harness bundle
- [x] Define the ArchScope Service, configuration schema, and foundational tools
- [x] Implement multi-repository discovery and stable project identities
- [x] Package the system-level contracts, policies, prompts, and protocol lock
- [x] Complete independent indexing, read-only evidence collection, system fact-base generation, and deterministic validation
- [x] Test plugin loading and the tool pipeline without a live model API

### Phase 2: Project analysis and recoverable orchestration

- [ ] Isolated single-project scans
- [ ] Project-type detection and template selection
- [ ] Immutable task snapshots, batch state, and failure recovery
- [x] Subagent Provider integration for system-level read-only evidence workers
- [ ] Project-document contracts and quality gates

### Phase 3: Deep analysis and system maps

- [ ] Project internal maps
- [ ] Module studies
- [ ] Code execution traces
- [ ] Architecture portal
- [ ] Runtime-evidence Providers

### Phase 4: Open ecosystem

- [ ] Stable Provider interfaces
- [ ] Third-party project types and report Profiles
- [ ] Custom evidence sources and organization policy packs
- [ ] Headless, Web, and automation workflow integration
- [ ] Share-safe/public export command that derives a redacted copy without changing local fact artifacts
- [ ] Publish a prebuilt npm bundle and verify standard installation and removal
- [ ] Add the `dsh-plugin` GitHub topic and verify that ArchScope appears in the ecosystem discovery entry point

The roadmap will evolve alongside the Developer Preview APIs of DeepSeek Harness.

## Contributing

At this stage, ArchScope needs careful discussion of problem boundaries and protocol design more than a large volume of feature code. Useful questions include:

- Which facts are hardest to establish when taking over a large multi-repository system?
- Which architecture conclusions must require runtime evidence?
- What context contamination and conflicts most often appear in parallel agent analysis?
- What report contracts work well for both human review and machine validation?
- Which code-intelligence Providers should be supported first?
- How should we measure whether an architecture scan is trustworthy, rather than merely long?

Interfaces, names, and directory layouts remain open for discussion before the first stable release. Once a public contract exists, migration paths and compatibility notes will take priority.

## License

ArchScope is released under the [MIT License](LICENSE).

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), for the “Everything is a Plugin” agent harness and Cordis plugin runtime.

---

**ArchScope does not try to draw a beautiful architecture diagram whose claims have never been proven. It cares whether every important claim on that diagram knows where it came from.**
