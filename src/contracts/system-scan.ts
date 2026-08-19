export const SYSTEM_SCAN_PROTOCOL = 'kantu/system-scan/v1'

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
  provider: 'unconfigured'
  status: 'PENDING'
  reason: string
}

export interface IndexManifest {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
  generatedAt: string
  records: IndexRecord[]
}

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
}

export interface SystemValidationReport {
  protocolVersion: typeof SYSTEM_SCAN_PROTOCOL
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
  outputDirectory: string
}
