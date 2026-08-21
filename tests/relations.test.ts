import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type ProjectRegistry, type SystemEvidenceBundle } from '../src/contracts/system-scan.js'
import { buildSystemRelationCatalog, systemRelationMetricValues, validateSystemRelationCatalog } from '../src/system/relations.js'

const generatedAt = '2026-08-20T00:00:00.000Z'

function fixtures() {
  const registry: ProjectRegistry = {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    workspaceRoot: '.',
    discoveryMaxDepth: 3,
    projectCount: 3,
    skippedDirectories: [],
    projects: [
      { projectKey: 'gateway-app', projectName: 'gateway-app', projectDir: 'gateway-app', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' },
      { projectKey: 'order-service', projectName: 'order-service', projectDir: 'order-service', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' },
      { projectKey: 'payment-service', projectName: 'payment-service', projectDir: 'payment-service', gitHead: null, projectType: 'java-project', classificationEvidence: ['pom.xml'], productionStatus: 'UNCONFIRMED' },
    ],
  }
  const empty = (projectKey: string): SystemEvidenceBundle['records'][number] => ({
    projectKey,
    projectDir: projectKey,
    status: 'COLLECTED',
    projectTypeCandidates: ['java-service'],
    entries: [],
    outboundDependencies: [],
    relationCandidates: [],
    dataAssets: [],
    infrastructure: [],
    aliases: [],
    capabilityCandidates: [],
    evidencePaths: ['pom.xml'],
    conflicts: [],
    scopeStatus: 'CLEAN',
    scopeViolations: [],
  })
  const evidence: SystemEvidenceBundle = {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    records: [
      {
        ...empty('gateway-app'),
        outboundDependencies: ['order-service client and payment-service SDK'],
        relationCandidates: [
          {
            targetAlias: 'order-service',
            targetProjectKey: 'order-service',
            relationType: 'FEIGN_CLIENT',
            evidenceStrength: 'DIRECT_SOURCE',
            description: 'Gateway declares an order client contract.',
            evidencePaths: ['src/OrderClient.java'],
            runtimeStatus: 'UNCONFIRMED',
          },
          {
            targetAlias: 'order-service',
            targetProjectKey: 'order-service',
            relationType: 'FEIGN_CLIENT',
            evidenceStrength: 'DIRECT_SOURCE',
            description: 'Gateway also declares an order-query client contract.',
            evidencePaths: ['src/OrderQueryClient.java'],
            runtimeStatus: 'UNCONFIRMED',
          },
          {
            targetAlias: 'external-pricing',
            relationType: 'CONFIGURED_ENDPOINT',
            evidenceStrength: 'CONFIGURATION',
            description: 'A pricing endpoint alias is configured.',
            evidencePaths: ['application.yml'],
            runtimeStatus: 'UNCONFIRMED',
          },
        ],
        evidencePaths: ['pom.xml', 'src/OrderClient.java', 'application.yml'],
      },
      empty('order-service'),
      empty('payment-service'),
    ],
  }
  return { registry, evidence }
}

describe('system relation catalog', () => {
  it('preserves structured candidates and all matching fallback targets', () => {
    const { registry, evidence } = fixtures()
    const catalog = buildSystemRelationCatalog(registry, evidence)

    expect(catalog).toMatchObject({ projectCount: 3, totalCount: 5, internalCount: 4, unresolvedCount: 1 })
    expect(catalog.records.filter(record => record.relationType === 'FEIGN_CLIENT')).toHaveLength(2)
    expect(systemRelationMetricValues(catalog)).toMatchObject({
      关系候选总数: '5',
      内部关系数: '4',
      未解析关系数: '1',
      内部关系构成: 'DIRECT_SOURCE=2；CONFIGURATION=0；NAME_MATCH=2',
      未解析关系构成: 'DIRECT_SOURCE=0；CONFIGURATION=1；NAME_MATCH=0',
    })
    expect(catalog.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ relationType: 'FEIGN_CLIENT', targetProjectKey: 'order-service', evidenceStrength: 'DIRECT_SOURCE' }),
      expect.objectContaining({ relationType: 'NAME_MATCH_CANDIDATE', targetProjectKey: 'order-service' }),
      expect.objectContaining({ relationType: 'NAME_MATCH_CANDIDATE', targetProjectKey: 'payment-service' }),
      expect.objectContaining({ relationType: 'CONFIGURED_ENDPOINT', targetAlias: 'external-pricing', scope: 'EXTERNAL_OR_UNRESOLVED' }),
    ]))
    expect(validateSystemRelationCatalog(registry, catalog, evidence)).toEqual([])
  })

  it('fails validation when a worker relation candidate disappears', () => {
    const { registry, evidence } = fixtures()
    const catalog = buildSystemRelationCatalog(registry, evidence)
    const records = catalog.records.filter(record => record.relationType !== 'FEIGN_CLIENT')
    const tampered = {
      ...catalog,
      totalCount: records.length,
      internalCount: records.filter(record => record.scope === 'INTERNAL').length,
      unresolvedCount: records.filter(record => record.scope === 'EXTERNAL_OR_UNRESOLVED').length,
      records,
    }

    expect(validateSystemRelationCatalog(registry, tampered, evidence).map(issue => issue.code))
      .toContain('RELATION_CANDIDATE_DROPPED')
  })
})
