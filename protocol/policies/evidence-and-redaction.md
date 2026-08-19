# Evidence and redaction

Kantu keeps three axes separate: source evidence strength, runtime confirmation, and assertion strength. A source-code finding can confirm that an implementation exists; it cannot confirm that the implementation is deployed, enabled, or used in production.

Evidence is arbitrated in this order: runtime observation, explicit human confirmation, deployment and release material, code graph, source code, then historical documentation. Conflicting evidence is retained as `冲突待复核`; it is not silently resolved by the newest or most convenient source.

Every important conclusion records its evidence type, location, date when available, and confidence boundary. Missing evidence is expressed as `待确认` or `当前未发现`, never filled by inference.

Passwords, tokens, secrets, private keys, complete JDBC URLs, production accounts, production IPs, complete internal domains, signed URLs, and SDK keys must not enter reports or task envelopes. Prefer a safe category, a redacted placeholder, and a path-only reference to the source. Detection is deterministic and governed by `kantu/contract/evidence/v1`.
