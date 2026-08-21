import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type IndexManifest, type ProjectRegistry, type SystemEvidenceBundle } from '../src/contracts/system-scan.js'
import { loadProtocolPack } from '../src/protocol/catalog.js'
import { buildSystemRelationCatalog } from '../src/system/relations.js'
import { buildSystemSynthesisContext } from '../src/system/synthesis.js'

const generatedAt = '2026-08-20T00:00:00.000Z'
const registry: ProjectRegistry = {
  protocolVersion: SYSTEM_SCAN_PROTOCOL,
  generatedAt,
  workspaceRoot: '.',
  discoveryMaxDepth: 3,
  projectCount: 1,
  skippedDirectories: [],
  projects: [{ projectKey: 'service-a', projectName: 'service-a', projectDir: 'service-a', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' }],
}
const indexes: IndexManifest = {
  protocolVersion: SYSTEM_SCAN_PROTOCOL,
  generatedAt,
  records: [{ projectKey: 'service-a', projectDir: 'service-a', provider: 'codebase-memory-mcp', status: 'FRESH', reason: 'ready' }],
}

function evidence(payloadSize: number): SystemEvidenceBundle {
  return {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    records: [{
      projectKey: 'service-a',
      projectDir: 'service-a',
      status: 'COLLECTED',
      projectTypeCandidates: ['java-service'],
      entries: [`entry-${'x'.repeat(payloadSize)}`],
      outboundDependencies: [],
      relationCandidates: [{
        targetAlias: 'external-ledger',
        relationType: 'CONFIGURED_ENDPOINT',
        evidenceStrength: 'CONFIGURATION',
        description: 'Ledger integration candidate remains complete.',
        evidencePaths: ['application.yml'],
        runtimeStatus: 'UNCONFIRMED',
      }],
      dataAssets: [],
      infrastructure: [],
      aliases: [],
      capabilityCandidates: [],
      evidencePaths: ['application.yml'],
      conflicts: [],
      scopeStatus: 'CLEAN',
      scopeViolations: [],
    }],
  }
}

describe('system synthesis evidence injection', () => {
  it('injects a 400 KiB evidence bundle in full with the new default auto threshold', async () => {
    const bundle = evidence(400 * 1024)
    const relations = buildSystemRelationCatalog(registry, bundle)
    const context = buildSystemSynthesisContext('run-full-auto', await loadProtocolPack(), registry, indexes, bundle, relations)

    expect(context.evidenceBytes).toBeLessThanOrEqual(524_288)
    expect(context).toMatchObject({ evidenceMode: 'FULL', fullEvidenceMaxBytes: 524_288, relationCount: 1 })
    expect(context.prompt).toContain(`entry-${'x'.repeat(1024)}`)
    expect(context.prompt).toContain('Ledger integration candidate remains complete.')
  })

  it('bounds oversized evidence while always injecting the complete relation catalog', async () => {
    const bundle = evidence(16 * 1024)
    const relations = buildSystemRelationCatalog(registry, bundle)
    const context = buildSystemSynthesisContext('run-bounded', await loadProtocolPack(), registry, indexes, bundle, relations, {
      evidenceContextMode: 'auto',
      fullEvidenceMaxBytes: 1024,
    })

    expect(context).toMatchObject({ evidenceMode: 'BOUNDED', fullEvidenceMaxBytes: 1024, relationCount: 1 })
    expect(context.prompt).toContain('完整系统关系候选目录（不裁剪）')
    expect(context.prompt).toContain('Ledger integration candidate remains complete.')
    expect(context.prompt).toContain('fullEvidenceArtifact')
  })

  it('allows explicit full mode to override the auto byte limit', async () => {
    const bundle = evidence(16 * 1024)
    const relations = buildSystemRelationCatalog(registry, bundle)
    const context = buildSystemSynthesisContext('run-force-full', await loadProtocolPack(), registry, indexes, bundle, relations, {
      evidenceContextMode: 'full',
      fullEvidenceMaxBytes: 1024,
    })

    expect(context.evidenceMode).toBe('FULL')
  })
})
