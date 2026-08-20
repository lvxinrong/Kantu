# Layer gates

System-level analysis establishes the shared worldview. Project-level analysis defines an engineering profile. Module-level analysis defines internal boundaries. Code-level analysis traces a concrete path.

The four state fields are independent:

- document status says whether the required structure and content are complete;
- evidence status says what kind of claims the evidence can support;
- validation status says whether deterministic checks passed;
- downstream gate is the only transition signal.

A structurally valid draft may have `校验状态=PASSED` while remaining `下层门禁=BLOCKED`. An active row classified as `阻断项目级` in section 16 deterministically keeps the downstream gate blocked. When the gate is READY, that classification must explicitly state that no active blocker exists. ArchScope does not enter project analysis automatically after a system scan. The system-to-project transition is defined only by `archscope/contract/layer-state-machine/v1`.
