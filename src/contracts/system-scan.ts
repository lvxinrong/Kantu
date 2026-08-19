export const SYSTEM_SCAN_PROTOCOL = 'kantu/system-scan/v1'
export const SYSTEM_DOCUMENT_PROTOCOL = 'kantu/contract/system-document/v1'

export interface ProtocolRunReference {
  packId: string
  version: string
  digest: string
}

export type SystemScanStatus =
  | 'DISCOVERING'
  | 'INDEXING'
  | 'COLLECTING_EVIDENCE'
  | 'BUILDING_FACT_BASE'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'BLOCKED'
  | 'FAILED'

export type GateStatus = 'READY' | 'BLOCKED'
export type ValidationStatus = 'PASSED' | 'FAILED' | 'NOT_RUN'

export interface RunTransition {
  status: SystemScanStatus
  at: string
}

export interface SystemScanRunState {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  protocol: ProtocolRunReference
  runId: string
  status: SystemScanStatus
  gate: GateStatus
  validation: ValidationStatus
  startedAt: string
  updatedAt: string
  finishedAt?: string
  workspaceRoot: '.'
  outputDirectory: string
  refresh: boolean
  projectCount: number
  indexedProjectCount: number
  evidenceProjectCount: number
  scopeViolationCount: number
  transitions: RunTransition[]
  error?: string
}

export type ProjectType =
  | 'android-app'
  | 'data-engineering'
  | 'deployment-config'
  | 'dotnet-project'
  | 'flutter-app'
  | 'go-project'
  | 'ios-app'
  | 'java-project'
  | 'node-service'
  | 'python-project'
  | 'react-native-app'
  | 'unknown'
  | 'web-frontend'
  | 'wechat-miniprogram'

export interface ProjectRecord {
  projectKey: string
  projectName: string
  projectDir: string
  gitHead: string | null
  projectType: ProjectType
  classificationEvidence: string[]
  productionStatus: 'UNCONFIRMED'
}

export interface ProjectRegistry {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  workspaceRoot: '.'
  discoveryMaxDepth: number
  projectCount: number
  projects: ProjectRecord[]
  skippedDirectories: SkippedDirectory[]
}

export interface SkippedDirectory {
  path: string
  depth: number
  reason: 'ignored-directory' | 'max-depth-reached' | 'unreadable'
}

export interface IndexRecord {
  projectKey: string
  projectDir: string
  provider: 'codebase-memory-mcp' | 'unavailable'
  status: 'FRESH' | 'FAILED' | 'PENDING'
  reason: string
  mcpProject?: string
  nodeCount?: number
  edgeCount?: number
  indexedAt?: string
}

export interface IndexManifest {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  records: IndexRecord[]
}

export type EvidenceCollectionStatus = 'COLLECTED' | 'FAILED' | 'SKIPPED'
export type EvidenceScopeStatus = 'CLEAN' | 'VIOLATION'

export interface ProjectSystemEvidence {
  projectKey: string
  projectDir: string
  mcpProject?: string
  status: EvidenceCollectionStatus
  projectTypeCandidates: string[]
  entries: string[]
  outboundDependencies: string[]
  dataAssets: string[]
  infrastructure: string[]
  aliases: string[]
  capabilityCandidates: string[]
  evidencePaths: string[]
  conflicts: string[]
  scopeStatus: EvidenceScopeStatus
  scopeViolations: string[]
  failureReason?: string
}

export interface SystemEvidenceBundle {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  records: ProjectSystemEvidence[]
}

export interface SystemScanProgress {
  stage: SystemScanStatus
  message: string
  completed?: number
  total?: number
}

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
}

export interface SystemValidationReport {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  protocol?: ProtocolRunReference
  generatedAt: string
  status: ValidationStatus
  gate: GateStatus
  issues: ValidationIssue[]
}

export interface SystemScanResult {
  runId: string
  status: SystemScanStatus
  gate: GateStatus
  validation: ValidationStatus
  projectCount: number
  indexedProjectCount: number
  evidenceProjectCount: number
  scopeViolationCount: number
  outputDirectory: string
  reused: boolean
}

export interface KantuStatusResult {
  found: boolean
  runId: string
  status: SystemScanStatus | 'NOT_FOUND'
  gate: GateStatus
  validation: ValidationStatus
  projectCount: number
  indexedProjectCount: number
  evidenceProjectCount: number
  scopeViolationCount: number
  outputDirectory: string
}
