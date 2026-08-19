# System output validation

Before a system report can be used by a downstream layer, Kantu validates:

- the exact heading set and order;
- recognized metadata values and gate consistency;
- a one-to-one project registry and index manifest;
- all required JSON, report, diagram, validation, and protocol-lock artifacts;
- sensitive-value redaction;
- the distinction between source evidence and runtime confirmation;
- the presence of quality dimensions, evidence coverage objects, graded questions, and evidence arbitration;
- the absence of project-level deep-dive headings.

Validation failure always blocks the gate. Validation success alone does not open it: evidence requirements in the layer state machine must also pass.
