import type { ValidationIssue } from '../contracts/system-scan.js'
import { parseProtocolContract, type LoadedProtocolPack } from './catalog.js'

const SYSTEM_DOCUMENT_CONTRACT = 'kantu/contract/system-document/v1'
const EVIDENCE_CONTRACT = 'kantu/contract/evidence/v1'
const LAYER_STATE_CONTRACT = 'kantu/contract/layer-state-machine/v1'

interface SystemDocumentContract {
  metadata: Record<string, string[]>
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
    detailSensitiveSections: string[]
    maxTableRowsBySection: Record<string, number>
    forbiddenDetailPatterns: Array<{ id: string, source: string, flags: string }>
    minTrustedConclusionRows: number
  }
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

export function validateSystemDocument(
  content: string,
  artifactPaths: Iterable<string>,
  pack: LoadedProtocolPack,
): ValidationIssue[] {
  const contract = parseProtocolContract<SystemDocumentContract>(pack, SYSTEM_DOCUMENT_CONTRACT)
  const evidence = parseProtocolContract<EvidenceContract>(pack, EVIDENCE_CONTRACT)
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
    } else if (!allowed.includes(value)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_METADATA_INVALID', message: `Invalid system metadata value for ${key}: ${value}.` })
    }
  }
  if (metadata['下层门禁'] === 'READY') {
    for (const [field, allowed] of Object.entries(layerState.transitions.systemToProject)) {
      if (!allowed.includes(metadata[field] ?? '')) {
        issues.push({ severity: 'ERROR', code: 'SYSTEM_GATE_INCONSISTENT', message: `System-to-project gate rejects ${field}=${metadata[field] ?? 'MISSING'}.` })
      }
    }
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
  if (!content.includes(contract.boundaryRules.requiredDetailPointer)) {
    issues.push({ severity: 'ERROR', code: 'SYSTEM_DETAIL_POINTER_MISSING', message: 'System report must point readers to the raw evidence bundle.' })
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

  const skipMarkers = evidence.redaction.skipMarkers.map(marker => marker.toLowerCase())
  const patterns = evidence.redaction.patterns.map(item => ({ id: item.id, regex: new RegExp(item.source, item.flags) }))
  for (const [index, line] of content.split(/\r?\n/gu).entries()) {
    if (skipMarkers.some(marker => line.toLowerCase().includes(marker))) continue
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        issues.push({ severity: 'ERROR', code: 'SENSITIVE_VALUE_DETECTED', message: `${pattern.id} detected at system report line ${index + 1}.` })
      }
    }
  }
  return issues
}
