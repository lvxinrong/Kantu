# System evidence task envelope

A system evidence worker receives exactly one discovered Git project and performs read-only, coarse evidence collection.

Required input fields:

- workspace-relative project key and directory;
- resolved project root;
- allowed code-intelligence project or provider scope;
- index-manifest reference;
- protocol-pack ID, version, and digest.

Allowed evidence is the target project's code-intelligence scope plus a bounded metadata baseline collected by ArchScope inside the resolved project root. The metadata collector rejects symbolic links, reads only allowlisted manifests, documentation, CI, environment-key, container, deployment, and configuration files, caps file and aggregate sizes, and redacts sensitive values before model injection. The worker must not read another project, another worker's output, a project-level report, or a historical synthesis from the system writer.

The worker must call at least one allowed code-intelligence tool. It returns bounded candidates for project type, entries, outbound dependencies, data assets, deployment and infrastructure, aliases and service names, system capabilities, evidence paths, conflicts, plus `scopeStatus` and actual scope violations. A clean run returns `scopeStatus=CLEAN` and `scopeViolations=[]`; it never writes “none” or an explanation in the violation array. Empty arrays are preferred to guesses. It does not write files, assert production enablement, expose sensitive values, or establish cross-project conclusions. The system writer performs arbitration and synthesis.
