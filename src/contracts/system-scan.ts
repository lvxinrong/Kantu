export const SYSTEM_SCAN_PROTOCOL = 'archscope/system-scan/v1'
export const SYSTEM_DOCUMENT_PROTOCOL = 'archscope/contract/system-document/v1'

export interface ProtocolRunReference {
  packId: string
  version: string
  digest: string
}

export type SystemScanStatus =
  | 'DISCOVERING'
  | 'INDEXING'
  | 'COLLECTING_EVIDENCE'
  | 'AWAITING_SYNTHESIS'
  | 'SYNTHESIZING'
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
  documentRevision: string
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
  synthesisInputDigest?: string
  synthesisAttempts?: number
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

export type SystemRelationType =
  | 'FEIGN_CLIENT'
  | 'HTTP_ROUTE_FAMILY'
  | 'MAVEN_API_DEPENDENCY'
  | 'SDK_DEPENDENCY'
  | 'MESSAGE_CHANNEL'
  | 'SHARED_DATA_ASSET'
  | 'CONFIGURED_ENDPOINT'
  | 'NAME_MATCH_CANDIDATE'
  | 'OTHER'

export type RelationEvidenceStrength = 'DIRECT_SOURCE' | 'CONFIGURATION' | 'NAME_MATCH'

export interface ProjectRelationCandidate {
  targetAlias: string
  targetProjectKey?: string
  relationType: SystemRelationType
  evidenceStrength: RelationEvidenceStrength
  description: string
  evidencePaths: string[]
  runtimeStatus: 'UNCONFIRMED'
}

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
  relationCandidates?: ProjectRelationCandidate[]
  scopeStatus: EvidenceScopeStatus
  scopeViolations: string[]
  failureReason?: string
}

export interface SystemRelationRecord extends ProjectRelationCandidate {
  relationId: string
  sourceProjectKey: string
  sourceProjectDir: string
  targetProjectDir?: string
  scope: 'INTERNAL' | 'EXTERNAL_OR_UNRESOLVED'
}

export interface SystemRelationCatalog {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  projectCount: number
  projectsWithRelations: number
  totalCount: number
  internalCount: number
  unresolvedCount: number
  records: SystemRelationRecord[]
}

export interface SystemEvidenceBundle {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  records: ProjectSystemEvidence[]
}

export interface SystemSynthesisDraft {
  factBase: string
  diagrams: {
    systemContext: string
    internalRelations: string
    entryOverview: string
  }
}

export interface SystemSynthesisContext {
  runId: string
  protocolDigest: string
  evidenceMode: 'FULL' | 'BOUNDED'
  evidenceBytes: number
  fullEvidenceMaxBytes: number
  relationCount: number
  prompt: string
}

export interface SystemProjectEvidenceContext {
  runId: string
  protocolDigest: string
  projectKeys: string[]
  missingProjectKeys: string[]
  evidenceJson: string
}

export interface SystemSynthesisWriter {
  kind: 'dsh-main-agent'
  sessionId: string
  provider?: string
  model?: string
}

export interface SystemSynthesisRecord {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  runId: string
  documentRevision: string
  previousRevision?: string
  generatedAt: string
  writer: SystemSynthesisWriter
  attempt: number
  protocolDigest: string
  inputDigest: string
  outputDigest: string
}

export interface SystemHistoryRevision {
  revision: string
  previousRevision?: string
  runId: string
  generatedAt: string
  status: SystemScanStatus
  gate: GateStatus
  validation: ValidationStatus
  protocol: ProtocolRunReference
  synthesisAttempt: number
  outputDigest: string
  publishedAsCurrent: boolean
  artifactRoot: string
}

export interface SystemHistoryIndex {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  updatedAt: string
  latestRevision?: string
  currentRevision?: string
  revisions: SystemHistoryRevision[]
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
  documentRevision: string
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

export interface SystemSynthesisCommitResult extends SystemScanResult {
  synthesisAttempt: number
  retryAllowed: boolean
  issues: ValidationIssue[]
}

export interface ArchScopeStatusResult {
  found: boolean
  runId: string
  documentRevision: string
  status: SystemScanStatus | 'NOT_FOUND'
  gate: GateStatus
  validation: ValidationStatus
  projectCount: number
  indexedProjectCount: number
  evidenceProjectCount: number
  scopeViolationCount: number
  outputDirectory: string
}
