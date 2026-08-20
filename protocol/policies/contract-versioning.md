# Contract versioning

Machine-readable contracts are the source of truth for ArchScope protocol fields, state values, heading order, required artifacts, and deterministic validation.

- Patch releases clarify wording without changing accepted documents.
- Minor releases add backward-compatible fields or states.
- Breaking changes receive a new contract ID with a new major suffix.
- A contract change must update its renderer, validator, tests, task envelope, package contents, and migration notes together.
- A document without a recognized protocol version is legacy input and cannot open a downstream gate automatically.
- Every run records a protocol lock containing the pack version and SHA-256 digest of every resource it used.

The Markdown policies explain intent. They never override a machine-readable contract.
