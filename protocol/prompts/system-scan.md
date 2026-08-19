# System scan instruction

Build only the system-level fact base for the configured workspace. Follow the contracts and policies in `kantu/protocol/system/v1`; do not infer production state from source code and do not enter project, module, or code-level analysis.

Required sequence:

1. Discover real Git roots and stop descending after each root.
2. Assign stable identities from workspace-relative paths.
3. Create or reuse one independent index per project, verify that it is ready, and persist one explicit record per project, including unavailable or failed providers.
4. Run one isolated, read-only evidence worker per fresh index to collect coarse candidates for entries, infrastructure, capabilities, external dependencies, data ownership, aliases, and conflicts.
5. Let one writer normalize terminology, retain conflicts, and render the 22-section fact base.
6. Generate the three required Mermaid diagrams.
7. Run deterministic structure, gate, artifact, and redaction validation.
8. Persist the protocol lock and run state. Do not continue to project analysis automatically.

When evidence is missing, preserve the section, mark its boundary, and keep the downstream gate blocked. Source-complete evidence may open the project gate but must not be described as runtime or production confirmation. Never modify scanned source code or include sensitive values.
