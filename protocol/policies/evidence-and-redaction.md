# Evidence and redaction

ArchScope keeps three axes separate: source evidence strength, runtime confirmation, and assertion strength. A source-code finding can confirm that an implementation exists; it cannot confirm that the implementation is deployed, enabled, or used in production.

Evidence is arbitrated in this order: runtime observation, explicit human confirmation, deployment and release material, code graph, source code, then historical documentation. Conflicting evidence is retained as `冲突待复核`; it is not silently resolved by the newest or most convenient source.

Every important conclusion records its evidence type, location, date when available, and confidence boundary. Missing evidence is expressed as `待确认` or `当前未发现`, never filled by inference.

Passwords, tokens, secrets, private keys, complete JDBC URLs, production accounts, production IPs, complete internal domains, signed URLs, SDK keys, and raw database/schema/table/topic identifiers must not enter reports or diagrams. Prefer a safe category such as “SFA 主业务库候选”, a redacted placeholder, and a path-only reference to the source. Organization names inferred only from domains, Maven coordinates, package namespaces, or database prefixes are not trustworthy organizational ownership evidence and should be generalized. Detection is deterministic and governed by `archscope/contract/evidence/v1`.
