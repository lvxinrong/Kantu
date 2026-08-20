# Output paths

ArchScope writes analysis artifacts only below the configured output directory inside the current DeepSeek Harness session workspace. The default is `kantu_docs/`. The Harness process launch directory is never used as the implicit scan root.

System artifacts live below `kantu_docs/system/`; run state lives below `kantu_docs/runs/`. Paths persisted inside system artifacts are workspace-relative or output-root-relative. Parent traversal and absolute artifact paths are rejected. ArchScope does not write reports into discovered business repositories and does not modify their source code.
