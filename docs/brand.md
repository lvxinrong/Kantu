# ArchScope brand and naming contract

ArchScope is the only public product name for this project.

> See the system before changing the code.

## Canonical names

| Surface | Canonical value |
|---|---|
| Product | ArchScope |
| GitHub repository | `lvxinrong/dsh-archscope` |
| npm package | `dsh-archscope` |
| DeepSeek Harness plugin and service | `archscope` |
| Slash command | `/archscope` |
| System-scan tool | `archscope_scan_system` |
| Status tool | `archscope_status` |

The product description is: **Evidence-driven system architecture reconnaissance for DeepSeek Harness.**

The core model is: **System-level analysis establishes the shared worldview; project-level analysis defines each engineering profile; module-level analysis defines responsibility boundaries; code-level analysis traces execution paths.**

## Compatibility boundary

The former Kantu name must not appear in new product copy, screenshots, examples, or integration instructions. It may appear only in code explicitly marked as a deprecated alias or in persisted compatibility identifiers.

The following identifiers remain temporarily supported:

| Legacy surface | Replacement | Treatment |
|---|---|---|
| `/kantu` | `/archscope` | Deprecated command alias |
| `kantu_scan_system` | `archscope_scan_system` | Deprecated tool alias |
| `kantu_status` | `archscope_status` | Deprecated tool alias |
| `ctx.kantu` | `ctx.archscope` | Deprecated service alias |
| `kantu_docs/` | Configurable output directory | Retained for existing scan history |
| `kantu/.../v1` | Future protocol-major namespace | Retained for v1 artifact compatibility |

Set `registerLegacyAliases: false` to expose only the canonical ArchScope command, tools, and service.

Removing persisted identifiers requires a protocol-major migration with explicit compatibility tests and artifact migration guidance. A brand rename alone must not silently invalidate existing scan history.
