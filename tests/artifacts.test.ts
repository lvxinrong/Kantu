import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type IndexManifest, type ProjectRegistry, type SystemEvidenceBundle } from '../src/contracts/system-scan.js'
import { loadProtocolPack } from '../src/protocol/catalog.js'
import {
  prepareSynthesizedSystemArtifacts,
  renderEntryOverviewDiagram,
  renderInternalRelationsDiagram,
  renderSystemContextDiagram,
  renderSystemFactBase,
  validateSystemArtifacts,
} from '../src/system/artifacts.js'
import { buildSystemRelationCatalog } from '../src/system/relations.js'

describe('validateSystemArtifacts', () => {
  it('rejects index manifests that are not a one-to-one project mapping', () => {
    const generatedAt = '2026-08-19T00:00:00.000Z'
    const registry: ProjectRegistry = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      workspaceRoot: '.',
      discoveryMaxDepth: 3,
      projectCount: 1,
      skippedDirectories: [],
      projects: [{
        projectKey: 'service',
        projectName: 'service',
        projectDir: 'service',
        gitHead: null,
        projectType: 'unknown',
        classificationEvidence: [],
        productionStatus: 'UNCONFIRMED',
      }],
    }
    const indexes: IndexManifest = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [
        { projectKey: 'service', projectDir: 'wrong-path', provider: 'unavailable', status: 'PENDING', reason: 'test' },
        { projectKey: 'service', projectDir: 'service', provider: 'unavailable', status: 'PENDING', reason: 'test' },
      ],
    }

    const report = validateSystemArtifacts(registry, indexes, generatedAt)

    expect(report.status).toBe('FAILED')
    expect(report.gate).toBe('BLOCKED')
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'INDEX_COUNT_MISMATCH',
      'DUPLICATE_INDEX_RECORD',
      'INDEX_PATH_MISMATCH',
    ]))
  })

  it('keeps the worldview document bounded while preserving full raw evidence counts', () => {
    const generatedAt = '2026-08-19T00:00:00.000Z'
    const registry: ProjectRegistry = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      workspaceRoot: '.',
      discoveryMaxDepth: 3,
      projectCount: 1,
      skippedDirectories: [],
      projects: [{
        projectKey: 'service',
        projectName: 'service',
        projectDir: 'nested/service',
        gitHead: null,
        projectType: 'java-project',
        classificationEvidence: ['pom.xml'],
        productionStatus: 'UNCONFIRMED',
      }],
    }
    const indexes: IndexManifest = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [{ projectKey: 'service', projectDir: 'nested/service', provider: 'codebase-memory-mcp', status: 'FRESH', reason: 'ready' }],
    }
    const values = Array.from({ length: 8 }, (_value, index) => `fact-${index}`)
    const evidence: SystemEvidenceBundle = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [{
        projectKey: 'service',
        projectDir: 'nested/service',
        status: 'COLLECTED',
        projectTypeCandidates: ['Spring service', 'secondary classification'],
        entries: values.map(value => `entry-${value}`),
        outboundDependencies: values.map(value => `dependency-${value}`),
        dataAssets: values.map(value => `data-${value}`),
        infrastructure: values.map(value => `infra-${value}`),
        aliases: values.map(value => `alias-${value}`),
        capabilityCandidates: values.map(value => `capability-${value}`),
        evidencePaths: ['pom.xml'],
        conflicts: values.map(value => `conflict-${value}`),
        scopeStatus: 'CLEAN',
        scopeViolations: [],
      }],
    }
    const validation = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
    const factBase = renderSystemFactBase(registry, indexes, evidence, validation)

    expect(validation).toMatchObject({ status: 'PASSED', gate: 'READY' })
    expect(factBase).toContain('8 条原始入口证据')
    expect(factBase).toContain('system/evidence/index.json')
    expect(factBase).not.toContain('entry-fact-0')
    expect(factBase).not.toContain('capability-fact-0')
    expect(factBase).not.toContain('conflict-fact-0')
    expect(factBase).toContain('共记录 8 条原始冲突或不确定项')
    expect(factBase).toContain('| 工程注册表已生成 | 通过 |')
    expect(factBase).toContain('| 证据范围检查 | 通过 |')
    expect(factBase).toContain('| 证据状态 | 源码视角已完成，运行态待确认 |')

    const context = renderSystemContextDiagram(registry.projects, evidence)
    const relations = renderInternalRelationsDiagram(registry.projects, evidence)
    const entries = renderEntryOverviewDiagram(registry.projects, evidence)
    expect(context).toContain('源码视角系统边界')
    expect(context).toContain('服务 / API 边界候选')
    expect(relations).toContain('运行态待确认')
    expect(entries).toContain('服务与 API 边界')
    expect(entries).not.toContain('见工程注册表')
  })

  it('corrects mobile types from primary evidence without promoting backend feature descriptions', () => {
    const generatedAt = '2026-08-19T00:00:00.000Z'
    const projects: ProjectRegistry['projects'] = [
      { projectKey: 'android', projectName: 'android', projectDir: 'android', gitHead: null, projectType: 'java-project', classificationEvidence: ['build.gradle'], productionStatus: 'UNCONFIRMED' },
      { projectKey: 'ios', projectName: 'ios', projectDir: 'ios', gitHead: null, projectType: 'unknown', classificationEvidence: ['Podfile'], productionStatus: 'UNCONFIRMED' },
      { projectKey: 'web', projectName: 'web', projectDir: 'web', gitHead: null, projectType: 'web-frontend', classificationEvidence: ['package.json'], productionStatus: 'UNCONFIRMED' },
      { projectKey: 'backend', projectName: 'backend', projectDir: 'backend', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' },
    ]
    const record = (projectKey: string, primary: string, secondary = ''): SystemEvidenceBundle['records'][number] => ({
      projectKey,
      projectDir: projectKey,
      status: 'COLLECTED',
      projectTypeCandidates: [primary, secondary].filter(Boolean),
      entries: ['entry evidence'],
      outboundDependencies: [],
      dataAssets: [],
      infrastructure: [],
      aliases: [],
      capabilityCandidates: [],
      evidencePaths: [],
      conflicts: [],
      scopeStatus: 'CLEAN',
      scopeViolations: [],
    })
    const evidence: SystemEvidenceBundle = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [
        record('android', '原生 Android 应用'),
        record('ios', 'iOS 原生移动应用（Objective-C 为主）'),
        record('web', 'Vue 2 H5 前端'),
        record('backend', 'Java Spring Boot 后端服务', '微信小程序后端服务'),
      ],
    }

    const diagram = renderSystemContextDiagram(projects, evidence)
    expect(diagram).toContain('移动客户端<br/>android、ios')
    expect(diagram).toContain('Web/H5 前端<br/>web')
    expect(diagram).not.toContain('微信小程序<br/>backend')
    expect(diagram).toContain('服务 / API 边界候选<br/>1 个工程')
  })

  it('keeps a valid document blocked when it declares an active project-level blocker', async () => {
    const generatedAt = '2026-08-19T00:00:00.000Z'
    const registry: ProjectRegistry = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      workspaceRoot: '.',
      discoveryMaxDepth: 3,
      projectCount: 1,
      skippedDirectories: [],
      projects: [{ projectKey: 'service', projectName: 'service', projectDir: 'service', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' }],
    }
    const indexes: IndexManifest = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [{ projectKey: 'service', projectDir: 'service', provider: 'codebase-memory-mcp', status: 'FRESH', reason: 'ready' }],
    }
    const evidence: SystemEvidenceBundle = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      records: [{
        projectKey: 'service', projectDir: 'service', status: 'COLLECTED', projectTypeCandidates: ['Spring service'], entries: ['REST API'], outboundDependencies: [], dataAssets: [], infrastructure: [], aliases: [], capabilityCandidates: ['service capability'], evidencePaths: ['pom.xml'], conflicts: [], scopeStatus: 'CLEAN', scopeViolations: [],
      }],
    }
    const initial = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
    const factBase = renderSystemFactBase(registry, indexes, evidence, initial).replace('当前无源码视角阻断项', '重复工程归属尚未仲裁')
    const prepared = prepareSynthesizedSystemArtifacts(registry, indexes, evidence, buildSystemRelationCatalog(registry, evidence), generatedAt, await loadProtocolPack(), {
      factBase,
      diagrams: {
        systemContext: renderSystemContextDiagram(registry.projects, evidence),
        internalRelations: renderInternalRelationsDiagram(registry.projects, evidence),
        entryOverview: renderEntryOverviewDiagram(registry.projects, evidence),
      },
    })

    expect(prepared.validation).toMatchObject({ status: 'PASSED', gate: 'BLOCKED' })
    expect(prepared.validation.issues.map(issue => issue.code)).toContain('PROJECT_GATE_BLOCKED_BY_DOCUMENT')
    expect(prepared.factBase).toContain('| 下层门禁 | BLOCKED |')
    expect(prepared.factBase).toContain('| 项目级门禁 | BLOCKED |')
  })

  it('writes authoritative relation metrics and rejects contradictory model counts', async () => {
    const generatedAt = '2026-08-20T00:00:00.000Z'
    const registry: ProjectRegistry = {
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt,
      workspaceRoot: '.',
      discoveryMaxDepth: 3,
      projectCount: 0,
      projects: [],
      skippedDirectories: [],
    }
    const indexes: IndexManifest = { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, records: [] }
    const evidence: SystemEvidenceBundle = { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, records: [] }
    const relations = buildSystemRelationCatalog(registry, evidence)
    const initial = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
    const factBase = renderSystemFactBase(registry, indexes, evidence, initial)
      .replace('## 1. 当前目录性质', '模型声称完整关系候选目录（367 条，内部 157 / 未解析 210）。\n\n## 1. 当前目录性质')
    const prepared = prepareSynthesizedSystemArtifacts(registry, indexes, evidence, relations, generatedAt, await loadProtocolPack(), {
      factBase,
      diagrams: {
        systemContext: `${renderSystemContextDiagram(registry.projects, evidence)}\n%% /Users/example/workspace`,
        internalRelations: renderInternalRelationsDiagram(registry.projects, evidence),
        entryOverview: renderEntryOverviewDiagram(registry.projects, evidence),
      },
    })

    expect(prepared.factBase).toContain('| 关系候选总数 | 0 |')
    expect(prepared.factBase).toContain('| 内部关系数 | 0 |')
    expect(prepared.factBase).toContain('| 未解析关系数 | 0 |')
    expect(prepared.validation.status).toBe('FAILED')
    expect(prepared.validation.issues.map(issue => issue.code)).toContain('SYSTEM_RELATION_METRIC_MISMATCH')
    expect(prepared.validation.issues.map(issue => issue.code)).toContain('SYSTEM_LOCAL_PATH_LEAK')
  })
})
