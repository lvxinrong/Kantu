# Layer gates

System-level analysis establishes the shared worldview. Project-level analysis defines an engineering profile. Module-level analysis defines responsibility boundaries. Code-level analysis traces a concrete execution path.

The four state fields are independent:

- document status says whether the required structure and content are complete;
- evidence status says what kind of claims the evidence can support;
- validation status says whether deterministic checks passed;
- downstream gate is the only transition signal.

A structurally valid draft may have `校验状态=PASSED` while remaining `下层门禁=BLOCKED`. ArchScope does not enter project analysis automatically after a system scan. The system-to-project transition is defined only by `kantu/contract/layer-state-machine/v1`.
