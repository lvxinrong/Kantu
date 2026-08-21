# Evidence and local fact fidelity

ArchScope keeps three axes separate: source evidence strength, runtime confirmation, and assertion strength. A source-code finding can confirm that an implementation exists; it cannot confirm that the implementation is deployed, enabled, or used in production.

Evidence is arbitrated in this order: runtime observation, explicit human confirmation, deployment and release material, code graph, source code, then historical documentation. Conflicting evidence is retained as `冲突待复核`; it is not silently resolved by the newest or most convenient source.

Every important conclusion records its evidence type, location, date when available, and confidence boundary. Missing evidence is expressed as `待确认` or `当前未发现`, never filled by inference.

The default ArchScope output is a local fact base inside the same workspace trust boundary as the analyzed code. Service names, internal domains, IPs, routes, database/schema/table identifiers, topics, queues, configuration endpoints, and other architecture identifiers remain intact because they are necessary for exact cross-project matching and evidence traceability. Main-document aggregation is controlled by analysis level, not by redaction.

Only actual secret values are rejected from model-facing evidence, reports, diagrams, and relation artifacts: passwords, tokens, API keys, client secrets, private keys, bearer credentials, embedded URL credentials, signed parameters, and equivalent authentication material. Detection is deterministic and governed by `archscope/contract/evidence/v1`.

Observed organization or brand names may be retained as source facts, but domain names, Maven coordinates, package namespaces, or database prefixes alone do not prove organizational ownership or production use. Those conclusions remain unconfirmed.

Share-safe or public redaction is a separate future export operation. It must create a derived copy and never rewrite the local source-of-truth artifacts.
