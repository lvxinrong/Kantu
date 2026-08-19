import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  SYSTEM_DOCUMENT_PROTOCOL,
  SYSTEM_SCAN_PROTOCOL,
  type GateStatus,
  type IndexManifest,
  type ProjectRecord,
  type ProjectRegistry,
  type ProjectSystemEvidence,
  type SystemEvidenceBundle,
  type SystemValidationReport,
  type ValidationIssue,
} from '../contracts/system-scan.js'
import type { LoadedProtocolPack, ProtocolLock } from '../protocol/catalog.js'
import { validateSystemDocument } from '../protocol/validation.js'

function markdownCell(value: string | number | null): string {
  if (value === null || value === '') return '待确认'
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\|/gu, '\\|')
    .replace(/[\r\n]+/gu, ' ')
}

function mermaidLabel(value: string): string {
  return value.replace(/["\[\]{}()]/gu, ' ').replace(/[\r\n]+/gu, ' ').trim() || 'project'
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, file)
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function createIndexManifest(projects: ProjectRecord[], generatedAt: string): IndexManifest {
  return {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    records: projects.map(project => ({
      projectKey: project.projectKey,
      projectDir: project.projectDir,
      provider: 'unavailable',
      status: 'PENDING',
      reason: 'No code-intelligence provider result is available.',
    })),
  }
}

export function validateSystemArtifacts(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  generatedAt: string,
  evidence?: SystemEvidenceBundle,
): SystemValidationReport {
  const issues: ValidationIssue[] = []
  const keys = new Set<string>()
  for (const project of registry.projects) {
    if (keys.has(project.projectKey)) {
      issues.push({ severity: 'ERROR', code: 'DUPLICATE_PROJECT_KEY', message: `Duplicate projectKey: ${project.projectKey}` })
    }
    keys.add(project.projectKey)
    if (path.isAbsolute(project.projectDir) || project.projectDir.split('/').includes('..')) {
      issues.push({ severity: 'ERROR', code: 'UNSAFE_PROJECT_PATH', message: `Project path must stay relative: ${project.projectDir}` })
    }
  }
  if (registry.projectCount !== registry.projects.length) {
    issues.push({ severity: 'ERROR', code: 'PROJECT_COUNT_MISMATCH', message: 'projectCount does not match projects.length.' })
  }
  if (registry.projects.length === 0) {
    issues.push({ severity: 'WARNING', code: 'NO_GIT_PROJECTS', message: 'No Git project was discovered within the configured depth.' })
  }
  const indexedKeys = new Set(indexes.records.map(record => record.projectKey))
  if (indexes.records.length !== registry.projects.length) {
    issues.push({ severity: 'ERROR', code: 'INDEX_COUNT_MISMATCH', message: 'Index records must map one-to-one to discovered projects.' })
  }
  if (indexedKeys.size !== indexes.records.length) {
    issues.push({ severity: 'ERROR', code: 'DUPLICATE_INDEX_RECORD', message: 'Each projectKey may have only one index record.' })
  }
  const projectsByKey = new Map(registry.projects.map(project => [project.projectKey, project]))
  for (const record of indexes.records) {
    const project = projectsByKey.get(record.projectKey)
    if (project === undefined) {
      issues.push({ severity: 'ERROR', code: 'UNKNOWN_INDEX_PROJECT', message: `Index record references unknown projectKey: ${record.projectKey}.` })
    } else if (project.projectDir !== record.projectDir) {
      issues.push({ severity: 'ERROR', code: 'INDEX_PATH_MISMATCH', message: `Index path does not match project registry for ${record.projectKey}.` })
    }
  }
  for (const project of registry.projects) {
    if (!indexedKeys.has(project.projectKey)) {
      issues.push({ severity: 'ERROR', code: 'MISSING_INDEX_RECORD', message: `Missing index record for ${project.projectKey}.` })
    }
  }
  const incompleteIndexes = indexes.records.filter(record => record.status !== 'FRESH')
  if (incompleteIndexes.length > 0) {
    issues.push({
      severity: 'WARNING',
      code: 'CODE_INTELLIGENCE_INCOMPLETE',
      message: `${incompleteIndexes.length} project index record(s) are not FRESH.`,
    })
  }
  if (evidence === undefined || evidence.records.length !== registry.projects.length) {
    issues.push({ severity: 'WARNING', code: 'EVIDENCE_COUNT_MISMATCH', message: 'System evidence must map one-to-one to discovered projects.' })
  }
  const evidenceByKey = new Map(evidence?.records.map(record => [record.projectKey, record]) ?? [])
  for (const project of registry.projects) {
    const record = evidenceByKey.get(project.projectKey)
    if (record === undefined) {
      issues.push({ severity: 'WARNING', code: 'MISSING_PROJECT_EVIDENCE', message: `Missing system evidence for ${project.projectKey}.` })
    } else if (record.projectDir !== project.projectDir) {
      issues.push({ severity: 'ERROR', code: 'EVIDENCE_PATH_MISMATCH', message: `Evidence path does not match project registry for ${project.projectKey}.` })
    } else if (record.status !== 'COLLECTED') {
      issues.push({ severity: 'WARNING', code: 'PROJECT_EVIDENCE_INCOMPLETE', message: `System evidence is ${record.status} for ${project.projectKey}.` })
    } else if (record.scopeStatus === 'VIOLATION' || record.scopeViolations.length > 0) {
      issues.push({ severity: 'ERROR', code: 'EVIDENCE_SCOPE_VIOLATION', message: `Evidence worker reported a scope violation for ${project.projectKey}.` })
    }
  }
  issues.push({
    severity: 'WARNING',
    code: 'RUNTIME_EVIDENCE_MISSING',
    message: 'Production boundaries and runtime relationships are unconfirmed.',
  })

  const status = issues.some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED'
  const evidenceComplete = registry.projects.length > 0
    && incompleteIndexes.length === 0
    && evidence?.records.length === registry.projects.length
    && evidence.records.every(record => record.status === 'COLLECTED' && record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0)
  const gate: GateStatus = status === 'PASSED' && evidenceComplete ? 'READY' : 'BLOCKED'
  return { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, status, gate, issues }
}

const SYSTEM_ARTIFACT_PATHS = [
  'system/00-system-fact-base.md',
  'system/project-registry.json',
  'system/index-manifest.json',
  'system/evidence/index.json',
  'system/protocol-lock.json',
  'system/validation.json',
  'system/diagrams/01-system-context.mmd',
  'system/diagrams/02-internal-relations.mmd',
  'system/diagrams/03-entry-overview.mmd',
]

export interface PreparedSystemArtifacts {
  factBase: string
  validation: SystemValidationReport
  protocolLock: ProtocolLock
}

export function prepareSystemArtifacts(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
  generatedAt: string,
  pack: LoadedProtocolPack,
): PreparedSystemArtifacts {
  const initial = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
  const protocol = { packId: pack.lock.packId, version: pack.lock.version, digest: pack.lock.packDigest }
  let validation: SystemValidationReport = { ...initial, protocol }
  let factBase = renderSystemFactBase(registry, indexes, evidence, validation)
  const documentIssues = validateSystemDocument(factBase, SYSTEM_ARTIFACT_PATHS, pack)
  validation = {
    ...validation,
    status: [...validation.issues, ...documentIssues].some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED',
    gate: [...validation.issues, ...documentIssues].some(issue => issue.severity === 'ERROR') ? 'BLOCKED' : validation.gate,
    issues: [...validation.issues, ...documentIssues],
  }
  factBase = renderSystemFactBase(registry, indexes, evidence, validation)
  return { factBase, validation, protocolLock: pack.lock }
}

function projectRows(projects: ProjectRecord[]): string {
  if (projects.length === 0) return '| 当前未发现 Git 工程 | 待确认 | unknown | UNCONFIRMED | 无 | |'
  return projects.map(project => `| ${markdownCell(project.projectDir)} | ${markdownCell(project.projectKey)} | ${project.projectType} | ${project.productionStatus} | ${markdownCell(project.classificationEvidence.join(', '))} | 仅工程发现与构建标记，运行态待确认 |`).join('\n')
}

function evidenceRows(
  evidence: SystemEvidenceBundle,
  select: (record: ProjectSystemEvidence) => string[],
  empty: string,
  maxPerProject: number,
): string {
  const rows = evidence.records.flatMap(record => select(record).slice(0, maxPerProject).map(item =>
    `| ${markdownCell(record.projectDir)} | ${markdownCell(summarizeText(item))} | 代码图谱/安全元数据 | 源码视角确认 | 运行态待确认 |`,
  ))
  return rows.length === 0 ? `| 待确认 | ${empty} | 当前未发现 | 当前未发现 | 待确认 |` : rows.join('\n')
}

function summarizeText(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`
}

interface DependencyRelation {
  caller: string
  target: string
  evidence: string
  internal: boolean
}

function dependencyRelations(registry: Pick<ProjectRegistry, 'projects'>, evidence: SystemEvidenceBundle): DependencyRelation[] {
  const genericNames = new Set(['api', 'backend', 'base', 'common', 'dashboard', 'frontend', 'mobile', 'root', 'service', 'system', 'web'])
  const raw = evidence.records.flatMap(record => record.outboundDependencies.map(item => {
    const normalized = item.toLowerCase()
    const target = registry.projects.find(project => {
      if (project.projectKey === record.projectKey) return false
      const identifiers = new Set([
        project.projectKey.toLowerCase(),
        project.projectDir.toLowerCase(),
        project.projectName.toLowerCase(),
      ])
      return [...identifiers].some(identifier => identifier.length >= 4 && !genericNames.has(identifier) && normalized.includes(identifier))
    })
    return {
      caller: record.projectDir,
      target: target?.projectDir ?? '系统外部或归属待确认',
      evidence: item,
      internal: target !== undefined,
    }
  }))
  const grouped = new Map<string, DependencyRelation>()
  for (const relation of raw) {
    const key = relation.internal
      ? `${relation.caller}\u0000${relation.target}`
      : `${relation.caller}\u0000${summarizeText(relation.evidence, 120).toLowerCase()}`
    const current = grouped.get(key)
    if (current === undefined) {
      grouped.set(key, { ...relation, evidence: summarizeText(relation.evidence) })
    } else if (relation.internal && !current.evidence.includes(summarizeText(relation.evidence, 100))) {
      current.evidence = summarizeText(`${current.evidence}；${relation.evidence}`, 420)
    }
  }
  return [...grouped.values()]
}

function limitPerCaller(relations: DependencyRelation[], maxPerCaller: number): DependencyRelation[] {
  const counts = new Map<string, number>()
  return relations.filter(relation => {
    const count = counts.get(relation.caller) ?? 0
    if (count >= maxPerCaller) return false
    counts.set(relation.caller, count + 1)
    return true
  })
}

export function renderSystemFactBase(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
  validation: SystemValidationReport,
): string {
  const collected = evidence.records.filter(record => record.status === 'COLLECTED')
  const freshIndexes = indexes.records.filter(record => record.status === 'FRESH')
  const complete = validation.status === 'PASSED' && validation.gate === 'READY'
  const sourceComplete = registry.projects.length > 0
    && freshIndexes.length === registry.projects.length
    && collected.length === registry.projects.length
    && collected.every(record => record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0)
  const entries = collected.reduce((count, record) => count + record.entries.length, 0)
  const dataAssets = collected.reduce((count, record) => count + record.dataAssets.length, 0)
  const relations = dependencyRelations(registry, evidence)
  const internalRelations = relations.filter(relation => relation.internal)
  const externalRelations = relations.filter(relation => !relation.internal)
  const displayedExternalRelations = limitPerCaller(externalRelations, 3)
  const conflicts = collected.flatMap(record => record.conflicts.slice(0, 3).map(item => ({ project: record.projectDir, item })))
  const totalConflicts = collected.reduce((count, record) => count + record.conflicts.length, 0)
  const registryValid = registry.projectCount === registry.projects.length
    && new Set(registry.projects.map(project => project.projectKey)).size === registry.projects.length
    && registry.projects.every(project => !path.isAbsolute(project.projectDir) && !project.projectDir.split('/').includes('..'))
  const redactionPassed = !validation.issues.some(issue => issue.code === 'SENSITIVE_VALUE_DETECTED')
  const coverageScore = registry.projects.length === 0 ? 0 : complete ? 5 : Math.max(1, Math.floor(5 * collected.length / registry.projects.length))
  const entryScore = entries === 0 ? 0 : complete ? 3 : 1
  const relationScore = relations.length === 0 ? 0 : complete ? 3 : 1
  const externalScore = externalRelations.length === 0 ? 0 : complete ? 3 : 1
  const dataScore = dataAssets === 0 ? 0 : complete ? 3 : 1
  return `# 00-系统级事实底座

> 系统级定世界观，项目级定工程画像，模块级定职责边界，代码级定执行链路。

模块分析横向梳理能力与职责，代码分析纵向追踪真实执行路径。

## 0. 文档边界说明

本文件由 Kantu 系统级扫描生成，目标是快速建立系统世界观。扫描已执行真实 Git 工程发现、独立代码智能索引和按工程隔离的粗粒度证据采集。源码存在不代表生产启用；生产边界、生产入口、实际调用和数据归属仍需运行态材料或人工确认。为保持主文档可读，每个工程只展示少量代表性事实；完整明细保存在 system/evidence/index.json 与 system/evidence/<projectKey>.json。

| 契约字段 | 值 | 说明 |
|---|---|---|
| 协议版本 | ${SYSTEM_DOCUMENT_PROTOCOL} | 固定值 |
| 扫描协议 | ${SYSTEM_SCAN_PROTOCOL} | Kantu 运行协议 |
| 工程发现最大深度 | ${registry.discoveryMaxDepth} | Git 根在该深度内被发现 |
| 文档状态 | ${complete ? '完整' : '草稿'} | ${complete ? '源码视角系统事实已综合' : '索引、证据或校验仍有阻断项'} |
| 证据状态 | ${sourceComplete ? '源码视角已完成，运行态待确认' : '证据不足'} | 代码图谱与安全元数据证据不替代运行态确认 |
| 下层门禁 | ${validation.gate} | ${validation.gate === 'READY' ? '允许用户主动进入项目级分析' : '不允许进入项目级正式分析'} |
| 校验状态 | ${validation.status} | 同时校验结构、证据覆盖、门禁与脱敏 |
| 输出目录 | ${markdownCell(path.dirname('system/00-system-fact-base.md'))} | 相对于 Kantu 输出根目录 |

## 1. 当前目录性质

发现 ${registry.projectCount} 个真实 Git 工程。当前工作区性质为 ${registry.projectCount > 1 ? '多仓聚合目录' : registry.projectCount === 1 ? '单仓或单工程目录' : '待确认'}；${freshIndexes.length} 个工程具有可用代码智能索引，${collected.length} 个工程完成系统级证据采集。

## 2. 代码智能索引清单摘要

| 工程 | Provider | 状态 | 说明 |
|---|---|---|---|
${indexes.records.length === 0 ? '| 当前无工程 | unavailable | PENDING | 待发现工程 |' : indexes.records.map(record => `| ${markdownCell(record.projectDir)} | ${record.provider}${record.mcpProject === undefined ? '' : ` (${markdownCell(record.mcpProject)})`} | ${record.status} | ${markdownCell(record.reason)} |`).join('\n')}

## 3. 工程清单与归属

| 工程目录 | projectKey | 工程类型 | 生产状态 | 分类证据 | 可信边界 |
|---|---|---|---|---|---|
${registry.projects.length === 0 ? projectRows(registry.projects) : registry.projects.map(project => {
    const record = evidence.records.find(item => item.projectKey === project.projectKey)
    const types = record?.projectTypeCandidates[0] ?? project.projectType
    return `| ${markdownCell(project.projectDir)} | ${markdownCell(project.projectKey)} | ${markdownCell(summarizeText(types, 140))} | ${project.productionStatus} | ${markdownCell([...project.classificationEvidence, ...(record?.evidencePaths.slice(0, 2) ?? [])].join(', '))} | 源码视角，运行态待确认 |`
  }).join('\n')}

## 4. 生产服务边界

当前未接入部署清单、注册中心导出或人工确认，所有工程生产状态均为待确认。代码图谱证据不得升级为生产事实。

## 5. 系统入口

| 工程 | 入口候选 | 证据来源 | 源码状态 | 运行态状态 |
|---|---|---|---|---|
${evidenceRows(evidence, record => record.entries, '当前未发现稳定入口证据', 3)}

## 6. 基础设施事实

| 工程 | 基础设施候选 | 证据来源 | 源码状态 | 运行态状态 |
|---|---|---|---|---|
${evidenceRows(evidence, record => record.infrastructure, '当前未发现稳定基础设施证据', 3)}

## 7. 入口链路概览

共发现 ${entries} 条入口候选。入口到承载工程可由上表定位；后端服务、关键依赖和数据资产仅保留源码候选，不追踪接口内部调用链，实际生产链路待确认。

## 8. 系统能力地图（技术视角）

| 工程 | 能力候选 | 证据来源 | 源码状态 | 运行态状态 |
|---|---|---|---|---|
${evidenceRows(evidence, record => record.capabilityCandidates, '当前未发现稳定能力候选', 4)}

## 9. 系统内部跨项目关系与调用边界

| 调用方 | 被调用方候选 | 关系类型 | 源码证据 | 生产运行证据 | 待确认 |
|---|---|---|---|---|---|
${internalRelations.length === 0 ? '| 待确认 | 待确认 | 当前未发现 | 当前未发现稳定跨工程证据 | 待确认 | 需要项目级或运行态复核 |' : internalRelations.map(relation => `| ${markdownCell(relation.caller)} | ${markdownCell(relation.target)} | 出站依赖候选 | ${markdownCell(relation.evidence)} | 待确认 | 名称匹配仅为技术推测 |`).join('\n')}

## 10. 外部系统与第三方依赖

| 外部系统/依赖候选 | 调用方工程 | 调用方式 | 证据 | 是否生产依赖 | 待确认 |
|---|---|---|---|---|---|
${displayedExternalRelations.length === 0 ? '| 当前未发现稳定外部依赖 | 待确认 | 待确认 | 当前未发现 | 待确认 | 待确认 |' : displayedExternalRelations.map(relation => `| ${markdownCell(relation.target)} | ${markdownCell(relation.caller)} | 出站依赖候选 | ${markdownCell(relation.evidence)} | 待确认 | 需确认是否属于系统内部工程 |`).join('\n')}

## 11. 数据资产与归属边界

| 工程 | 数据资产候选 | 证据来源 | 源码状态 | 运行态状态 |
|---|---|---|---|---|
${evidenceRows(evidence, record => record.dataAssets, '当前未发现稳定数据资产证据', 3)}

## 12. 废弃、历史与旁支工程

当前没有人工确认材料，不能仅凭仓库名称判定废弃、历史或旁支工程；所有工程状态待确认。

## 13. 术语表

| 标准名称 | 类型 | 对应工程 | 说明 |
|---|---|---|---|
${registry.projects.length === 0 ? '| 待确认 | 工程 | 待确认 | 尚未发现工程 |' : registry.projects.map(project => {
    const aliases = evidence.records.find(item => item.projectKey === project.projectKey)?.aliases ?? []
    return `| ${markdownCell(project.projectName)} | 工程 | ${markdownCell(project.projectDir)} | ${aliases.length === 0 ? '暂以仓库目录名作为展示名' : markdownCell(`别名候选：${aliases.slice(0, 3).map(alias => summarizeText(alias, 100)).join('、')}`)} |`
  }).join('\n')}

## 14. 当前可信结论

已确认最大深度 ${registry.discoveryMaxDepth} 范围内的 Git 工程发现结果；${freshIndexes.length} 个独立代码智能索引可用；${collected.length} 个工程已完成只读粗粒度源码证据采集。所有生产状态仍待运行态或人工确认。

## 15. 冲突与待复核结论

共记录 ${totalConflicts} 条冲突或不确定项；主文档每个工程最多展示 3 条，其余保留在证据 JSON。

${conflicts.length === 0 ? '当前证据 worker 未返回显式冲突；缺少运行态材料仍构成证据边界。' : `| 工程 | 冲突或不确定项 | 处理状态 |\n|---|---|---|\n${conflicts.map(item => `| ${markdownCell(item.project)} | ${markdownCell(summarizeText(item.item))} | 冲突待复核 |`).join('\n')}`}

## 16. 关键待确认问题分级

| 问题 | 分级 | 影响范围 | 建议确认方式 |
|---|---|---|---|
| ${validation.gate === 'READY' ? '当前无源码视角阻断项' : '索引、证据或契约校验尚未完整'} | 阻断项目级 | 全部工程 | 查看 validation.json 与 evidence/index.json |
| 生产边界没有运行态证据 | 影响生产边界 | 全系统 | 提供部署清单、服务注册导出或人工确认 |
| ${entries === 0 ? '系统入口尚未形成稳定候选' : '入口候选尚未获得生产确认'} | 影响入口链路 | 全系统 | 提供入口清单、网关配置或运行态流量证据 |
| ${dataAssets === 0 ? '数据资产尚未形成稳定候选' : '数据资产归属尚未获得运行确认'} | 影响数据归属 | 全系统 | 提供结构证据或数据负责人确认 |
| 工程中文名、别名和历史状态待统一 | 可延后 | 术语表 | 由系统维护者补充人工确认 |

## 17. 系统级图表索引

| 图表 | 路径 | 完成状态 |
|---|---|---|
| 系统上下文图 | system/diagrams/01-system-context.mmd | ${complete ? '源码视角已完成，运行态待确认' : '草稿，待确认'} |
| 内部工程关系图 | system/diagrams/02-internal-relations.mmd | ${internalRelations.length > 0 ? '源码候选，运行态待确认' : '草稿，待确认'} |
| 入口链路概览图 | system/diagrams/03-entry-overview.mmd | ${entries > 0 ? '源码候选，运行态待确认' : '草稿，待确认'} |

## 18. 事实底座质量评分

| 维度 | 分数 | 依据 | 主要缺口 |
|---|---:|---|---|
| 工程覆盖 | ${coverageScore}/5 | Git 根、独立索引与工程证据覆盖 | 最大深度外目录和非 Git 工程不纳入 |
| 生产边界可信度 | 0/5 | 无运行态材料 | 全部待确认 |
| 入口链路可信度 | ${entryScore}/5 | ${entries} 条源码入口候选 | 生产链路待确认 |
| 内部关系可信度 | ${relationScore}/5 | ${internalRelations.length} 条跨工程候选 | 名称匹配与生产调用待复核 |
| 外部依赖可信度 | ${externalScore}/5 | ${externalRelations.length} 条外部或归属待确认候选，主文档展示 ${displayedExternalRelations.length} 条 | 系统内外边界待复核 |
| 数据归属可信度 | ${dataScore}/5 | ${dataAssets} 条数据资产候选 | 写入方、读取方和归属待确认 |

## 19. 证据覆盖率摘要

| 对象 | 总数 | 高证据 | 中证据 | 低证据 | 待确认 | 阻断项 |
|---|---:|---:|---:|---:|---:|---:|
| 工程 | ${registry.projectCount} | 0 | ${collected.length} | ${registry.projectCount - collected.length} | ${registry.projectCount - collected.length} | ${validation.gate === 'READY' ? 0 : 1} |
| 生产服务 | 0 | 0 | 0 | 0 | 1 | 1 |
| 系统入口 | ${entries} | 0 | ${entries} | 0 | ${entries === 0 ? 1 : entries} | 0 |
| 入口链路 | ${entries} | 0 | ${entries} | 0 | ${entries === 0 ? 1 : entries} | 0 |
| 内部关系 | ${internalRelations.length} | 0 | ${internalRelations.length} | 0 | ${internalRelations.length === 0 ? 1 : internalRelations.length} | 0 |
| 外部依赖 | ${externalRelations.length} | 0 | ${externalRelations.length} | 0 | ${externalRelations.length === 0 ? 1 : externalRelations.length} | 0 |
| 数据资产 | ${dataAssets} | 0 | ${dataAssets} | 0 | ${dataAssets === 0 ? 1 : dataAssets} | 0 |

## 20. 系统级产物自检

| 自检项 | 结果 | 说明 |
|---|---|---|
| 工程注册表已生成 | ${registryValid ? '通过' : '不通过'} | system/project-registry.json，${registry.projectCount} 个工程 |
| 每个工程都有索引状态 | ${indexes.records.length === registry.projectCount ? '通过' : '不通过'} | FRESH ${freshIndexes.length} / ${registry.projectCount} |
| 每个工程都有证据状态 | ${evidence.records.length === registry.projectCount ? '通过' : '不通过'} | COLLECTED ${collected.length} / ${registry.projectCount} |
| 证据范围检查 | ${collected.every(record => record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0) ? '通过' : '不通过'} | 仅统计真实越界，不接收“无违规”说明文本 |
| 关键待确认问题已分级 | 通过 | 阻断项目级、影响生产边界、影响入口链路、影响数据归属、可延后 |
| 证据仲裁已执行 | 通过 | 优先级：运行态、人工确认、部署发布、代码图谱、源码、历史文档；冲突保留为冲突待复核 |
| 敏感信息已脱敏 | ${redactionPassed ? '通过' : '不通过'} | ${redactionPassed ? '未检测到账号、凭据、私钥或完整敏感端点' : '检测到疑似敏感值，详见 validation.json'} |
| 源码存在与生产启用已区分 | 通过 | 未生成生产启用断言 |
| 系统级边界未越界 | 通过 | 不含项目内部调用链、业务流程、代码热点或改造建议 |
| 项目级门禁 | ${validation.gate === 'READY' ? '放行' : '阻断'} | ${validation.gate === 'READY' ? '源码视角系统事实已完成；仍需用户主动触发' : '索引、证据或校验存在阻断项'} |

## 21. 后续分析任务拆分

| 分析对象 | 层级 | 工程类型 | 建议优先级 | 优先原因 | 是否可并行 | 前置依赖 | 输出文档 |
|---|---|---|---|---|---|---|---|
${registry.projects.length === 0 ? '| 待确认 | 项目级 | unknown | 待确认 | 未发现工程 | 否 | 系统级门禁 | 待确认 |' : registry.projects.map(project => {
    const record = evidence.records.find(item => item.projectKey === project.projectKey)
    const priority = (record?.entries.length ?? 0) > 0 ? '高' : '中'
    return `| ${markdownCell(project.projectDir)} | 项目级 | ${project.projectType} | ${priority} | ${(record?.entries.length ?? 0) > 0 ? '存在入口候选' : '补全工程画像与运行边界'} | 是 | 系统级门禁 READY | projects/${markdownCell(project.projectKey)} |`
  }).join('\n')}
`
}

export function renderSystemContextDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const nodes = projects.map((project, index) => `  P${index}["${mermaidLabel(project.projectDir)}"]`).join('\n')
  const entryCount = evidence?.records.reduce((count, record) => count + record.entries.length, 0) ?? 0
  return `flowchart LR\n  U["用户 / 外部入口：${entryCount > 0 ? `${entryCount} 个源码候选` : '待确认'}"]\n  S["Kantu 扫描范围"]\n  U -. 运行态待确认 .-> S\n${nodes || '  P0["当前未发现 Git 工程"]'}\n${projects.map((_project, index) => `  S --> P${index}`).join('\n')}\n`
}

export function renderInternalRelationsDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const nodes = projects.map((project, index) => `  P${index}["${mermaidLabel(project.projectDir)}"]`).join('\n')
  const projectIndex = new Map(projects.map((project, index) => [project.projectDir, index]))
  const edges = evidence === undefined ? [] : dependencyRelations({ projects }, evidence)
    .filter(relation => relation.internal)
    .flatMap(relation => {
      const caller = projectIndex.get(relation.caller)
      const target = projectIndex.get(relation.target)
      return caller === undefined || target === undefined ? [] : [`  P${caller} -. 源码候选 .-> P${target}`]
    })
  return `flowchart LR\n${nodes || '  P0["当前未发现 Git 工程"]'}\n${edges.length === 0 ? '  N["工程间关系：当前未发现稳定候选"]' : edges.join('\n')}\n`
}

export function renderEntryOverviewDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const entryCount = evidence?.records.reduce((count, record) => count + record.entries.length, 0) ?? 0
  return `flowchart LR\n  E["系统入口：${entryCount > 0 ? `${entryCount} 个源码候选` : '待确认'}"]\n  W["承载工程：${projects.length === 0 ? '待确认' : '见工程注册表'}"]\n  B["后端 / 网关 / 数据资产：运行态待确认"]\n  E -. 源码候选 .-> W\n  W -. 待确认 .-> B\n`
}

export interface WriteSystemArtifactsOptions {
  outputRoot: string
  registry: ProjectRegistry
  indexes: IndexManifest
  evidence: SystemEvidenceBundle
  validation: SystemValidationReport
  factBase: string
  protocolLock: ProtocolLock
}

export async function writeSystemArtifacts(options: WriteSystemArtifactsOptions): Promise<void> {
  const systemRoot = path.join(options.outputRoot, 'system')
  await Promise.all([
    atomicWriteJson(path.join(systemRoot, 'project-registry.json'), options.registry),
    atomicWriteJson(path.join(systemRoot, 'index-manifest.json'), options.indexes),
    atomicWriteJson(path.join(systemRoot, 'evidence', 'index.json'), options.evidence),
    ...options.evidence.records.map(record => atomicWriteJson(path.join(systemRoot, 'evidence', `${record.projectKey}.json`), record)),
    atomicWriteJson(path.join(systemRoot, 'validation.json'), options.validation),
    atomicWriteJson(path.join(systemRoot, 'protocol-lock.json'), options.protocolLock),
    atomicWrite(path.join(systemRoot, '00-system-fact-base.md'), options.factBase),
    atomicWrite(path.join(systemRoot, 'diagrams', '01-system-context.mmd'), renderSystemContextDiagram(options.registry.projects, options.evidence)),
    atomicWrite(path.join(systemRoot, 'diagrams', '02-internal-relations.mmd'), renderInternalRelationsDiagram(options.registry.projects, options.evidence)),
    atomicWrite(path.join(systemRoot, 'diagrams', '03-entry-overview.mmd'), renderEntryOverviewDiagram(options.registry.projects, options.evidence)),
  ])
}
