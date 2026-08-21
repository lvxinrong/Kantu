# System evidence task envelope

A system evidence worker receives exactly one discovered Git project and performs read-only, coarse evidence collection.

Required input fields:

- workspace-relative project key and directory;
- resolved project root;
- allowed code-intelligence project or provider scope;
- index-manifest reference;
- protocol-pack ID, version, and digest.

Allowed evidence is the target project's code-intelligence scope plus a bounded metadata baseline collected by ArchScope inside the resolved project root. The metadata collector rejects symbolic links, reads only allowlisted manifests, documentation, CI, environment, container, deployment, and configuration files, caps file and aggregate sizes, and removes actual credential or secret values before model injection while preserving architecture identifiers. The worker must not read another project, another worker's output, a project-level report, or a historical synthesis from the system writer.

The worker must call at least one allowed code-intelligence tool. It returns bounded candidates for project type, entries, outbound dependencies, data assets, deployment and infrastructure, aliases and service names, system capabilities, evidence paths, conflicts, plus `scopeStatus` and actual scope violations. It also emits one structured `relationCandidates` record per reviewable outbound project, service, endpoint, message-channel, SDK, or shared-data relationship. Direct source contracts, configuration references, and name-only matches remain distinct evidence strengths; every relation stays runtime-unconfirmed. A clean run returns `scopeStatus=CLEAN` and `scopeViolations=[]`; it never writes “none” or an explanation in the violation array. Empty arrays are preferred to guesses. It does not write files, assert production enablement, expose credential or secret values, or establish cross-project conclusions. The system writer performs arbitration and synthesis.
