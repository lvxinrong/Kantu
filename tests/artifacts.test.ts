import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type IndexManifest, type ProjectRegistry, type SystemEvidenceBundle } from '../src/contracts/system-scan.js'
import { renderSystemFactBase, validateSystemArtifacts } from '../src/system/artifacts.js'

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
    expect(factBase).toContain('entry-fact-2')
    expect(factBase).not.toContain('entry-fact-3')
    expect(factBase).toContain('capability-fact-3')
    expect(factBase).not.toContain('capability-fact-4')
    expect(factBase).toContain('共记录 8 条冲突或不确定项')
    expect(factBase).toContain('| 工程注册表已生成 | 通过 |')
    expect(factBase).toContain('| 证据范围检查 | 通过 |')
    expect(factBase).toContain('| 证据状态 | 源码视角已完成，运行态待确认 |')
  })
})
