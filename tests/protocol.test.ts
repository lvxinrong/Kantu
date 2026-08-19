import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type IndexManifest, type ProjectRegistry, type SystemEvidenceBundle } from '../src/contracts/system-scan.js'
import { loadProtocolPack, parseProtocolContract } from '../src/protocol/catalog.js'
import { markdownHeadings, validateSystemDocument } from '../src/protocol/validation.js'
import { renderSystemFactBase, validateSystemArtifacts } from '../src/system/artifacts.js'

const artifactPaths = [
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

function fixture(): { registry: ProjectRegistry, indexes: IndexManifest, evidence: SystemEvidenceBundle, generatedAt: string } {
  const generatedAt = '2026-08-19T00:00:00.000Z'
  const registry: ProjectRegistry = {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    workspaceRoot: '.',
    discoveryMaxDepth: 3,
    projectCount: 0,
    projects: [],
    skippedDirectories: [],
  }
  return {
    generatedAt,
    registry,
    indexes: { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, records: [] },
    evidence: { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, records: [] },
  }
}

describe('system protocol pack', () => {
  it('loads every versioned resource and produces a reproducible lock', async () => {
    const pack = await loadProtocolPack()

    expect(pack.manifest.packId).toBe('kantu/protocol/system/v1')
    expect(pack.resources).toHaveLength(pack.manifest.resources.length)
    expect(pack.lock.packDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(pack.lock.resources.every(resource => /^[a-f0-9]{64}$/u.test(resource.digest))).toBe(true)
  })

  it('keeps the rendered system template aligned with the document contract', async () => {
    const pack = await loadProtocolPack()
    const { registry, indexes, evidence, generatedAt } = fixture()
    const validation = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
    const factBase = renderSystemFactBase(registry, indexes, evidence, validation)
    const contract = parseProtocolContract<{ headings: string[] }>(pack, 'kantu/contract/system-document/v1')

    expect(markdownHeadings(factBase)).toEqual(contract.headings)
    expect(validateSystemDocument(factBase, artifactPaths, pack)).toEqual([])
  })

  it('fails closed on missing artifacts, invalid structure, and sensitive values', async () => {
    const pack = await loadProtocolPack()
    const { registry, indexes, evidence, generatedAt } = fixture()
    const validation = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
    const unsafe = renderSystemFactBase(registry, indexes, evidence, validation)
      .replace('## 21. 后续分析任务拆分', '## 22. 错误章节')
      .concat('\npassword=abcdefghijklmnop\n')
    const issues = validateSystemDocument(unsafe, artifactPaths.slice(0, -1), pack)

    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'SYSTEM_HEADINGS_INVALID',
      'SYSTEM_ARTIFACT_MISSING',
      'SENSITIVE_VALUE_DETECTED',
    ]))
  })
})
