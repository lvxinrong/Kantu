# Kantu

**English** | [简体中文](./README.zh-CN.md)

> Evidence-driven architecture reconnaissance for complex, multi-repository software systems—built for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

Kantu helps AI agents genuinely take over an unfamiliar software system—not merely browse directories, count files, or produce an architecture summary that sounds complete.

It brings source discovery, evidence collection, system modeling, project profiling, layer gates, parallel orchestration, deterministic validation, and an architecture portal into one recoverable, verifiable, and extensible scanning protocol, delivered as a native DeepSeek Harness plugin.

**Project status: runnable system-scan MVP, not yet published.** Kantu can now discover Git projects, persist a system-scan run, generate a source-bounded fact-base draft, and validate its machine-readable artifacts. Code-intelligence synthesis, runtime evidence, project scans, and resume orchestration are still under development.

> **Core model: system-level analysis establishes the shared worldview; project-level analysis defines each engineering profile; module-level analysis defines responsibility boundaries; code-level analysis traces execution paths.**

Module analysis maps capabilities and responsibilities horizontally; code analysis follows real execution paths vertically.

## Why Kantu

When an agent enters a large codebase for the first time, the easiest result to produce is one that is locally correct but globally wrong:

- seeing a dependency and assuming it is enabled in production;
- seeing a few directories and treating them as the real business boundaries;
- scanning one repository while ignoring its role in the wider system;
- generating pages of conclusions with no traceable evidence;
- dispatching parallel agents without a shared fact base or conflict resolution;
- losing a session and no longer knowing what was completed or which results remain trustworthy.

Kantu starts from a different premise:

> Architecture understanding is not a one-shot code summary. It is an engineering process—from evidence to conclusions and from local detail to system context—that must be verifiable and recoverable.

## What makes Kantu different

### Evidence before conclusions

Every important conclusion should point to reviewable evidence. Anything that cannot be proven must be marked for confirmation. A capability visible in source code is not necessarily enabled in production.

### Establish the system worldview before profiling projects

Kantu does not let multiple agents independently interpret a system without shared context. A system-level fact base first aligns production boundaries, project identities, infrastructure, entry points, and terminology. Project-level analysis then inherits those facts.

### Let models reason; let programs enforce discipline

Models handle judgment and synthesis. Deterministic programs handle state machines, task plans, contract validation, identity resolution, batch recovery, and sensitive-data checks.

### Multi-repository from day one

Project identity is based on the workspace-relative path, not the directory basename. Repositories with the same name, nested repositories, aggregation directories, and composite projects are never silently merged.

### Native to the plugin runtime

Kantu is not a long prompt wrapped in an npm package. It is designed around Cordis services, model-facing tools, capability providers, and a Harness bundle so that scanning capabilities can be composed, replaced, hot-reloaded, and reused.

## Analysis model

Kantu uses layers to control analysis order and the boundaries of each conclusion:

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
    H["Evidence and redaction rules"] -.-> C
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

Kantu is designed to accept natural-language intent through Harness tools. The current model-facing tools are `kantu_scan_system` and `kantu_status`; deeper analysis tools will be added behind the same service boundary.

```text
Build a system-level fact base for this workspace.

Analyze the role of order-service in the wider system.

Scan every project that passes the gate in parallel. Preserve failed tasks so the run can resume.

Trace the order endpoint from its controller to database writes and message publication.
```

For deterministic, scriptable control, the same intents use one strict command namespace:

```text
/kantu system [--refresh]
/kantu project <project-key> [--refresh]
/kantu status [run-id]
/kantu resume [run-id]
/kantu help
```

Chinese subcommand aliases are also accepted. Slash-command input is parsed strictly and never guessed; invalid input returns usage guidance. `system`, `status`, and `help` are runnable. `project` and `resume` are reserved and fail closed until their execution workflows exist.

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

By default, Kantu writes analysis artifacts to an isolated output directory and does not modify business code:

```text
kantu_docs/
├── system/
│   ├── 00-system-fact-base.md
│   ├── project-registry.json
│   ├── index-manifest.json
│   ├── validation.json
│   └── diagrams/
│       ├── 01-system-context.mmd
│       ├── 02-internal-relations.mmd
│       └── 03-entry-overview.mmd
├── runs/
│   ├── latest.json
│   └── <run-id>/
│       └── state.json
```

The fact base and diagrams are deliberately drafts. Until code-intelligence and runtime evidence are available, validation may pass while the analysis gate remains `BLOCKED`; structural validity is not treated as proof of production architecture.

### Configuration

| Option | Default | Purpose |
|---|---|---|
| `workspaceRoot` | `.` | Workspace Kantu is allowed to scan |
| `outputDirectory` | `kantu_docs` | Artifact directory inside the workspace |
| `discoveryMaxDepth` | `3` | Maximum recursive depth for Git-root discovery |
| `registerCommand` | `true` | Register the optional `/kantu` command |
| `registerSystemScanTool` | `true` | Register `kantu_scan_system` |
| `registerStatusTool` | `true` | Register `kantu_status` |

For local development, run `pnpm install` followed by `pnpm check`. Kantu is not yet published to npm, so the public install command will be documented with the first release.

## Plugin architecture direction

Kantu is designed around the following internal boundaries:

```text
Kantu Bundle
├── Kantu Service
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

A code graph will be the preferred discovery mechanism, but never the only one. Kantu will use capability interfaces to support codebase-memory, LSP, file search, and future providers.

## Discovery and distribution

Kantu will follow the official DeepSeek Harness plugin discovery convention. At public release, this repository will carry the exact [`dsh-plugin`](https://github.com/topics/dsh-plugin) GitHub topic so it can appear in the Harness plugin discovery ecosystem.

Discoverability alone is not enough. Every release must also:

- ship as an installable bundle with a `dsh.bundle` manifest;
- provide a prebuilt npm package so ordinary users do not need to build source during installation;
- support installation and removal with `dsh plugin --profile <name> add <package>`;
- expose its configuration layer through `dsh --profile <name> --dump-config`;
- document a copyable install command, compatible Harness versions, and a minimal verification path;
- manage compatibility changes with semantic versions, GitHub Releases, and explicit migration notes.

Being indexed by the topic does not imply endorsement by DeepSeek. Kantu treats “discoverable, installable, and verifiable” as one release gate—not as a label alone.

## Design principles

- **Traceable evidence:** Important conclusions must lead back to source, configuration, runtime material, operations documentation, or human confirmation.
- **Bounded facts:** “Visible in source,” “declared in configuration,” “runtime-confirmed,” and “enabled in production” are different states.
- **Explicit uncertainty:** Missing, conflicting, and low-confidence information is part of the formal result.
- **Inherited upstream facts:** Lower layers report conflicts for review instead of silently rewriting the system worldview.
- **Deterministic gates:** Rules that programs can decide should not depend on a model remembering to comply.
- **Context isolation:** Project and module tasks receive only the context required to complete their responsibility.
- **Recoverable execution:** Long-running, multi-project scans expose status, preserve failures, and resume after interruption.
- **Safe defaults:** Kantu does not modify business code or expose secrets, tokens, passwords, private keys, or complete sensitive endpoints by default.
- **Replaceable models and tools:** The core protocol does not depend on one model, index engine, or code-search tool.

## What Kantu is not

- It is not a counter for lines, directories, and dependencies.
- It is not a giant prompt that pours every repository into one context.
- It is not an architecture-fiction generator that infers production topology from source alone.
- It is not an automatic source of truth that replaces architects, developers, or operations confirmation.
- It is not a coding agent that modifies or “helpfully refactors” the scanned business code by default.

Kantu aims to provide a more trustworthy starting point and a path for analysis that can be deepened and reviewed over time.

## Roadmap

### Phase 1: Minimum trustworthy loop

- [x] Establish the TypeScript plugin project and Harness bundle
- [x] Define the Kantu Service, configuration schema, and foundational tools
- [x] Implement multi-repository discovery and stable project identities
- [ ] Complete system fact-base generation and deterministic validation
- [x] Test plugin loading and the tool pipeline without a live model API

### Phase 2: Project analysis and recoverable orchestration

- [ ] Isolated single-project scans
- [ ] Project-type detection and template selection
- [ ] Immutable task snapshots, batch state, and failure recovery
- [ ] Subagent Provider integration
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
- [ ] Publish a prebuilt npm bundle and verify standard installation and removal
- [ ] Add the `dsh-plugin` GitHub topic and verify that Kantu appears in the ecosystem discovery entry point

The roadmap will evolve alongside the Developer Preview APIs of DeepSeek Harness.

## Contributing

At this stage, Kantu needs careful discussion of problem boundaries and protocol design more than a large volume of feature code. Useful questions include:

- Which facts are hardest to establish when taking over a large multi-repository system?
- Which architecture conclusions must require runtime evidence?
- What context contamination and conflicts most often appear in parallel agent analysis?
- What report contracts work well for both human review and machine validation?
- Which code-intelligence Providers should be supported first?
- How should we measure whether an architecture scan is trustworthy, rather than merely long?

Interfaces, names, and directory layouts remain open for discussion before the first runnable release. Once a public contract exists, migration paths and compatibility notes will take priority.

## Acknowledgements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), for the “Everything is a Plugin” agent harness and Cordis plugin runtime.

---

**Kantu does not try to draw a beautiful architecture diagram whose claims have never been proven. It cares whether every important claim on that diagram knows where it came from.**
