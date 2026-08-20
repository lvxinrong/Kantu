import { createHash } from 'node:crypto'

import type {
  IndexManifest,
  ProjectRegistry,
  ProjectSystemEvidence,
  SystemEvidenceBundle,
  SystemSynthesisContext,
  SystemSynthesisDraft,
} from '../contracts/system-scan.js'
import { protocolResource, type LoadedProtocolPack } from '../protocol/catalog.js'

const SYSTEM_SCAN_PROMPT = 'archscope/prompt/system-scan/v1'
const SYSTEM_ANALYSIS_POLICY = 'archscope/policy/system-analysis/v1'
const EVIDENCE_POLICY = 'archscope/policy/evidence-and-redaction/v1'
const LAYER_GATE_POLICY = 'archscope/policy/layer-gates/v1'
const SYSTEM_DOCUMENT_CONTRACT = 'archscope/contract/system-document/v1'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function bounded(value: string, max = 220): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function boundedField(values: string[], maxItems: number): { values: string[], omitted: number } {
  return {
    values: values.slice(0, maxItems).map(value => bounded(value)),
    omitted: Math.max(0, values.length - maxItems),
  }
}

function compactEvidenceRecord(record: ProjectSystemEvidence, projectCount: number) {
  const maxItems = projectCount > 20 ? 2 : projectCount > 10 ? 3 : 6
  return {
    projectKey: record.projectKey,
    projectDir: record.projectDir,
    mcpProject: record.mcpProject,
    status: record.status,
    scopeStatus: record.scopeStatus,
    failureReason: record.failureReason,
    projectTypeCandidates: boundedField(record.projectTypeCandidates, maxItems),
    entries: boundedField(record.entries, maxItems),
    outboundDependencies: boundedField(record.outboundDependencies, maxItems),
    dataAssets: boundedField(record.dataAssets, maxItems),
    infrastructure: boundedField(record.infrastructure, maxItems),
    aliases: boundedField(record.aliases, maxItems),
    capabilityCandidates: boundedField(record.capabilityCandidates, maxItems),
    evidencePaths: boundedField(record.evidencePaths, Math.max(4, maxItems)),
    conflicts: boundedField(record.conflicts, maxItems),
    scopeViolations: record.scopeViolations.map(value => bounded(value)),
    fullEvidenceArtifact: `system/evidence/${record.projectKey}.json`,
  }
}

export function systemSynthesisInputDigest(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
): string {
  return sha256(JSON.stringify({ registry, indexes, evidence }))
}

export function systemSynthesisOutputDigest(draft: SystemSynthesisDraft): string {
  return sha256(JSON.stringify(draft))
}

export function buildSystemSynthesisContext(
  runId: string,
  pack: LoadedProtocolPack,
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
): SystemSynthesisContext {
  const fullEvidence = JSON.stringify(evidence.records)
  const evidencePayload = fullEvidence.length <= 240_000
    ? evidence.records
    : evidence.records.map(record => compactEvidenceRecord(record, registry.projectCount))
  const evidenceMode = fullEvidence.length <= 240_000 ? 'FULL' : 'BOUNDED'
  const prompt = `你是当前 DeepSeek Harness 会话的 ArchScope 系统级主写者。多个只读子 Agent 已经分别完成单工程取证；现在必须由你建立跨工程世界观并生成最终系统级文档。系统级定世界观，项目级定工程画像，模块级定内部边界，代码级定具体链路。

你不是证据采集 worker。不得重新扫描代码。只能使用下面给出的工程注册表、索引状态和证据，以及按需调用 archscope_get_system_project_evidence 补取的原始单工程 evidence；除此之外只允许调用 archscope_commit_system_synthesis。证据注入模式为 ${evidenceMode}；若为 BOUNDED，可针对高影响关系、冲突或重复候选，每次用 1-8 个 projectKey 补取完整证据。不要为了追求全量而逐工程补取，也不得把未补取内容补成事实。

工作要求：
1. 阅读并执行完整的系统级指令、分析政策、证据政策、门禁政策和文档契约。
2. 统一工程名、服务名和别名，综合入口、能力、基础设施、数据资产、内部关系、外部依赖与冲突。
3. 每条可信结论必须引用 evidence JSON 和/或其中给出的源码相对路径；不能只引用“模型判断”。
4. 仅源码证据不得写成生产启用、生产入口、生产调用或生产归属。没有运行态或人工确认时必须明确写“待确认”。
5. 不做项目级、模块级或代码级深挖，不写业务流程、重构建议、技术债务或代码热点。
6. 生成严格符合契约顺序的完整 Markdown。不要省略任何章节；证据不足的章节保留并明确边界。
7. 生成三个 Mermaid flowchart 源码，不要使用 Markdown 代码围栏，不要包含 URL、IP、账号、密钥、原始数据资产标识或未经脱敏的端点。每张图必须包含“实线=源码证据、虚线=待确认推断、不代表生产运行”的明确图例；候选或推断关系必须使用虚线。
8. 机器字段“协议版本、文档状态、证据状态、下层门禁、校验状态”和自检中的“项目级门禁”由插件在提交时规范化；你仍须保留对应表格行。若第 16 节存在真实的“阻断项目级”问题，最终门禁必须为 BLOCKED；READY 时该分类只能写“当前无阻断项”。
9. 完成后必须调用 archscope_commit_system_synthesis，参数 runId 固定为 ${runId}，并提交 factBase 与三个 Mermaid 图。若工具返回可修订的校验失败，依据 issues 修订后最多再提交一次。
10. 提交成功后，用中文向用户汇报系统世界观摘要、主要可信边界、校验结果和产物路径。

===== 系统级主写者指令 =====
${protocolResource(pack, SYSTEM_SCAN_PROMPT).content}

===== 系统级分析政策 =====
${protocolResource(pack, SYSTEM_ANALYSIS_POLICY).content}

===== 证据与脱敏政策 =====
${protocolResource(pack, EVIDENCE_POLICY).content}

===== 层级门禁政策 =====
${protocolResource(pack, LAYER_GATE_POLICY).content}

===== 系统文档契约 =====
${protocolResource(pack, SYSTEM_DOCUMENT_CONTRACT).content}

===== 工程注册表 =====
${JSON.stringify(registry)}

===== 索引状态 =====
${JSON.stringify(indexes)}

===== 单工程证据（${evidenceMode}） =====
${JSON.stringify(evidencePayload)}

现在开始跨工程语义综合。不要把确定性分类候选直接当作结论；必须进行证据仲裁后再提交。`

  return { runId, protocolDigest: pack.lock.packDigest, prompt }
}
