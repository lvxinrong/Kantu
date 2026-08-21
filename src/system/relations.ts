import { createHash } from 'node:crypto'

import {
  SYSTEM_SCAN_PROTOCOL,
  type ProjectRecord,
  type ProjectRegistry,
  type ProjectRelationCandidate,
  type ProjectSystemEvidence,
  type RelationEvidenceStrength,
  type SystemEvidenceBundle,
  type SystemRelationCatalog,
  type SystemRelationRecord,
  type SystemRelationType,
  type ValidationIssue,
} from '../contracts/system-scan.js'

const GENERIC_IDENTIFIERS = new Set([
  'api', 'backend', 'base', 'common', 'dashboard', 'frontend', 'mobile', 'root', 'service', 'system', 'web',
])

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

function projectIdentifiers(project: ProjectRecord): string[] {
  return [...new Set([
    project.projectKey,
    project.projectDir,
    project.projectDir.split('/').at(-1) ?? '',
    project.projectName,
  ].map(normalized).filter(identifier => identifier.length >= 4 && !GENERIC_IDENTIFIERS.has(identifier)))]
}

function resolveTarget(
  projects: ProjectRecord[],
  sourceProjectKey: string,
  targetAlias: string,
  requestedProjectKey?: string,
): ProjectRecord | undefined {
  if (requestedProjectKey !== undefined) {
    const requested = projects.find(project => project.projectKey === requestedProjectKey && project.projectKey !== sourceProjectKey)
    if (requested !== undefined) return requested
  }
  const target = normalized(targetAlias)
  if (target === '') return undefined
  return projects.find(project => project.projectKey !== sourceProjectKey
    && projectIdentifiers(project).some(identifier => target === identifier || target.includes(identifier)))
}

function relationId(key: string): string {
  return `REL-${createHash('sha256').update(key).digest('hex').slice(0, 12)}`
}

function safeCandidate(candidate: ProjectRelationCandidate): ProjectRelationCandidate {
  return {
    targetAlias: candidate.targetAlias.trim(),
    ...candidate.targetProjectKey === undefined || candidate.targetProjectKey.trim() === ''
      ? {}
      : { targetProjectKey: candidate.targetProjectKey.trim() },
    relationType: candidate.relationType,
    evidenceStrength: candidate.evidenceStrength,
    description: candidate.description.trim(),
    evidencePaths: [...new Set(candidate.evidencePaths.map(value => value.trim()).filter(Boolean))].slice(0, 20),
    runtimeStatus: 'UNCONFIRMED',
  }
}

function structuredRecords(registry: ProjectRegistry, record: ProjectSystemEvidence): SystemRelationRecord[] {
  return (record.relationCandidates ?? []).flatMap(raw => {
    const candidate = safeCandidate(raw)
    if (candidate.targetAlias === '' || candidate.description === '' || candidate.evidencePaths.length === 0) return []
    const target = resolveTarget(registry.projects, record.projectKey, candidate.targetAlias, candidate.targetProjectKey)
    const key = [record.projectKey, target?.projectKey ?? normalized(candidate.targetAlias), candidate.relationType, candidate.description].join('\u0000')
    return [{
      ...candidate,
      relationId: relationId(key),
      sourceProjectKey: record.projectKey,
      sourceProjectDir: record.projectDir,
      targetAlias: candidate.targetAlias,
      ...target === undefined ? {} : { targetProjectKey: target.projectKey, targetProjectDir: target.projectDir },
      scope: target === undefined ? 'EXTERNAL_OR_UNRESOLVED' : 'INTERNAL',
    }]
  })
}

function fallbackRecords(registry: ProjectRegistry, record: ProjectSystemEvidence): SystemRelationRecord[] {
  return record.outboundDependencies.flatMap(description => registry.projects.flatMap(target => {
    if (target.projectKey === record.projectKey) return []
    const haystack = normalized(description)
    if (!projectIdentifiers(target).some(identifier => haystack.includes(identifier))) return []
    const key = [record.projectKey, target.projectKey, 'NAME_MATCH_CANDIDATE', description].join('\u0000')
    return [{
      relationId: relationId(key),
      sourceProjectKey: record.projectKey,
      sourceProjectDir: record.projectDir,
      targetAlias: target.projectName,
      targetProjectKey: target.projectKey,
      targetProjectDir: target.projectDir,
      relationType: 'NAME_MATCH_CANDIDATE' as const,
      evidenceStrength: 'NAME_MATCH' as const,
      description,
      evidencePaths: record.evidencePaths.slice(0, 6),
      runtimeStatus: 'UNCONFIRMED' as const,
      scope: 'INTERNAL' as const,
    }]
  }))
}

function strengthRank(value: RelationEvidenceStrength): number {
  return value === 'DIRECT_SOURCE' ? 3 : value === 'CONFIGURATION' ? 2 : 1
}

function mergeRecords(records: SystemRelationRecord[]): SystemRelationRecord[] {
  const merged = new Map<string, SystemRelationRecord>()
  for (const record of records) {
    // Only collapse exact semantic duplicates. Distinct calls between the same
    // pair and of the same type must remain individually reviewable.
    const key = [
      record.sourceProjectKey,
      record.targetProjectKey ?? normalized(record.targetAlias),
      record.relationType,
      record.description,
    ].join('\u0000')
    const current = merged.get(key)
    if (current === undefined) {
      merged.set(key, record)
      continue
    }
    const descriptions = [...new Set([current.description, record.description])]
    const evidencePaths = [...new Set([...current.evidencePaths, ...record.evidencePaths])].slice(0, 20)
    merged.set(key, {
      ...current,
      relationId: relationId(key),
      evidenceStrength: strengthRank(record.evidenceStrength) > strengthRank(current.evidenceStrength)
        ? record.evidenceStrength
        : current.evidenceStrength,
      description: descriptions.join('；'),
      evidencePaths,
    })
  }
  return [...merged.values()].sort((left, right) =>
    left.sourceProjectKey.localeCompare(right.sourceProjectKey)
    || (left.targetProjectKey ?? left.targetAlias).localeCompare(right.targetProjectKey ?? right.targetAlias)
    || left.relationType.localeCompare(right.relationType))
}

export function buildSystemRelationCatalog(
  registry: ProjectRegistry,
  evidence: SystemEvidenceBundle,
): SystemRelationCatalog {
  const records = mergeRecords(evidence.records.flatMap(record => [
    ...structuredRecords(registry, record),
    ...fallbackRecords(registry, record),
  ]))
  return {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt: evidence.generatedAt,
    projectCount: registry.projectCount,
    projectsWithRelations: new Set(records.map(record => record.sourceProjectKey)).size,
    totalCount: records.length,
    internalCount: records.filter(record => record.scope === 'INTERNAL').length,
    unresolvedCount: records.filter(record => record.scope === 'EXTERNAL_OR_UNRESOLVED').length,
    records,
  }
}

export function validateSystemRelationCatalog(
  registry: ProjectRegistry,
  catalog: SystemRelationCatalog,
  evidence?: SystemEvidenceBundle,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const projectKeys = new Set(registry.projects.map(project => project.projectKey))
  const projectsByKey = new Map(registry.projects.map(project => [project.projectKey, project]))
  if (catalog.protocolVersion !== SYSTEM_SCAN_PROTOCOL) {
    issues.push({ severity: 'ERROR', code: 'RELATION_PROTOCOL_MISMATCH', message: 'Relation catalog protocolVersion is invalid.' })
  }
  if (catalog.projectCount !== registry.projectCount) {
    issues.push({ severity: 'ERROR', code: 'RELATION_PROJECT_COUNT_MISMATCH', message: 'Relation catalog projectCount does not match the project registry.' })
  }
  if (catalog.totalCount !== catalog.records.length
    || catalog.projectsWithRelations !== new Set(catalog.records.map(record => record.sourceProjectKey)).size
    || catalog.internalCount !== catalog.records.filter(record => record.scope === 'INTERNAL').length
    || catalog.unresolvedCount !== catalog.records.filter(record => record.scope === 'EXTERNAL_OR_UNRESOLVED').length) {
    issues.push({ severity: 'ERROR', code: 'RELATION_COUNT_MISMATCH', message: 'Relation catalog counters do not match its records.' })
  }
  const ids = new Set<string>()
  for (const record of catalog.records) {
    if (ids.has(record.relationId)) {
      issues.push({ severity: 'ERROR', code: 'DUPLICATE_RELATION_ID', message: `Duplicate relation id: ${record.relationId}.` })
    }
    ids.add(record.relationId)
    if (!projectKeys.has(record.sourceProjectKey)) {
      issues.push({ severity: 'ERROR', code: 'UNKNOWN_RELATION_SOURCE', message: `Unknown relation source: ${record.sourceProjectKey}.` })
    } else if (projectsByKey.get(record.sourceProjectKey)?.projectDir !== record.sourceProjectDir) {
      issues.push({ severity: 'ERROR', code: 'RELATION_SOURCE_PATH_MISMATCH', message: `Relation ${record.relationId} source path does not match the project registry.` })
    }
    if (record.scope === 'INTERNAL' && (record.targetProjectKey === undefined || !projectKeys.has(record.targetProjectKey))) {
      issues.push({ severity: 'ERROR', code: 'UNKNOWN_RELATION_TARGET', message: `Unknown internal relation target for ${record.relationId}.` })
    } else if (record.scope === 'INTERNAL' && record.targetProjectKey !== undefined
      && projectsByKey.get(record.targetProjectKey)?.projectDir !== record.targetProjectDir) {
      issues.push({ severity: 'ERROR', code: 'RELATION_TARGET_PATH_MISMATCH', message: `Relation ${record.relationId} target path does not match the project registry.` })
    }
    if (record.evidencePaths.length === 0) {
      issues.push({ severity: 'ERROR', code: 'RELATION_EVIDENCE_MISSING', message: `Relation ${record.relationId} has no evidence path.` })
    }
    if (record.evidencePaths.some(evidencePath => evidencePath.startsWith('/')
      || /^[A-Za-z]:[\\/]/u.test(evidencePath)
      || evidencePath.split(/[\\/]/u).includes('..'))) {
      issues.push({ severity: 'ERROR', code: 'RELATION_EVIDENCE_PATH_UNSAFE', message: `Relation ${record.relationId} contains an absolute or parent-traversal evidence path.` })
    }
  }
  if (evidence !== undefined) {
    for (const source of evidence.records) {
      for (const candidate of source.relationCandidates ?? []) {
        const target = resolveTarget(registry.projects, source.projectKey, candidate.targetAlias, candidate.targetProjectKey)
        const represented = catalog.records.some(record => record.sourceProjectKey === source.projectKey
          && record.relationType === candidate.relationType
          && (target === undefined
            ? normalized(record.targetAlias) === normalized(candidate.targetAlias)
            : record.targetProjectKey === target.projectKey))
        if (!represented) {
          issues.push({
            severity: 'ERROR',
            code: 'RELATION_CANDIDATE_DROPPED',
            message: `Relation candidate from ${source.projectKey} to ${candidate.targetAlias} is missing from the complete catalog.`,
          })
        }
      }
    }
  }
  return issues
}

export const SYSTEM_RELATION_TYPES: readonly SystemRelationType[] = [
  'FEIGN_CLIENT',
  'HTTP_ROUTE_FAMILY',
  'MAVEN_API_DEPENDENCY',
  'SDK_DEPENDENCY',
  'MESSAGE_CHANNEL',
  'SHARED_DATA_ASSET',
  'CONFIGURED_ENDPOINT',
  'NAME_MATCH_CANDIDATE',
  'OTHER',
]

export interface SystemRelationMetrics {
  totalCount: number
  internalCount: number
  unresolvedCount: number
  internalByStrength: Record<RelationEvidenceStrength, number>
  unresolvedByStrength: Record<RelationEvidenceStrength, number>
  byType: Record<SystemRelationType, number>
}

export const SYSTEM_RELATION_METRIC_FIELDS = [
  '关系候选总数',
  '内部关系数',
  '未解析关系数',
  '内部关系构成',
  '未解析关系构成',
  '关系类型构成',
] as const

export function systemRelationMetrics(catalog: SystemRelationCatalog): SystemRelationMetrics {
  const strengthCounts = (scope: SystemRelationRecord['scope']): Record<RelationEvidenceStrength, number> => ({
    DIRECT_SOURCE: catalog.records.filter(record => record.scope === scope && record.evidenceStrength === 'DIRECT_SOURCE').length,
    CONFIGURATION: catalog.records.filter(record => record.scope === scope && record.evidenceStrength === 'CONFIGURATION').length,
    NAME_MATCH: catalog.records.filter(record => record.scope === scope && record.evidenceStrength === 'NAME_MATCH').length,
  })
  return {
    totalCount: catalog.totalCount,
    internalCount: catalog.internalCount,
    unresolvedCount: catalog.unresolvedCount,
    internalByStrength: strengthCounts('INTERNAL'),
    unresolvedByStrength: strengthCounts('EXTERNAL_OR_UNRESOLVED'),
    byType: Object.fromEntries(SYSTEM_RELATION_TYPES.map(type => [
      type,
      catalog.records.filter(record => record.relationType === type).length,
    ])) as Record<SystemRelationType, number>,
  }
}

export function systemRelationMetricValues(catalog: SystemRelationCatalog): Record<(typeof SYSTEM_RELATION_METRIC_FIELDS)[number], string> {
  const metrics = systemRelationMetrics(catalog)
  const strengths = (counts: Record<RelationEvidenceStrength, number>) =>
    `DIRECT_SOURCE=${counts.DIRECT_SOURCE}；CONFIGURATION=${counts.CONFIGURATION}；NAME_MATCH=${counts.NAME_MATCH}`
  return {
    关系候选总数: String(metrics.totalCount),
    内部关系数: String(metrics.internalCount),
    未解析关系数: String(metrics.unresolvedCount),
    内部关系构成: strengths(metrics.internalByStrength),
    未解析关系构成: strengths(metrics.unresolvedByStrength),
    关系类型构成: SYSTEM_RELATION_TYPES.map(type => `${type}=${metrics.byType[type]}`).join('；'),
  }
}
