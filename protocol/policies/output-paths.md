# Output paths

ArchScope writes analysis artifacts only below the configured output directory inside the current DeepSeek Harness session workspace. The default is `archscope_docs/`. The Harness process launch directory is never used as the implicit scan root.

`archscope_docs/system/` is the current published system fact base. A new scan first writes its registry, index manifest, evidence, complete relation catalog, and protocol lock below `archscope_docs/runs/<run-id>/system/`; it does not replace the current published documents while analysis is still running. After terminal synthesis passes protocol validation, ArchScope promotes the new revision to `archscope_docs/system/`.

Every terminal synthesis is preserved as an immutable snapshot below `archscope_docs/runs/<run-id>/system/`, including terminal attempts that fail validation. Individual synthesis attempts remain below `archscope_docs/runs/<run-id>/synthesis/attempt-<n>/`. `archscope_docs/system/history.json` records the ordered document revisions (`S0001`, `S0002`, ...), their run ids, validation and gate states, snapshot roots, and whether each revision became current. The default retention policy is `KEEP_ALL`.

Paths persisted inside system artifacts are workspace-relative or output-root-relative. Parent traversal and absolute artifact paths are rejected. ArchScope does not write reports into discovered business repositories and does not modify their source code.
