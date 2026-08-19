import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type IndexManifest, type ProjectRegistry } from '../src/contracts/system-scan.js'
import { validateSystemArtifacts } from '../src/system/artifacts.js'

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
        { projectKey: 'service', projectDir: 'wrong-path', provider: 'unconfigured', status: 'PENDING', reason: 'test' },
        { projectKey: 'service', projectDir: 'service', provider: 'unconfigured', status: 'PENDING', reason: 'test' },
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
})
