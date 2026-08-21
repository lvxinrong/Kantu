# System output validation

Before a system report can be used by a downstream layer, ArchScope validates:

- the exact heading set and order;
- recognized metadata values and gate consistency;
- a one-to-one project registry and index manifest;
- all required JSON, report, diagram, validation, and protocol-lock artifacts;
- credential and secret-value rejection without removing local architecture identifiers;
- exact agreement between machine-owned relation statistics and `relations.json`;
- absence of machine-local absolute paths in the portable fact base;
- agreement between active `阻断项目级` questions and the downstream gate;
- explicit Mermaid edge semantics distinguishing source evidence from pending inference and production runtime;
- the distinction between source evidence and runtime confirmation;
- the presence of quality dimensions, evidence coverage objects, graded questions, and evidence arbitration;
- the absence of project-level deep-dive headings.

Validation failure always blocks the gate. Validation success alone does not open it: evidence requirements in the layer state machine must also pass.
