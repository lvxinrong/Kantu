import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  SYSTEM_SCAN_PROTOCOL,
  type GateStatus,
  type IndexManifest,
  type ProjectRecord,
  type ProjectRegistry,
  type SystemValidationReport,
  type ValidationIssue,
} from '../contracts/system-scan.js'

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
      provider: 'unconfigured',
      status: 'PENDING',
      reason: 'No code-intelligence provider is configured in the system-scan MVP.',
    })),
  }
}

export function validateSystemArtifacts(registry: ProjectRegistry, indexes: IndexManifest, generatedAt: string): SystemValidationReport {
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
  if (indexes.records.some(record => record.status !== 'PENDING')) {
    issues.push({ severity: 'ERROR', code: 'UNSUPPORTED_INDEX_STATE', message: 'The MVP only supports explicit PENDING index records.' })
  }
  issues.push({
    severity: 'WARNING',
    code: 'CODE_INTELLIGENCE_UNAVAILABLE',
    message: 'Code-intelligence evidence has not been collected; project-level gate remains blocked.',
  })
  issues.push({
    severity: 'WARNING',
    code: 'RUNTIME_EVIDENCE_MISSING',
    message: 'Production boundaries and runtime relationships are unconfirmed.',
  })

  const status = issues.some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED'
  const gate: GateStatus = 'BLOCKED'
  return { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, status, gate, issues }
}

function projectRows(projects: ProjectRecord[]): string {
  if (projects.length === 0) return '| 当前未发现 Git 工程 | 待确认 | unknown | UNCONFIRMED | 无 | |'
  return projects.map(project => `| ${markdownCell(project.projectDir)} | ${markdownCell(project.projectKey)} | ${project.projectType} | ${project.productionStatus} | ${markdownCell(project.classificationEvidence.join(', '))} | 仅工程发现与构建标记，运行态待确认 |`).join('\n')
}

export function renderSystemFactBase(registry: ProjectRegistry, indexes: IndexManifest, validation: SystemValidationReport): string {
  const coverageScore = registry.projects.length === 0 ? 0 : 2
  return `# 00-系统级事实底座

> 系统级定世界观，项目级定工程画像，模块级定职责边界，代码级定执行链路。

模块分析横向梳理能力与职责，代码分析纵向追踪真实执行路径。

## 0. 文档边界说明

本文件由 Kantu 系统级扫描 MVP 生成。当前只完成真实 Git 工程发现、粗粒度类型识别和产物契约校验；源码存在不代表生产启用，生产边界、入口、调用关系和数据归属均等待代码智能、运行态材料或人工确认。

| 契约字段 | 值 | 说明 |
|---|---|---|
| 协议版本 | ${SYSTEM_SCAN_PROTOCOL} | 固定值 |
| 工程发现最大深度 | ${registry.discoveryMaxDepth} | Git 根在该深度内被发现 |
| 文档状态 | 草稿 | 尚未完成系统事实综合 |
| 证据状态 | 工程清单已发现，代码与运行态待确认 | 不包含生产断言 |
| 下层门禁 | ${validation.gate} | 不允许进入项目级正式分析 |
| 校验状态 | ${validation.status} | 只表示机器结构校验结果 |
| 输出目录 | ${markdownCell(path.dirname('system/00-system-fact-base.md'))} | 相对于 Kantu 输出根目录 |

## 1. 当前目录性质

发现 ${registry.projectCount} 个真实 Git 工程。当前工作区性质暂记为 ${registry.projectCount > 1 ? '多仓聚合目录' : registry.projectCount === 1 ? '单仓或单工程目录' : '待确认'}。

## 2. 代码智能索引清单摘要

| 工程 | Provider | 状态 | 说明 |
|---|---|---|---|
${indexes.records.length === 0 ? '| 当前无工程 | unconfigured | PENDING | 待发现工程 |' : indexes.records.map(record => `| ${markdownCell(record.projectDir)} | ${record.provider} | ${record.status} | ${markdownCell(record.reason)} |`).join('\n')}

## 3. 工程清单与归属

| 工程目录 | projectKey | 工程类型 | 生产状态 | 分类证据 | 可信边界 |
|---|---|---|---|---|---|
${projectRows(registry.projects)}

## 4. 生产服务边界

当前没有运行态材料，所有工程生产状态均为待确认。

## 5. 系统入口

当前未采集稳定入口证据，待代码智能或人工确认。

## 6. 基础设施事实

当前未采集稳定基础设施证据，待确认。

## 7. 入口链路概览

当前证据不足，不追踪接口内部实现。

## 8. 系统能力地图（技术视角）

当前证据不足，不根据目录名称推断业务流程。

## 9. 系统内部跨项目关系与调用边界

当前未发现稳定证据；代码关系与生产调用关系均待确认。

## 10. 外部系统与第三方依赖

当前未采集稳定证据，待确认。

## 11. 数据资产与归属边界

当前未采集 SQL、DDL、ORM、Mapper 或运行态数据资产证据，待确认。

## 12. 废弃、历史与旁支工程

当前没有人工确认材料，所有工程状态待确认。

## 13. 术语表

| 标准名称 | 类型 | 对应工程 | 说明 |
|---|---|---|---|
${registry.projects.length === 0 ? '| 待确认 | 工程 | 待确认 | 尚未发现工程 |' : registry.projects.map(project => `| ${markdownCell(project.projectName)} | 工程 | ${markdownCell(project.projectDir)} | 暂以仓库目录名作为展示名 |`).join('\n')}

## 14. 当前可信结论

仅确认最大深度 ${registry.discoveryMaxDepth} 范围内的 Git 工程发现结果与清单中列出的构建标记。

## 15. 冲突与待复核结论

当前没有足够的多源证据执行冲突仲裁。

## 16. 关键待确认问题分级

| 问题 | 分级 | 影响范围 | 建议确认方式 |
|---|---|---|---|
| 代码智能索引尚未建立 | 阻断项目级 | 全部工程 | 配置代码智能 Provider 并刷新系统扫描 |
| 生产边界没有运行态证据 | 影响生产边界 | 全系统 | 提供部署清单、服务注册导出或人工确认 |

## 17. 系统级图表索引

| 图表 | 路径 | 完成状态 |
|---|---|---|
| 系统上下文草图 | system/diagrams/01-system-context.mmd | 草稿，待确认 |
| 内部工程关系草图 | system/diagrams/02-internal-relations.mmd | 草稿，待确认 |
| 入口链路草图 | system/diagrams/03-entry-overview.mmd | 草稿，待确认 |

## 18. 事实底座质量评分

| 维度 | 分数 | 依据 | 主要缺口 |
|---|---:|---|---|
| 工程覆盖 | ${coverageScore}/5 | Git 根发现与稳定身份已生成 | 最大深度外目录和非 Git 工程不纳入 |
| 生产边界可信度 | 0/5 | 无运行态材料 | 全部待确认 |
| 入口链路可信度 | 0/5 | 未采集代码智能证据 | 全部待确认 |
| 内部关系可信度 | 0/5 | 未采集跨工程关系 | 全部待确认 |
| 外部依赖可信度 | 0/5 | 未采集依赖证据 | 全部待确认 |
| 数据归属可信度 | 0/5 | 未采集数据结构与运行证据 | 全部待确认 |

## 19. 证据覆盖率摘要

| 对象 | 总数 | 高证据 | 中证据 | 低证据 | 待确认 | 阻断项 |
|---|---:|---:|---:|---:|---:|---:|
| 工程 | ${registry.projectCount} | 0 | 0 | ${registry.projectCount} | ${registry.projectCount} | ${registry.projectCount === 0 ? 1 : 0} |
| 生产服务 | 0 | 0 | 0 | 0 | 1 | 1 |
| 系统入口 | 0 | 0 | 0 | 0 | 1 | 1 |
| 入口链路 | 0 | 0 | 0 | 0 | 1 | 1 |
| 内部关系 | 0 | 0 | 0 | 0 | 1 | 1 |
| 外部依赖 | 0 | 0 | 0 | 0 | 1 | 0 |
| 数据资产 | 0 | 0 | 0 | 0 | 1 | 0 |

## 20. 系统级产物自检

| 自检项 | 结果 | 说明 |
|---|---|---|
| 工程注册表已生成 | ${validation.status === 'PASSED' ? '通过' : '不通过'} | system/project-registry.json |
| 每个工程都有索引状态 | ${validation.status === 'PASSED' ? '通过' : '不通过'} | 当前均明确为 PENDING |
| 源码存在与生产启用已区分 | 通过 | 未生成生产启用断言 |
| 项目级门禁 | 阻断 | 缺代码智能与运行态证据 |

## 21. 后续分析任务拆分

先为每个工程建立独立代码智能索引，再由单写者综合系统事实；系统门禁 READY 前不自动进入项目级扫描。
`
}

export function renderSystemContextDiagram(projects: ProjectRecord[]): string {
  const nodes = projects.map((project, index) => `  P${index}["${mermaidLabel(project.projectName)}"]`).join('\n')
  return `flowchart LR\n  U["用户 / 外部入口：待确认"]\n  S["Kantu 扫描范围"]\n  U -. 待确认 .-> S\n${nodes || '  P0["当前未发现 Git 工程"]'}\n${projects.map((_project, index) => `  S --> P${index}`).join('\n')}\n`
}

export function renderInternalRelationsDiagram(projects: ProjectRecord[]): string {
  const nodes = projects.map((project, index) => `  P${index}["${mermaidLabel(project.projectName)}"]`).join('\n')
  return `flowchart LR\n${nodes || '  P0["当前未发现 Git 工程"]'}\n  N["工程间关系：待代码智能确认"]\n${projects.map((_project, index) => `  P${index} -. 待确认 .-> N`).join('\n')}\n`
}

export function renderEntryOverviewDiagram(projects: ProjectRecord[]): string {
  return `flowchart LR\n  E["系统入口：待确认"]\n  W["承载工程：${projects.length === 0 ? '待确认' : '见工程注册表'}"]\n  B["后端 / 网关 / 数据资产：待确认"]\n  E -. 待确认 .-> W\n  W -. 待确认 .-> B\n`
}

export interface WriteSystemArtifactsOptions {
  outputRoot: string
  registry: ProjectRegistry
  indexes: IndexManifest
  validation: SystemValidationReport
}

export async function writeSystemArtifacts(options: WriteSystemArtifactsOptions): Promise<void> {
  const systemRoot = path.join(options.outputRoot, 'system')
  await Promise.all([
    atomicWriteJson(path.join(systemRoot, 'project-registry.json'), options.registry),
    atomicWriteJson(path.join(systemRoot, 'index-manifest.json'), options.indexes),
    atomicWriteJson(path.join(systemRoot, 'validation.json'), options.validation),
    atomicWrite(path.join(systemRoot, '00-system-fact-base.md'), renderSystemFactBase(options.registry, options.indexes, options.validation)),
    atomicWrite(path.join(systemRoot, 'diagrams', '01-system-context.mmd'), renderSystemContextDiagram(options.registry.projects)),
    atomicWrite(path.join(systemRoot, 'diagrams', '02-internal-relations.mmd'), renderInternalRelationsDiagram(options.registry.projects)),
    atomicWrite(path.join(systemRoot, 'diagrams', '03-entry-overview.mmd'), renderEntryOverviewDiagram(options.registry.projects)),
  ])
}
