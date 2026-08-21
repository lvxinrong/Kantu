import type { ValidationIssue } from '../contracts/system-scan.js'
import { parseProtocolContract, type LoadedProtocolPack } from './catalog.js'

const SYSTEM_DOCUMENT_CONTRACT = 'archscope/contract/system-document/v1'
const EVIDENCE_CONTRACT = 'archscope/contract/evidence/v1'
const LAYER_STATE_CONTRACT = 'archscope/contract/layer-state-machine/v1'

interface SystemDocumentContract {
  metadata: Record<string, string[]>
  machineRelationFields: string[]
  headings: string[]
  requiredArtifacts: string[]
  forbiddenHeadingPatterns: string[]
  requiredQuestionClasses: string[]
  requiredSelfChecks: string[]
  requiredEvidenceSourceTypes: string[]
  qualityDimensions: string[]
  evidenceCoverageObjects: string[]
  boundaryRules: {
    maxDocumentCharacters: number
    requiredDetailPointer: string
    requiredRelationPointer: string
    detailSensitiveSections: string[]
    maxTableRowsBySection: Record<string, number>
    forbiddenDetailPatterns: Array<{ id: string, source: string, flags: string }>
    minTrustedConclusionRows: number
  }
}

export interface SystemDocumentValidationContext {
  relationMetrics?: Record<string, string>
}

interface EvidenceContract {
  redaction: {
    skipMarkers: string[]
    patterns: Array<{ id: string, source: string, flags: string }>
  }
}

interface LayerStateContract {
  transitions: {
    systemToProject: Record<string, string[]>
  }
}

export function markdownHeadings(content: string): string[] {
  return content.split(/\r?\n/gu).filter(line => /^#{2,3} /u.test(line)).map(line => line.trimEnd())
}

export function metadataValues(content: string, keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map(key => {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const match = new RegExp(`^\\|\\s*${escaped}\\s*\\|\\s*([^|]*?)\\s*\\|`, 'mu').exec(content)
    return [key, match?.[1]?.trim()]
  }))
}

function markdownSection(content: string, heading: string): string {
  const start = content.indexOf(heading)
  if (start < 0) return ''
  const bodyStart = start + heading.length
  const remainder = content.slice(bodyStart)
  const nextHeading = /\n## /u.exec(remainder)
  return nextHeading === null ? remainder : remainder.slice(0, nextHeading.index)
}

function markdownTableDataRows(section: string): number {
  const rows = section.split(/\r?\n/gu).filter(line => /^\|/u.test(line.trim()))
    .filter(line => !/^\|(?:\s*:?-+:?\s*\|)+\s*$/u.test(line.trim()))
  return Math.max(0, rows.length - 1)
}

function markdownTableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/gu, '').split(/(?<!\\)\|/u).map(cell => cell.trim().replace(/\\\|/gu, '|'))
}

export function activeProjectBlockers(content: string): string[] {
  const section = markdownSection(content, '## 16. 关键待确认问题分级')
  return section.split(/\r?\n/gu)
    .filter(line => /^\|/u.test(line.trim()))
    .map(markdownTableCells)
    .filter(cells => cells[1] === '阻断项目级')
    .map(cells => cells[0] ?? '')
    .filter(problem => !/^(?:当前)?(?:无|未发现|没有|不适用)/u.test(problem))
}

export function validateSensitiveContent(
  content: string,
  pack: LoadedProtocolPack,
  location = 'system report',
): ValidationIssue[] {
  const evidence = parseProtocolContract<EvidenceContract>(pack, EVIDENCE_CONTRACT)
  const patterns = evidence.redaction.patterns.map(item => ({ id: item.id, regex: new RegExp(item.source, item.flags) }))
  const issues: ValidationIssue[] = []
  for (const [index, line] of content.split(/\r?\n/gu).entries()) {
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0
      if (!pattern.regex.test(line)) continue
      issues.push({ severity: 'ERROR', code: 'SENSITIVE_VALUE_DETECTED', message: `${pattern.id} detected at ${location} line ${index + 1}.` })
      break
    }
  }
  return issues
}

export function validatePortableContent(
  content: string,
  location = 'system report',
): ValidationIssue[] {
  const localPathMatch = /(?:\/Users\/[^\s|`]+|\/home\/[^\s|`]+|\/workspace(?:\/[^\s|`]*)?|\b[A-Za-z]:\\Users\\[^\s|`]+)/u.exec(content)
  return localPathMatch === null
    ? []
    : [{
        severity: 'ERROR',
        code: 'SYSTEM_LOCAL_PATH_LEAK',
        message: `${location} contains a machine-local absolute path: ${localPathMatch[0]}.`,
      }]
}

function firstInteger(value: string | undefined): number | undefined {
  const match = value === undefined ? undefined : /\d+/u.exec(value)
  return match === undefined || match === null ? undefined : Number(match[0])
}

function validateRelationMetricClaims(content: string, values: Record<string, string>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const expected = {
    total: Number(values['关系候选总数']),
    internal: Number(values['内部关系数']),
    unresolved: Number(values['未解析关系数']),
    internalDirect: Number(/DIRECT_SOURCE=(\d+)/u.exec(values['内部关系构成'] ?? '')?.[1]),
    internalConfiguration: Number(/CONFIGURATION=(\d+)/u.exec(values['内部关系构成'] ?? '')?.[1]),
    internalNameMatch: Number(/NAME_MATCH=(\d+)/u.exec(values['内部关系构成'] ?? '')?.[1]),
    unresolvedDirect: Number(/DIRECT_SOURCE=(\d+)/u.exec(values['未解析关系构成'] ?? '')?.[1]),
    unresolvedConfiguration: Number(/CONFIGURATION=(\d+)/u.exec(values['未解析关系构成'] ?? '')?.[1]),
    unresolvedNameMatch: Number(/NAME_MATCH=(\d+)/u.exec(values['未解析关系构成'] ?? '')?.[1]),
  }
  const machineFields = new Set(Object.keys(values))
  const claimPatterns: Array<{ label: string, expected: number, regex: RegExp }> = [
    { label: '关系候选总数', expected: expected.total, regex: /(?:关系候选目录|关系目录)[^\d\n|]{0,12}(\d+)\s*条/gu },
    { label: '内部关系数', expected: expected.internal, regex: /内部(?:关系)?\s*[：:=]?\s*(\d+)\s*(?:条|\/|／|，|,|\))/gu },
    { label: '未解析关系数', expected: expected.unresolved, regex: /未解析(?:关系)?\s*[：:=]?\s*(\d+)/gu },
    { label: '内部 DIRECT_SOURCE', expected: expected.internalDirect, regex: /(\d+)\s*条\s*DIRECT_SOURCE\s*内部关系/gu },
  ]
  for (const [lineIndex, line] of content.split(/\r?\n/gu).entries()) {
    const cells = /^\|/u.test(line.trim()) ? markdownTableCells(line) : []
    if (cells[0] !== undefined && machineFields.has(cells[0])) continue
    for (const claim of claimPatterns) {
      claim.regex.lastIndex = 0
      for (const match of line.matchAll(claim.regex)) {
        const actual = Number(match[1])
        if (actual !== claim.expected) {
          issues.push({
            severity: 'ERROR',
            code: 'SYSTEM_RELATION_METRIC_MISMATCH',
            message: `${claim.label} is ${actual} in the document at line ${lineIndex + 1}, but relations.json requires ${claim.expected}.`,
          })
        }
      }
    }
  }

  const internalSection = markdownSection(content, '## 9. 系统内部跨项目关系与调用边界')
  const internalStrengthClaims: Array<{ label: string, expected: number, regex: RegExp }> = [
    { label: '内部 DIRECT_SOURCE', expected: expected.internalDirect, regex: /(\d+)\s*条\s*DIRECT_SOURCE\b/gu },
    { label: '内部 CONFIGURATION', expected: expected.internalConfiguration, regex: /(\d+)\s*条\s*CONFIGURATION\b/gu },
    { label: '内部 NAME_MATCH', expected: expected.internalNameMatch, regex: /(\d+)\s*条\s*NAME_MATCH\b/gu },
  ]
  for (const claim of internalStrengthClaims) {
    for (const match of internalSection.matchAll(claim.regex)) {
      if (Number(match[1]) !== claim.expected) {
        issues.push({
          severity: 'ERROR',
          code: 'SYSTEM_RELATION_METRIC_MISMATCH',
          message: `${claim.label} is ${match[1]} in section 9, but relations.json requires ${claim.expected}.`,
        })
      }
    }
  }

  const typeCounts = Object.fromEntries((values['关系类型构成'] ?? '').split('；').flatMap(item => {
    const match = /^([A-Z_]+)=(\d+)$/u.exec(item)
    return match?.[1] === undefined ? [] : [[match[1], Number(match[2])]]
  })) as Record<string, number>
  for (const [type, expectedCount] of Object.entries(typeCounts)) {
    const escaped = type.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const patterns = [new RegExp(`(\\d+)\\s*条\\s*${escaped}\\b`, 'gu'), new RegExp(`${escaped}\\s*[=:：]\\s*(\\d+)`, 'gu')]
    for (const line of content.split(/\r?\n/gu)) {
      const cells = /^\|/u.test(line.trim()) ? markdownTableCells(line) : []
      if (cells[0] !== undefined && machineFields.has(cells[0])) continue
      for (const pattern of patterns) {
        for (const match of line.matchAll(pattern)) {
          if (Number(match[1]) !== expectedCount) {
            issues.push({
              severity: 'ERROR',
              code: 'SYSTEM_RELATION_TYPE_METRIC_MISMATCH',
              message: `${type} is ${match[1]} in the document, but relations.json requires ${expectedCount}.`,
            })
          }
        }
      }
    }
  }

  const coverage = markdownSection(content, '## 19. 证据覆盖率摘要')
  const coverageRows = new Map(coverage.split(/\r?\n/gu)
    .filter(line => /^\|/u.test(line.trim()))
    .map(markdownTableCells)
    .filter(cells => cells.length > 1)
    .map(cells => [cells[0] ?? '', cells]))
  const checkCoverageRow = (label: string, expectedValues: number[]) => {
    const cells = coverageRows.get(label)
    const actualValues = cells?.slice(1, 5).map(firstInteger)
    if (actualValues === undefined || actualValues.some((value, index) => value !== expectedValues[index])) {
      issues.push({
        severity: 'ERROR',
        code: 'SYSTEM_RELATION_COVERAGE_MISMATCH',
        message: `${label} coverage must be total/high/medium/low=${expectedValues.join('/')} from relations.json.`,
      })
    }
  }
  checkCoverageRow('内部关系', [expected.internal, expected.internalDirect, expected.internalConfiguration, expected.internalNameMatch])
  checkCoverageRow('外部依赖', [expected.unresolved, expected.unresolvedDirect, expected.unresolvedConfiguration, expected.unresolvedNameMatch])
  return issues
}

export function validateSystemDocument(
  content: string,
  artifactPaths: Iterable<string>,
  pack: LoadedProtocolPack,
  context: SystemDocumentValidationContext = {},
): ValidationIssue[] {
  const contract = parseProtocolContract<SystemDocumentContract>(pack, SYSTEM_DOCUMENT_CONTRACT)
  const layerState = parseProtocolContract<LayerStateContract>(pack, LAYER_STATE_CONTRACT)
  const issues: ValidationIssue[] = []
  const actualHeadings = markdownHeadings(content)
  if (JSON.stringify(actualHeadings) !== JSON.stringify(contract.headings)) {
    issues.push({ severity: 'ERROR', code: 'SYSTEM_HEADINGS_INVALID', message: 'System headings are missing, duplicated, extra, or out of order.' })
  }

  const metadata = metadataValues(content, Object.keys(contract.metadata))
  for (const [key, allowed] of Object.entries(contract.metadata)) {
    const value = metadata[key]
    if (value === undefined) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_METADATA_MISSING', message: `Missing system metadata row: ${key}.` })
    } else if (key === '事实版本') {
      if (!/^(?:PENDING|S\d{4,})$/u.test(value)) {
        issues.push({ severity: 'ERROR', code: 'SYSTEM_METADATA_INVALID', message: `Invalid system fact-base revision: ${value}.` })
      }
    } else if (!allowed.includes(value)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_METADATA_INVALID', message: `Invalid system metadata value for ${key}: ${value}.` })
    }
  }
  if (context.relationMetrics !== undefined) {
    const actual = metadataValues(content, contract.machineRelationFields)
    for (const field of contract.machineRelationFields) {
      const expected = context.relationMetrics[field]
      if (expected === undefined || actual[field] !== expected) {
        issues.push({
          severity: 'ERROR',
          code: 'SYSTEM_RELATION_METRIC_MISMATCH',
          message: `Machine relation field ${field} must equal relations.json (${expected ?? 'MISSING'}).`,
        })
      }
    }
    issues.push(...validateRelationMetricClaims(content, context.relationMetrics))
  }
  if (metadata['下层门禁'] === 'READY') {
    for (const [field, allowed] of Object.entries(layerState.transitions.systemToProject)) {
      if (!allowed.includes(metadata[field] ?? '')) {
        issues.push({ severity: 'ERROR', code: 'SYSTEM_GATE_INCONSISTENT', message: `System-to-project gate rejects ${field}=${metadata[field] ?? 'MISSING'}.` })
      }
    }
  }
  const blockers = activeProjectBlockers(content)
  if (blockers.length > 0) {
    issues.push(metadata['下层门禁'] === 'READY'
      ? { severity: 'ERROR', code: 'SYSTEM_GATE_INCONSISTENT', message: `Project gate is READY while ${blockers.length} active project-level blocker(s) are declared.` }
      : { severity: 'WARNING', code: 'PROJECT_GATE_BLOCKED_BY_DOCUMENT', message: `${blockers.length} active project-level blocker(s) keep the downstream gate BLOCKED.` })
  }

  const presentArtifacts = new Set(artifactPaths)
  for (const required of contract.requiredArtifacts) {
    if (!presentArtifacts.has(required)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_ARTIFACT_MISSING', message: `Missing required system artifact: ${required}.` })
    }
  }
  for (const pattern of contract.forbiddenHeadingPatterns) {
    if (actualHeadings.some(heading => heading.includes(pattern))) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_BOUNDARY_EXCEEDED', message: `System report contains a forbidden deep-dive heading: ${pattern}.` })
    }
  }
  if (content.length > contract.boundaryRules.maxDocumentCharacters) {
    issues.push({
      severity: 'ERROR',
      code: 'SYSTEM_DOCUMENT_TOO_LARGE',
      message: `System report exceeds ${contract.boundaryRules.maxDocumentCharacters} characters; project details must move to evidence artifacts.`,
    })
  }
  issues.push(...validatePortableContent(content))
  if (!content.includes(contract.boundaryRules.requiredDetailPointer)) {
    issues.push({ severity: 'ERROR', code: 'SYSTEM_DETAIL_POINTER_MISSING', message: 'System report must point readers to the raw evidence bundle.' })
  }
  if (!content.includes(contract.boundaryRules.requiredRelationPointer)) {
    issues.push({ severity: 'ERROR', code: 'SYSTEM_RELATION_POINTER_MISSING', message: 'System report must point readers to the complete relation catalog.' })
  }
  for (const [heading, maxRows] of Object.entries(contract.boundaryRules.maxTableRowsBySection)) {
    const rows = markdownTableDataRows(markdownSection(content, heading))
    if (rows > maxRows) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_SECTION_TOO_DETAILED', message: `${heading} contains ${rows} data rows; maximum is ${maxRows}.` })
    }
  }
  const detailPatterns = contract.boundaryRules.forbiddenDetailPatterns.map(item => ({ id: item.id, regex: new RegExp(item.source, item.flags) }))
  for (const heading of contract.boundaryRules.detailSensitiveSections) {
    const section = markdownSection(content, heading)
    for (const pattern of detailPatterns) {
      if (pattern.regex.test(section)) {
        issues.push({ severity: 'ERROR', code: 'SYSTEM_BOUNDARY_EXCEEDED', message: `${pattern.id} leaked project-level detail into ${heading}.` })
      }
    }
  }
  const trustedConclusionRows = markdownTableDataRows(markdownSection(content, '## 14. 当前可信结论'))
  if (trustedConclusionRows < contract.boundaryRules.minTrustedConclusionRows) {
    issues.push({
      severity: 'ERROR',
      code: 'SYSTEM_WORLDVIEW_INCOMPLETE',
      message: `Trustworthy conclusions contain ${trustedConclusionRows} rows; at least ${contract.boundaryRules.minTrustedConclusionRows} cross-project conclusions are required.`,
    })
  }
  for (const questionClass of contract.requiredQuestionClasses) {
    if (!content.includes(`| ${questionClass} |`)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_QUESTION_CLASS_MISSING', message: `Missing graded question class: ${questionClass}.` })
    }
  }
  for (const check of contract.requiredSelfChecks) {
    if (!content.includes(`| ${check} |`)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_SELF_CHECK_MISSING', message: `Missing system self-check: ${check}.` })
    }
  }
  for (const sourceType of contract.requiredEvidenceSourceTypes) {
    if (!content.includes(sourceType)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_EVIDENCE_ARBITRATION_MISSING', message: `Missing evidence source type in arbitration boundary: ${sourceType}.` })
    }
  }
  for (const dimension of contract.qualityDimensions) {
    if (!content.includes(`| ${dimension} |`)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_QUALITY_DIMENSION_MISSING', message: `Missing quality dimension: ${dimension}.` })
    }
  }
  for (const object of contract.evidenceCoverageObjects) {
    if (!content.includes(`| ${object} |`)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_EVIDENCE_COVERAGE_MISSING', message: `Missing evidence coverage row: ${object}.` })
    }
  }

  issues.push(...validateSensitiveContent(content, pack))
  return issues
}
