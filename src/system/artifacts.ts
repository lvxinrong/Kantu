import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  SYSTEM_DOCUMENT_PROTOCOL,
  SYSTEM_SCAN_PROTOCOL,
  type GateStatus,
  type IndexManifest,
  type ProjectRecord,
  type ProjectRegistry,
  type ProjectSystemEvidence,
  type SystemEvidenceBundle,
  type SystemSynthesisDraft,
  type SystemSynthesisRecord,
  type SystemValidationReport,
  type ValidationStatus,
  type ValidationIssue,
} from '../contracts/system-scan.js'
import type { LoadedProtocolPack, ProtocolLock } from '../protocol/catalog.js'
import { activeProjectBlockers, validateSensitiveContent, validateSystemDocument } from '../protocol/validation.js'

function markdownCell(value: string | number | null): string {
  if (value === null || value === '') return '待确认'
  return String(value)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\|/gu, '\\|')
    .replace(/[\r\n]+/gu, ' ')
}

function mermaidLabel(value: string): string {
  return value.replace(/["\[\]{}()]/gu, ' ').replace(/[\r\n]+/gu, ' ').trim() || 'project'
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, file)
}

export async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function createIndexManifest(projects: ProjectRecord[], generatedAt: string): IndexManifest {
  return {
    protocolVersion: SYSTEM_SCAN_PROTOCOL,
    generatedAt,
    records: projects.map(project => ({
      projectKey: project.projectKey,
      projectDir: project.projectDir,
      provider: 'unavailable',
      status: 'PENDING',
      reason: 'No code-intelligence provider result is available.',
    })),
  }
}

export function validateSystemArtifacts(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  generatedAt: string,
  evidence?: SystemEvidenceBundle,
): SystemValidationReport {
  const issues: ValidationIssue[] = []
  const keys = new Set<string>()
  for (const project of registry.projects) {
    if (keys.has(project.projectKey)) {
      issues.push({ severity: 'ERROR', code: 'DUPLICATE_PROJECT_KEY', message: `Duplicate projectKey: ${project.projectKey}` })
    }
    keys.add(project.projectKey)
    if (path.isAbsolute(project.projectDir) || project.projectDir.split('/').includes('..')) {
      issues.push({ severity: 'ERROR', code: 'UNSAFE_PROJECT_PATH', message: `Project path must stay relative: ${project.projectDir}` })
    }
  }
  if (registry.projectCount !== registry.projects.length) {
    issues.push({ severity: 'ERROR', code: 'PROJECT_COUNT_MISMATCH', message: 'projectCount does not match projects.length.' })
  }
  if (registry.projects.length === 0) {
    issues.push({ severity: 'WARNING', code: 'NO_GIT_PROJECTS', message: 'No Git project was discovered within the configured depth.' })
  }
  const indexedKeys = new Set(indexes.records.map(record => record.projectKey))
  if (indexes.records.length !== registry.projects.length) {
    issues.push({ severity: 'ERROR', code: 'INDEX_COUNT_MISMATCH', message: 'Index records must map one-to-one to discovered projects.' })
  }
  if (indexedKeys.size !== indexes.records.length) {
    issues.push({ severity: 'ERROR', code: 'DUPLICATE_INDEX_RECORD', message: 'Each projectKey may have only one index record.' })
  }
  const projectsByKey = new Map(registry.projects.map(project => [project.projectKey, project]))
  for (const record of indexes.records) {
    const project = projectsByKey.get(record.projectKey)
    if (project === undefined) {
      issues.push({ severity: 'ERROR', code: 'UNKNOWN_INDEX_PROJECT', message: `Index record references unknown projectKey: ${record.projectKey}.` })
    } else if (project.projectDir !== record.projectDir) {
      issues.push({ severity: 'ERROR', code: 'INDEX_PATH_MISMATCH', message: `Index path does not match project registry for ${record.projectKey}.` })
    }
  }
  for (const project of registry.projects) {
    if (!indexedKeys.has(project.projectKey)) {
      issues.push({ severity: 'ERROR', code: 'MISSING_INDEX_RECORD', message: `Missing index record for ${project.projectKey}.` })
    }
  }
  const incompleteIndexes = indexes.records.filter(record => record.status !== 'FRESH')
  if (incompleteIndexes.length > 0) {
    issues.push({
      severity: 'WARNING',
      code: 'CODE_INTELLIGENCE_INCOMPLETE',
      message: `${incompleteIndexes.length} project index record(s) are not FRESH.`,
    })
  }
  if (evidence === undefined || evidence.records.length !== registry.projects.length) {
    issues.push({ severity: 'WARNING', code: 'EVIDENCE_COUNT_MISMATCH', message: 'System evidence must map one-to-one to discovered projects.' })
  }
  const evidenceByKey = new Map(evidence?.records.map(record => [record.projectKey, record]) ?? [])
  for (const project of registry.projects) {
    const record = evidenceByKey.get(project.projectKey)
    if (record === undefined) {
      issues.push({ severity: 'WARNING', code: 'MISSING_PROJECT_EVIDENCE', message: `Missing system evidence for ${project.projectKey}.` })
    } else if (record.projectDir !== project.projectDir) {
      issues.push({ severity: 'ERROR', code: 'EVIDENCE_PATH_MISMATCH', message: `Evidence path does not match project registry for ${project.projectKey}.` })
    } else if (record.status !== 'COLLECTED') {
      issues.push({ severity: 'WARNING', code: 'PROJECT_EVIDENCE_INCOMPLETE', message: `System evidence is ${record.status} for ${project.projectKey}.` })
    } else if (record.scopeStatus === 'VIOLATION' || record.scopeViolations.length > 0) {
      issues.push({ severity: 'ERROR', code: 'EVIDENCE_SCOPE_VIOLATION', message: `Evidence worker reported a scope violation for ${project.projectKey}.` })
    }
  }
  issues.push({
    severity: 'WARNING',
    code: 'RUNTIME_EVIDENCE_MISSING',
    message: 'Production boundaries and runtime relationships are unconfirmed.',
  })

  const status = issues.some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED'
  const evidenceComplete = registry.projects.length > 0
    && incompleteIndexes.length === 0
    && evidence?.records.length === registry.projects.length
    && evidence.records.every(record => record.status === 'COLLECTED' && record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0)
  const gate: GateStatus = status === 'PASSED' && evidenceComplete ? 'READY' : 'BLOCKED'
  return { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt, status, gate, issues }
}

const SYSTEM_ARTIFACT_PATHS = [
  'system/00-system-fact-base.md',
  'system/project-registry.json',
  'system/index-manifest.json',
  'system/evidence/index.json',
  'system/protocol-lock.json',
  'system/validation.json',
  'system/synthesis.json',
  'system/diagrams/01-system-context.mmd',
  'system/diagrams/02-internal-relations.mmd',
  'system/diagrams/03-entry-overview.mmd',
]

export interface PreparedSystemArtifacts {
  factBase: string
  validation: SystemValidationReport
  protocolLock: ProtocolLock
}

export interface PreparedSynthesizedSystemArtifacts extends PreparedSystemArtifacts {
  diagrams: SystemSynthesisDraft['diagrams']
}

function replaceMetadataValue(content: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return content.replace(new RegExp(`(^\\|\\s*${escaped}\\s*\\|)\\s*[^|]*\\|`, 'mu'), `$1 ${value} |`)
}

function normalizeSystemMetadata(
  content: string,
  validation: Pick<SystemValidationReport, 'status' | 'gate'>,
  sourceComplete: boolean,
): string {
  let normalized = replaceMetadataValue(content, '协议版本', SYSTEM_DOCUMENT_PROTOCOL)
  normalized = replaceMetadataValue(normalized, '文档状态', validation.status === 'PASSED' && sourceComplete ? '完整' : '草稿')
  normalized = replaceMetadataValue(normalized, '证据状态', sourceComplete ? '源码视角已完成，运行态待确认' : '证据不足')
  normalized = replaceMetadataValue(normalized, '下层门禁', validation.gate)
  normalized = replaceMetadataValue(normalized, '校验状态', validation.status)
  return replaceMetadataValue(normalized, '项目级门禁', validation.gate)
}

function validateSynthesisDiagrams(diagrams: SystemSynthesisDraft['diagrams'], pack: LoadedProtocolPack): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const [name, content] of Object.entries(diagrams)) {
    if (!/^\s*(?:flowchart|graph)\s/iu.test(content)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_DIAGRAM_INVALID', message: `${name} must be Mermaid flowchart source.` })
    }
    if (content.includes('```') || content.length > 50_000) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_DIAGRAM_INVALID', message: `${name} contains a code fence or exceeds 50000 characters.` })
    }
    if (!/(?:实线[^\n]*源码证据|源码证据[^\n]*实线)/u.test(content)
      || !/(?:虚线[^\n]*待确认|待确认[^\n]*虚线)/u.test(content)
      || !/不代表生产运行/u.test(content)) {
      issues.push({ severity: 'ERROR', code: 'SYSTEM_DIAGRAM_LEGEND_MISSING', message: `${name} must explain source-evidence, pending-inference, and production-runtime edge semantics.` })
    }
    issues.push(...validateSensitiveContent(content, pack, `${name} diagram`))
  }
  return issues
}

export function prepareSynthesizedSystemArtifacts(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
  generatedAt: string,
  pack: LoadedProtocolPack,
  draft: SystemSynthesisDraft,
): PreparedSynthesizedSystemArtifacts {
  const initial = validateSystemArtifacts(registry, indexes, generatedAt, evidence)
  const protocol = { packId: pack.lock.packId, version: pack.lock.version, digest: pack.lock.packDigest }
  const sourceComplete = registry.projects.length > 0
    && indexes.records.length === registry.projects.length
    && indexes.records.every(record => record.status === 'FRESH')
    && evidence.records.length === registry.projects.length
    && evidence.records.every(record => record.status === 'COLLECTED' && record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0)
  const semanticGate: GateStatus = initial.gate === 'READY' && activeProjectBlockers(draft.factBase).length === 0 ? 'READY' : 'BLOCKED'
  let factBase = normalizeSystemMetadata(draft.factBase, { status: 'PASSED', gate: semanticGate }, sourceComplete)
  const diagramIssues = validateSynthesisDiagrams(draft.diagrams, pack)
  let documentIssues = validateSystemDocument(factBase, SYSTEM_ARTIFACT_PATHS, pack)
  let issues = [...initial.issues, ...documentIssues, ...diagramIssues]
  let status: ValidationStatus = issues.some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED'
  let gate: GateStatus = status === 'PASSED' ? semanticGate : 'BLOCKED'
  factBase = normalizeSystemMetadata(draft.factBase, { status, gate }, sourceComplete)
  documentIssues = validateSystemDocument(factBase, SYSTEM_ARTIFACT_PATHS, pack)
  issues = [...initial.issues, ...documentIssues, ...diagramIssues]
  status = issues.some(issue => issue.severity === 'ERROR') ? 'FAILED' : 'PASSED'
  gate = status === 'PASSED' ? semanticGate : 'BLOCKED'
  const validation: SystemValidationReport = { ...initial, protocol, status, gate, issues }
  factBase = normalizeSystemMetadata(draft.factBase, validation, sourceComplete)
  return { factBase, diagrams: draft.diagrams, validation, protocolLock: pack.lock }
}

function summarizeText(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`
}

const PROJECT_TYPE_LABELS: Record<ProjectRecord['projectType'], string> = {
  'android-app': 'Android 客户端',
  'data-engineering': '数据工程',
  'deployment-config': '部署与环境配置',
  'dotnet-project': '.NET 工程',
  'flutter-app': 'Flutter 客户端',
  'go-project': 'Go 工程',
  'ios-app': 'iOS 客户端',
  'java-project': 'Java 工程',
  'node-service': 'Node.js 服务',
  'python-project': 'Python 工程',
  'react-native-app': 'React Native 客户端',
  'unknown': '待分类工程',
  'web-frontend': 'Web/H5 前端',
  'wechat-miniprogram': '微信小程序',
}

const SERVER_PROJECT_TYPES = new Set<ProjectRecord['projectType']>([
  'dotnet-project',
  'go-project',
  'java-project',
  'node-service',
  'python-project',
])

interface EntrySurface {
  name: string
  projects: ProjectRecord[]
  rawEvidenceCount: number
  external: boolean
}

interface ThemeDefinition {
  name: string
  pattern: RegExp
}

interface AggregatedTheme {
  name: string
  projects: string[]
  evidenceCount: number
}

const CAPABILITY_THEMES: ThemeDefinition[] = [
  { name: '身份、组织与权限', pattern: /auth|identity|login|permission|rbac|role|organization|认证|登录|权限|角色|组织/iu },
  { name: '销售、客户与商业运营', pattern: /sales|customer|client|merchant|partner|market|order|commerce|销售|客户|商户|伙伴|市场|订单|经营/iu },
  { name: '数据分析、报表与看板', pattern: /analytic|dashboard|report|metric|kpi|statistics|business intelligence|\bbi\b|分析|看板|报表|指标|统计|绩效/iu },
  { name: '消息、通知与事件', pattern: /message|notification|notify|push|event|alert|sms|email|消息|通知|推送|事件|告警|短信|邮件/iu },
  { name: '任务、流程与审批', pattern: /task|workflow|approval|schedule|job|任务|流程|审批|调度|作业/iu },
  { name: '内容、文件与导入导出', pattern: /content|file|document|upload|download|import|export|内容|文件|文档|上传|下载|导入|导出/iu },
  { name: '地图、位置与轨迹', pattern: /\bmap\b|location|geograph|positioning|track|trajectory|地图|位置|定位|轨迹/iu },
  { name: '人力、招聘与人才', pattern: /human resource|\bhr\b|recruit|talent|candidate|人力|人事|招聘|人才|候选人/iu },
  { name: '智能化与 AI', pattern: /\bai\b|artificial intelligence|machine learning|recommend|智能|机器学习|推荐/iu },
  { name: '开放平台与第三方集成', pattern: /integration|open platform|third.party|webhook|外部|开放平台|第三方|集成/iu },
  { name: '数据加工与同步', pattern: /data fusion|etl|pipeline|sync|stream|batch|数据融合|数据加工|同步|批处理|流处理/iu },
]

const INFRASTRUCTURE_THEMES: ThemeDefinition[] = [
  { name: '服务发现与配置中心', pattern: /nacos|consul|etcd|zookeeper|service discovery|config center|配置中心|注册中心|服务发现/iu },
  { name: '关系型数据库', pattern: /mysql|postgres|postgresql|sql server|mssql|oracle|mariadb|jdbc|关系数据库/iu },
  { name: '缓存与分布式状态', pattern: /redis|redisson|memcached|cache|缓存|分布式锁/iu },
  { name: '消息队列与事件流', pattern: /kafka|rabbitmq|rocketmq|pulsar|activemq|message queue|消息队列|事件流/iu },
  { name: '对象存储与文件服务', pattern: /\boss\b|\bs3\b|cos|obs|minio|object storage|对象存储/iu },
  { name: '容器与编排', pattern: /docker|kubernetes|\bk8s\b|helm|容器编排/iu },
  { name: '网关、代理与流量入口', pattern: /gateway|zuul|nginx|kong|traefik|proxy|网关|反向代理/iu },
  { name: '任务调度', pattern: /xxl.job|quartz|scheduler|cron|调度|定时任务/iu },
  { name: '可观测性', pattern: /prometheus|grafana|opentelemetry|jaeger|zipkin|sentry|logstash|observability|监控|链路追踪/iu },
  { name: '持续集成与发布', pattern: /jenkins|github actions|gitlab ci|circleci|pipeline|持续集成|持续交付|发布流水线/iu },
]

const DATA_THEMES: ThemeDefinition[] = [
  { name: '关系型表与 Schema', pattern: /table|schema|mysql|postgres|sql server|mssql|oracle|数据库表|数据表|关系型/iu },
  { name: '缓存与会话数据', pattern: /redis|cache|session|缓存|会话/iu },
  { name: '消息与事件数据', pattern: /topic|queue|kafka|rabbitmq|rocketmq|event|消息|事件/iu },
  { name: '文件与对象数据', pattern: /file|document|object storage|\boss\b|\bs3\b|cos|文件|文档|对象存储/iu },
  { name: '搜索与索引数据', pattern: /elasticsearch|opensearch|solr|search index|搜索|索引/iu },
  { name: '分析与数仓数据', pattern: /warehouse|starrocks|doris|clickhouse|hive|metric|数仓|指标|分析数据/iu },
]

const CONFLICT_THEMES: ThemeDefinition[] = [
  { name: '代码图谱覆盖或解析差异', pattern: /图谱|索引|未索引|未收录|解析|route|file_tree|graph/iu },
  { name: '文档与源码不一致', pattern: /readme|文档|说明.*不一致|文档滞后|声明.*代码/iu },
  { name: '配置或运行态证据缺失', pattern: /配置|nacos|运行态|生产|外部化|仓库内无|无法.*核实|不可.*验证/iu },
  { name: '依赖与装配边界不明确', pattern: /依赖|传递引入|装配|feign|client|sdk|jar/iu },
  { name: '命名、版本或归属漂移', pattern: /命名|版本|别名|归属|不一致|漂移|历史|遗留/iu },
  { name: '疑似实现异常（下沉项目级复核）', pattern: /疑似|缺陷|错误|不可用|未实现|注释|硬编码|incomplete|placeholder/iu },
]

function projectRows(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  if (projects.length === 0) return '| 当前未发现 Git 工程 | 待确认 | 待分类工程 | UNCONFIRMED | 无 | 运行态待确认 |'
  const records = evidence === undefined ? new Map<string, ProjectSystemEvidence>() : collectedRecordMap(evidence)
  return projects.map(project => `| ${markdownCell(project.projectDir)} | ${markdownCell(project.projectKey)} | ${PROJECT_TYPE_LABELS[effectiveProjectType(project, records.get(project.projectKey))]} | ${project.productionStatus} | ${markdownCell(project.classificationEvidence.slice(0, 3).join(', '))} | 仅确认工程形态，生产归属待确认 |`).join('\n')
}

function collectedRecordMap(evidence: SystemEvidenceBundle): Map<string, ProjectSystemEvidence> {
  return new Map(evidence.records.filter(record => record.status === 'COLLECTED').map(record => [record.projectKey, record]))
}

function effectiveProjectType(project: ProjectRecord, record?: ProjectSystemEvidence): ProjectRecord['projectType'] {
  if (project.projectType !== 'java-project' && project.projectType !== 'unknown') return project.projectType
  const primary = record?.projectTypeCandidates[0] ?? ''
  if (/^(?:原生\s*)?android\b|android (?:application|app|client)|android 应用/iu.test(primary)) return 'android-app'
  if (/^ios\b|ios (?:application|app|client)|xcode target|objective-c 为主|苹果客户端/iu.test(primary)) return 'ios-app'
  if (/^flutter\b|flutter (?:application|app|client)/iu.test(primary)) return 'flutter-app'
  if (/^react native\b|react-native (?:application|app|client)/iu.test(primary)) return 'react-native-app'
  if (project.projectType === 'unknown' && /微信小程序|wechat miniprogram|mini.program/iu.test(primary)) return 'wechat-miniprogram'
  if (project.projectType === 'unknown' && /\bh5\b|web.*frontend|前端|single.page|\bspa\b|vue|react|uni-app|静态 html/iu.test(primary)) return 'web-frontend'
  if (project.projectType === 'unknown' && /data engineering|etl|数据工程/iu.test(primary)) return 'data-engineering'
  return project.projectType
}

function entrySurfaces(registry: Pick<ProjectRegistry, 'projects'>, evidence: SystemEvidenceBundle): EntrySurface[] {
  const records = collectedRecordMap(evidence)
  const definitions: Array<{ name: string, types: Set<ProjectRecord['projectType']>, external: boolean }> = [
    { name: '移动客户端', types: new Set(['android-app', 'ios-app', 'flutter-app', 'react-native-app']), external: true },
    { name: '微信小程序', types: new Set(['wechat-miniprogram']), external: true },
    { name: 'Web/H5 前端', types: new Set(['web-frontend']), external: true },
    { name: '服务/API 边界', types: SERVER_PROJECT_TYPES, external: false },
    { name: '数据与自动化入口', types: new Set(['data-engineering']), external: false },
    { name: '部署与运维入口', types: new Set(['deployment-config']), external: false },
  ]
  return definitions.flatMap(definition => {
    const projects = registry.projects.filter(project => {
      const record = records.get(project.projectKey)
      if (!definition.types.has(effectiveProjectType(project, record))) return false
      return definition.external || (record?.entries.length ?? 0) > 0
    })
    if (projects.length === 0) return []
    return [{
      name: definition.name,
      projects,
      rawEvidenceCount: projects.reduce((count, project) => count + (records.get(project.projectKey)?.entries.length ?? 0), 0),
      external: definition.external,
    }]
  })
}

function aggregateThemes(
  evidence: SystemEvidenceBundle,
  select: (record: ProjectSystemEvidence) => string[],
  definitions: ThemeDefinition[],
  includeNegative = false,
): AggregatedTheme[] {
  const themes = new Map(definitions.map(definition => [definition.name, { name: definition.name, projects: new Set<string>(), evidenceCount: 0 }]))
  for (const record of evidence.records.filter(item => item.status === 'COLLECTED')) {
    for (const item of select(record)) {
      if (!includeNegative && /\b(?:no|without|absent|missing|disabled)\b|未发现|不存在|缺失|未使用|未启用|禁用|没有/iu.test(item)) continue
      for (const definition of definitions) {
        if (!definition.pattern.test(item)) continue
        const theme = themes.get(definition.name)
        if (theme === undefined) continue
        theme.projects.add(record.projectDir)
        theme.evidenceCount += 1
      }
    }
  }
  return [...themes.values()]
    .filter(theme => theme.evidenceCount > 0)
    .map(theme => ({ ...theme, projects: [...theme.projects].sort((left, right) => left.localeCompare(right)) }))
    .sort((left, right) => right.projects.length - left.projects.length || right.evidenceCount - left.evidenceCount || left.name.localeCompare(right.name))
}

function formatProjectList(projects: string[], max = 8): string {
  const displayed = projects.slice(0, max)
  return `${displayed.join('、')}${projects.length > displayed.length ? ` 等 ${projects.length} 个工程` : ''}`
}

function projectTypeDistribution(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const counts = new Map<string, number>()
  const records = evidence === undefined ? new Map<string, ProjectSystemEvidence>() : collectedRecordMap(evidence)
  for (const project of projects) {
    const label = PROJECT_TYPE_LABELS[effectiveProjectType(project, records.get(project.projectKey))]
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label, count]) => `${label} ${count}`)
    .join('、') || '暂无工程'
}

function aggregateConflictThemes(evidence: SystemEvidenceBundle): AggregatedTheme[] {
  const matched = aggregateThemes(evidence, record => record.conflicts, CONFLICT_THEMES, true)
  const matchedCount = new Set<string>()
  for (const record of evidence.records) {
    for (const [index, item] of record.conflicts.entries()) {
      if (CONFLICT_THEMES.some(theme => theme.pattern.test(item))) matchedCount.add(`${record.projectKey}\u0000${index}`)
    }
  }
  const total = evidence.records.reduce((count, record) => count + record.conflicts.length, 0)
  if (matchedCount.size < total) {
    const projects = evidence.records.filter(record => record.conflicts.some(item => !CONFLICT_THEMES.some(theme => theme.pattern.test(item)))).map(record => record.projectDir)
    matched.push({ name: '其他工程级不确定项', projects: [...new Set(projects)].sort(), evidenceCount: total - matchedCount.size })
  }
  return matched.sort((left, right) => right.evidenceCount - left.evidenceCount || left.name.localeCompare(right.name))
}

interface DependencyRelation {
  caller: string
  target: string
  evidence: string
  internal: boolean
}

function dependencyRelations(registry: Pick<ProjectRegistry, 'projects'>, evidence: SystemEvidenceBundle): DependencyRelation[] {
  const genericNames = new Set(['api', 'backend', 'base', 'common', 'dashboard', 'frontend', 'mobile', 'root', 'service', 'system', 'web'])
  const raw = evidence.records.flatMap(record => record.outboundDependencies.map(item => {
    const normalized = item.toLowerCase()
    const target = registry.projects.find(project => {
      if (project.projectKey === record.projectKey) return false
      const identifiers = new Set([
        project.projectKey.toLowerCase(),
        project.projectDir.toLowerCase(),
        project.projectName.toLowerCase(),
      ])
      return [...identifiers].some(identifier => identifier.length >= 4 && !genericNames.has(identifier) && normalized.includes(identifier))
    })
    return {
      caller: record.projectDir,
      target: target?.projectDir ?? '系统外部或归属待确认',
      evidence: item,
      internal: target !== undefined,
    }
  }))
  const grouped = new Map<string, DependencyRelation>()
  for (const relation of raw) {
    const key = relation.internal
      ? `${relation.caller}\u0000${relation.target}`
      : `${relation.caller}\u0000${summarizeText(relation.evidence, 120).toLowerCase()}`
    const current = grouped.get(key)
    if (current === undefined) {
      grouped.set(key, { ...relation, evidence: summarizeText(relation.evidence) })
    } else if (relation.internal && !current.evidence.includes(summarizeText(relation.evidence, 100))) {
      current.evidence = summarizeText(`${current.evidence}；${relation.evidence}`, 420)
    }
  }
  return [...grouped.values()]
}

export function renderSystemFactBase(
  registry: ProjectRegistry,
  indexes: IndexManifest,
  evidence: SystemEvidenceBundle,
  validation: SystemValidationReport,
): string {
  const collected = evidence.records.filter(record => record.status === 'COLLECTED')
  const freshIndexes = indexes.records.filter(record => record.status === 'FRESH')
  const complete = validation.status === 'PASSED' && validation.gate === 'READY'
  const sourceComplete = registry.projects.length > 0
    && freshIndexes.length === registry.projects.length
    && collected.length === registry.projects.length
    && collected.every(record => record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0)
  const rawEntries = collected.reduce((count, record) => count + record.entries.length, 0)
  const rawCapabilities = collected.reduce((count, record) => count + record.capabilityCandidates.length, 0)
  const rawDataAssets = collected.reduce((count, record) => count + record.dataAssets.length, 0)
  const relations = dependencyRelations(registry, evidence)
  const internalRelations = relations.filter(relation => relation.internal)
  const externalRelations = relations.filter(relation => !relation.internal)
  const totalConflicts = collected.reduce((count, record) => count + record.conflicts.length, 0)
  const surfaces = entrySurfaces(registry, evidence)
  const externalSurfaces = surfaces.filter(surface => surface.external)
  const serviceSurfaces = surfaces.filter(surface => !surface.external)
  const externalEntryProjects = new Set(externalSurfaces.flatMap(surface => surface.projects.map(project => project.projectKey)))
  const capabilityThemes = aggregateThemes(evidence, record => record.capabilityCandidates, CAPABILITY_THEMES).slice(0, 12)
  const infrastructureThemes = aggregateThemes(evidence, record => record.infrastructure, INFRASTRUCTURE_THEMES).slice(0, 10)
  const dataThemes = aggregateThemes(evidence, record => record.dataAssets, DATA_THEMES).slice(0, 8)
  const conflictThemes = aggregateConflictThemes(evidence).slice(0, 7)
  const relationDegree = new Map<string, number>()
  for (const relation of internalRelations) {
    relationDegree.set(relation.caller, (relationDegree.get(relation.caller) ?? 0) + 1)
    relationDegree.set(relation.target, (relationDegree.get(relation.target) ?? 0) + 1)
  }
  const relationHubs = [...relationDegree.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
  const externalByCaller = new Map<string, number>()
  for (const relation of externalRelations) externalByCaller.set(relation.caller, (externalByCaller.get(relation.caller) ?? 0) + 1)
  const displayedExternalCallers = [...externalByCaller.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12)
  const aliasRecords = collected.filter(record => record.aliases.length > 0).slice(0, 15)
  const recordsByKey = collectedRecordMap(evidence)
  const registryValid = registry.projectCount === registry.projects.length
    && new Set(registry.projects.map(project => project.projectKey)).size === registry.projects.length
    && registry.projects.every(project => !path.isAbsolute(project.projectDir) && !project.projectDir.split('/').includes('..'))
  const redactionPassed = !validation.issues.some(issue => issue.code === 'SENSITIVE_VALUE_DETECTED')
  const semanticBoundaryPassed = !validation.issues.some(issue => issue.code === 'SYSTEM_BOUNDARY_EXCEEDED'
    || issue.code === 'SYSTEM_DOCUMENT_TOO_LARGE' || issue.code === 'SYSTEM_SECTION_TOO_DETAILED')
  const coverageScore = registry.projects.length === 0 ? 0 : complete ? 5 : Math.max(1, Math.floor(5 * collected.length / registry.projects.length))
  const entryScore = externalEntryProjects.size === 0 ? 0 : complete ? 3 : 1
  const relationScore = relations.length === 0 ? 0 : complete ? 3 : 1
  const externalScore = externalRelations.length === 0 ? 0 : complete ? 3 : 1
  const dataScore = dataThemes.length === 0 ? 0 : complete ? 3 : 1
  const indexStatuses = ['FRESH', 'PENDING', 'FAILED'].map(status => ({ status, count: indexes.records.filter(record => record.status === status).length }))
  const highPriority = new Set([
    ...externalEntryProjects,
    ...relationHubs.map(([projectDir]) => registry.projects.find(project => project.projectDir === projectDir)?.projectKey).filter((key): key is string => key !== undefined),
  ])
  return `# 00-系统级事实底座

> 系统级定世界观，项目级定工程画像，模块级定内部边界，代码级定具体链路。

模块分析横向梳理能力与职责，代码分析纵向追踪真实执行路径。

## 0. 文档边界说明

本文件由 ArchScope 系统级扫描生成，目标是建立跨工程的系统世界观，而不是拼接工程画像。扫描已执行真实 Git 工程发现、独立代码智能索引和按工程隔离的只读证据采集。源码存在不代表生产启用；生产边界、生产入口、实际调用和数据归属仍需运行态材料或人工确认。主文档只保留跨工程聚合结论；${rawEntries} 条原始入口证据、${rawCapabilities} 条原始能力证据、${rawDataAssets} 条原始数据证据及全部冲突完整保存在 system/evidence/index.json 与 system/evidence/<projectKey>.json。

| 契约字段 | 值 | 说明 |
|---|---|---|
| 协议版本 | ${SYSTEM_DOCUMENT_PROTOCOL} | 固定值 |
| 扫描协议 | ${SYSTEM_SCAN_PROTOCOL} | ArchScope 运行协议 |
| 工程发现最大深度 | ${registry.discoveryMaxDepth} | Git 根在该深度内被发现 |
| 文档状态 | ${complete ? '完整' : '草稿'} | ${complete ? '源码视角系统事实已综合' : '索引、证据或校验仍有阻断项'} |
| 证据状态 | ${sourceComplete ? '源码视角已完成，运行态待确认' : '证据不足'} | 代码图谱与安全元数据证据不替代运行态确认 |
| 下层门禁 | ${validation.gate} | ${validation.gate === 'READY' ? '允许用户主动进入项目级分析' : '不允许进入项目级正式分析'} |
| 校验状态 | ${validation.status} | 同时校验结构、证据覆盖、语义边界、门禁与脱敏 |
| 输出目录 | ${markdownCell(path.dirname('system/00-system-fact-base.md'))} | 相对于 ArchScope 输出根目录 |

## 1. 当前目录性质

发现 ${registry.projectCount} 个真实 Git 工程。当前工作区性质为 ${registry.projectCount > 1 ? '多仓聚合目录' : registry.projectCount === 1 ? '单仓或单工程目录' : '待确认'}；${freshIndexes.length} 个工程具有可用代码智能索引，${collected.length} 个工程完成系统级证据采集。

## 2. 代码智能索引清单摘要

| 状态 | 工程数 | 说明 |
|---|---:|---|
${indexes.records.length === 0 ? '| PENDING | 0 | 当前无工程 |' : indexStatuses.map(item => `| ${item.status} | ${item.count} | ${item.status === 'FRESH' ? '可用于源码视角证据采集' : '详见 system/index-manifest.json'} |`).join('\n')}

索引与工程的一对一明细保存在 system/index-manifest.json；主文档不重复列出每个 provider 标识。

## 3. 工程清单与归属

| 工程目录 | projectKey | 工程类型 | 生产状态 | 分类证据 | 可信边界 |
|---|---|---|---|---|---|
${projectRows(registry.projects, evidence)}

## 4. 生产服务边界

当前未接入部署清单、注册中心导出或人工确认，所有工程生产状态均为待确认。代码图谱证据不得升级为生产事实。

## 5. 系统入口

系统入口按用户可感知的入口形态聚合。Controller、路由、main 函数和消息消费者属于工程内部入口证据，不直接等同于系统入口，完整明细已下沉到 evidence JSON。

| 入口类别 | 候选承载工程 | 工程数 | 判断依据 | 运行态状态 |
|---|---|---|---|---|
${externalSurfaces.length === 0 ? '| 待确认 | 当前未形成用户入口候选 | 0 | 工程类型与源码入口证据不足 | 待确认 |' : externalSurfaces.map(surface => `| ${surface.name} | ${markdownCell(formatProjectList(surface.projects.map(project => project.projectDir)))} | ${surface.projects.length} | 工程类型 + ${surface.rawEvidenceCount} 条工程入口证据 | 运行态待确认 |`).join('\n')}

服务端、数据任务与运维入口不计入用户入口数量；其候选边界为：${serviceSurfaces.length === 0 ? '待确认' : serviceSurfaces.map(surface => `${surface.name} ${surface.projects.length} 个工程`).join('、')}。

## 6. 基础设施事实

| 基础设施类别 | 涉及工程 | 工程数 | 原始证据数 | 运行态状态 |
|---|---|---:|---:|---|
${infrastructureThemes.length === 0 ? '| 待确认 | 当前未形成跨工程基础设施候选 | 0 | 0 | 待确认 |' : infrastructureThemes.map(theme => `| ${theme.name} | ${markdownCell(formatProjectList(theme.projects))} | ${theme.projects.length} | ${theme.evidenceCount} | 运行态待确认 |`).join('\n')}

## 7. 入口链路概览

| 链路阶段 | 源码视角候选 | 可信边界 |
|---|---|---|
| 外部用户入口 | ${externalSurfaces.length === 0 ? '待确认' : externalSurfaces.map(surface => `${surface.name}（${surface.projects.length}）`).join('、')} | 仅确认承载工程形态 |
| 服务/API 边界 | ${serviceSurfaces.length === 0 ? '待确认' : serviceSurfaces.map(surface => `${surface.name}（${surface.projects.length}）`).join('、')} | 不把 Controller 或方法清单上卷为系统入口 |
| 跨工程连接 | ${internalRelations.length} 条源码候选 | 名称匹配需要项目级或运行态复核 |
| 数据与基础设施 | ${dataThemes.length} 类数据候选、${infrastructureThemes.length} 类基础设施候选 | 实例、拓扑与归属待运行态确认 |

## 8. 系统能力地图（技术视角）

| 能力域候选 | 相关工程 | 工程数 | 原始证据数 | 可信边界 |
|---|---|---:|---:|---|
${capabilityThemes.length === 0 ? '| 待确认 | 当前能力证据尚不能形成跨工程主题 | 0 | 0 | 留待项目级画像补全 |' : capabilityThemes.map(theme => `| ${theme.name} | ${markdownCell(formatProjectList(theme.projects))} | ${theme.projects.length} | ${theme.evidenceCount} | 源码主题聚合，业务边界待确认 |`).join('\n')}

## 9. 系统内部跨项目关系与调用边界

| 调用方 | 被调用方候选 | 关系类型 | 源码证据 | 生产运行证据 | 待确认 |
|---|---|---|---|---|---|
${internalRelations.length === 0 ? '| 待确认 | 待确认 | 当前未发现 | 当前未发现稳定跨工程证据 | 待确认 | 需要项目级或运行态复核 |' : internalRelations.slice(0, 20).map(relation => `| ${markdownCell(relation.caller)} | ${markdownCell(relation.target)} | 出站依赖名称匹配 | 完整证据见对应工程 evidence JSON | 待确认 | 名称匹配仅为技术推测 |`).join('\n')}

## 10. 外部系统与第三方依赖

| 调用方工程 | 出站依赖候选数 | 系统边界判断 | 证据位置 | 是否生产依赖 | 待确认 |
|---|---|---|---|---|---|
${displayedExternalCallers.length === 0 ? '| 待确认 | 0 | 当前未形成稳定外部依赖候选 | system/evidence/index.json | 待确认 | 待确认 |' : displayedExternalCallers.map(([caller, count]) => `| ${markdownCell(caller)} | ${count} | 未匹配到工作区工程，暂列系统外部或归属待确认 | system/evidence/${markdownCell(registry.projects.find(project => project.projectDir === caller)?.projectKey ?? caller)}.json | 待确认 | 需结合服务目录或运行态确认归属 |`).join('\n')}

## 11. 数据资产与归属边界

| 数据资产类别 | 涉及工程 | 工程数 | 原始证据数 | 归属边界 |
|---|---|---:|---:|---|
${dataThemes.length === 0 ? '| 待确认 | 当前未形成稳定数据资产类别 | 0 | 0 | 待确认 |' : dataThemes.map(theme => `| ${theme.name} | ${markdownCell(formatProjectList(theme.projects))} | ${theme.projects.length} | ${theme.evidenceCount} | 写入方、读取方与生产实例待确认 |`).join('\n')}

## 12. 废弃、历史与旁支工程

当前没有人工确认材料，不能仅凭仓库名称判定废弃、历史或旁支工程；所有工程状态待确认。

## 13. 术语表

| 标准名称 | 类型 | 对应工程 | 说明 |
|---|---|---|---|
${aliasRecords.length === 0 ? '| 待确认 | 工程 | 待确认 | 暂以仓库目录名作为标准名称 |' : aliasRecords.map(record => `| ${markdownCell(registry.projects.find(project => project.projectKey === record.projectKey)?.projectName ?? record.projectDir)} | 工程 | ${markdownCell(record.projectDir)} | 收集到 ${record.aliases.length} 条别名候选，完整内容见 evidence JSON |`).join('\n')}

## 14. 当前可信结论

| 可信结论 | 证据 | 可信边界 |
|---|---|---|
| 当前工作区是${registry.projectCount > 1 ? '多仓聚合系统' : registry.projectCount === 1 ? '单仓或单工程系统' : '尚未发现工程的工作区'}，最大深度 ${registry.discoveryMaxDepth} 内发现 ${registry.projectCount} 个 Git 工程 | 工程注册表与 Git 根发现 | 只描述扫描范围，不代表生产系统边界 |
| 工程形态分布：${markdownCell(projectTypeDistribution(registry.projects, evidence))} | 构建标记与工程分类 | 工程类型不等于业务归属 |
| 用户入口形态候选覆盖 ${externalEntryProjects.size} 个工程：${externalSurfaces.length === 0 ? '待确认' : externalSurfaces.map(surface => surface.name).join('、')} | 工程类型与入口证据聚合 | 实际生产入口、域名和流量待确认 |
| 形成 ${capabilityThemes.length} 个跨工程能力主题候选：${capabilityThemes.length === 0 ? '待确认' : capabilityThemes.slice(0, 6).map(theme => theme.name).join('、')} | ${rawCapabilities} 条工程能力证据聚合 | 业务边界与能力归属待人工确认 |
| 形成 ${internalRelations.length} 条跨工程依赖候选${relationHubs.length === 0 ? '' : `；关系中心候选为 ${relationHubs.map(([name, degree]) => `${name}（${degree}）`).join('、')}`} | 出站依赖与工作区工程名匹配 | 不是运行态调用链，需项目级或运行态复核 |
| 共享基础设施候选包括：${infrastructureThemes.length === 0 ? '待确认' : infrastructureThemes.slice(0, 6).map(theme => theme.name).join('、')} | 工程配置与代码图谱聚合 | 实例地址、环境、拓扑和生产启用均待确认 |
| ${freshIndexes.length}/${registry.projectCount} 个工程索引可用，${collected.length}/${registry.projectCount} 个工程完成只读取证 | index-manifest 与 evidence bundle | 表示源码覆盖，不表示生产架构已验证 |

## 15. 冲突与待复核结论

共记录 ${totalConflicts} 条原始冲突或不确定项。主文档只展示跨工程冲突类别，具体代码、配置和实现问题全部下沉到 evidence JSON，留待项目级分析复核。

${conflictThemes.length === 0 ? '当前证据 worker 未返回显式冲突；缺少运行态材料仍构成证据边界。' : `| 冲突类别 | 涉及工程 | 原始记录数 | 处理方式 |\n|---|---|---:|---|\n${conflictThemes.map(theme => `| ${theme.name} | ${markdownCell(formatProjectList(theme.projects))} | ${theme.evidenceCount} | 下沉项目级或运行态复核 |`).join('\n')}`}

## 16. 关键待确认问题分级

| 问题 | 分级 | 影响范围 | 建议确认方式 |
|---|---|---|---|
| ${validation.gate === 'READY' ? '当前无源码视角阻断项' : '索引、证据或契约校验尚未完整'} | 阻断项目级 | 全部工程 | 查看 validation.json 与 evidence/index.json |
| 生产边界没有运行态证据 | 影响生产边界 | 全系统 | 提供部署清单、服务注册导出或人工确认 |
| ${externalEntryProjects.size === 0 ? '系统入口尚未形成稳定候选' : '入口形态候选尚未获得生产确认'} | 影响入口链路 | 全系统 | 提供入口清单、网关配置或运行态流量证据 |
| ${dataThemes.length === 0 ? '数据资产尚未形成稳定候选' : '数据资产归属尚未获得运行确认'} | 影响数据归属 | 全系统 | 提供结构证据或数据负责人确认 |
| 工程中文名、别名和历史状态待统一 | 可延后 | 术语表 | 由系统维护者补充人工确认 |

## 17. 系统级图表索引

| 图表 | 路径 | 完成状态 |
|---|---|---|
| 系统上下文图 | system/diagrams/01-system-context.mmd | ${complete ? '源码视角已完成，运行态待确认' : '草稿，待确认'} |
| 内部工程关系图 | system/diagrams/02-internal-relations.mmd | ${internalRelations.length > 0 ? '源码候选，运行态待确认' : '草稿，待确认'} |
| 入口链路概览图 | system/diagrams/03-entry-overview.mmd | ${externalEntryProjects.size > 0 ? '源码候选，运行态待确认' : '草稿，待确认'} |

## 18. 事实底座质量评分

| 维度 | 分数 | 依据 | 主要缺口 |
|---|---:|---|---|
| 工程覆盖 | ${coverageScore}/5 | Git 根、独立索引与工程证据覆盖 | 最大深度外目录和非 Git 工程不纳入 |
| 生产边界可信度 | 0/5 | 无运行态材料 | 全部待确认 |
| 入口链路可信度 | ${entryScore}/5 | ${externalEntryProjects.size} 个用户入口承载工程，原始工程入口证据已下沉 | 生产链路待确认 |
| 内部关系可信度 | ${relationScore}/5 | ${internalRelations.length} 条跨工程候选 | 名称匹配与生产调用待复核 |
| 外部依赖可信度 | ${externalScore}/5 | ${externalRelations.length} 条外部或归属待确认候选，主文档按 ${displayedExternalCallers.length} 个调用方聚合 | 系统内外边界待复核 |
| 数据归属可信度 | ${dataScore}/5 | ${dataThemes.length} 类数据资产候选、${rawDataAssets} 条原始证据 | 写入方、读取方和归属待确认 |

## 19. 证据覆盖率摘要

| 对象 | 总数 | 高证据 | 中证据 | 低证据 | 待确认 | 阻断项 |
|---|---:|---:|---:|---:|---:|---:|
| 工程 | ${registry.projectCount} | 0 | ${collected.length} | ${registry.projectCount - collected.length} | ${registry.projectCount - collected.length} | ${validation.gate === 'READY' ? 0 : 1} |
| 生产服务 | 0 | 0 | 0 | 0 | 1 | 1 |
| 系统入口 | ${externalEntryProjects.size} | 0 | ${externalEntryProjects.size} | 0 | ${externalEntryProjects.size === 0 ? 1 : externalEntryProjects.size} | 0 |
| 入口链路 | ${externalSurfaces.length} | 0 | ${externalSurfaces.length} | 0 | ${externalSurfaces.length === 0 ? 1 : externalSurfaces.length} | 0 |
| 内部关系 | ${internalRelations.length} | 0 | ${internalRelations.length} | 0 | ${internalRelations.length === 0 ? 1 : internalRelations.length} | 0 |
| 外部依赖 | ${externalRelations.length} | 0 | ${externalRelations.length} | 0 | ${externalRelations.length === 0 ? 1 : externalRelations.length} | 0 |
| 数据资产 | ${rawDataAssets} | 0 | ${rawDataAssets} | 0 | ${rawDataAssets === 0 ? 1 : rawDataAssets} | 0 |

## 20. 系统级产物自检

| 自检项 | 结果 | 说明 |
|---|---|---|
| 工程注册表已生成 | ${registryValid ? '通过' : '不通过'} | system/project-registry.json，${registry.projectCount} 个工程 |
| 每个工程都有索引状态 | ${indexes.records.length === registry.projectCount ? '通过' : '不通过'} | FRESH ${freshIndexes.length} / ${registry.projectCount} |
| 每个工程都有证据状态 | ${evidence.records.length === registry.projectCount ? '通过' : '不通过'} | COLLECTED ${collected.length} / ${registry.projectCount} |
| 证据范围检查 | ${collected.every(record => record.scopeStatus === 'CLEAN' && record.scopeViolations.length === 0) ? '通过' : '不通过'} | 仅统计真实越界，不接收“无违规”说明文本 |
| 关键待确认问题已分级 | 通过 | 阻断项目级、影响生产边界、影响入口链路、影响数据归属、可延后 |
| 证据仲裁已执行 | 通过 | 优先级：运行态、人工确认、部署发布、代码图谱、源码、历史文档；冲突保留为冲突待复核 |
| 敏感信息已脱敏 | ${redactionPassed ? '通过' : '不通过'} | ${redactionPassed ? '未检测到账号、凭据、私钥或完整敏感端点' : '检测到疑似敏感值，详见 validation.json'} |
| 源码存在与生产启用已区分 | 通过 | 未生成生产启用断言 |
| 系统级边界未越界 | ${semanticBoundaryPassed ? '通过' : '不通过'} | 主文档只保留入口形态、跨工程主题、关系摘要与冲突类别；工程细节下沉 evidence JSON |
| 项目级门禁 | ${validation.gate === 'READY' ? '放行' : '阻断'} | ${validation.gate === 'READY' ? '源码视角系统事实已完成；仍需用户主动触发' : '索引、证据或校验存在阻断项'} |

## 21. 后续分析任务拆分

| 分析对象 | 层级 | 工程类型 | 建议优先级 | 优先原因 | 是否可并行 | 前置依赖 | 输出文档 |
|---|---|---|---|---|---|---|---|
${registry.projects.length === 0 ? '| 待确认 | 项目级 | unknown | 待确认 | 未发现工程 | 否 | 系统级门禁 | 待确认 |' : registry.projects.map(project => {
    const priority = highPriority.has(project.projectKey) ? '高' : SERVER_PROJECT_TYPES.has(effectiveProjectType(project, recordsByKey.get(project.projectKey))) ? '中' : '低'
    const reason = externalEntryProjects.has(project.projectKey) ? '用户入口承载工程' : relationDegree.has(project.projectDir) ? '跨工程关系候选参与方' : '补全工程画像与运行边界'
    return `| ${markdownCell(project.projectDir)} | 项目级 | ${project.projectType} | ${priority} | ${reason} | 是 | 系统级门禁 READY | projects/${markdownCell(project.projectKey)} |`
  }).join('\n')}
`
}

export function renderSystemContextDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const bundle = evidence ?? { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt: '', records: [] }
  const surfaces = entrySurfaces({ projects }, bundle)
  const external = surfaces.filter(surface => surface.external)
  const serviceCount = surfaces.filter(surface => !surface.external).reduce((count, surface) => count + surface.projects.length, 0)
  const capabilities = aggregateThemes(bundle, record => record.capabilityCandidates, CAPABILITY_THEMES)
  const infrastructure = aggregateThemes(bundle, record => record.infrastructure, INFRASTRUCTURE_THEMES)
  const entryNodes = external.length === 0
    ? '    E0["外部入口：待确认"]'
    : external.map((surface, index) => `    E${index}["${mermaidLabel(surface.name)}<br/>${mermaidLabel(formatProjectList(surface.projects.map(project => project.projectDir), 5))}"]`).join('\n')
  const entryEdges = external.length === 0
    ? '  U -. 运行态待确认 .-> E0\n  E0 -. 源码候选 .-> S'
    : external.map((_surface, index) => `  U -. 运行态待确认 .-> E${index}\n  E${index} -. 源码候选 .-> S`).join('\n')
  return `flowchart LR
  L["图例：实线=源码证据；虚线=待确认推断；不代表生产运行"]
  U["用户 / 外部系统"]
  subgraph K["源码视角系统边界 · ${projects.length} 个工程"]
${entryNodes}
    S["服务 / API 边界候选<br/>${serviceCount} 个工程"]
    C["跨工程能力主题<br/>${capabilities.length} 类"]
  end
  I["共享基础设施候选<br/>${infrastructure.slice(0, 5).map(theme => mermaidLabel(theme.name)).join(' / ') || '待确认'}"]
${entryEdges}
  S -. 源码聚合 .-> C
  S -. 运行态待确认 .-> I
`
}

export function renderInternalRelationsDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const relations = evidence === undefined ? [] : dependencyRelations({ projects }, evidence)
    .filter(relation => relation.internal)
    .slice(0, 24)
  const involved = new Set(relations.flatMap(relation => [relation.caller, relation.target]))
  const displayedProjects = projects.filter(project => involved.has(project.projectDir))
  const projectIndex = new Map(displayedProjects.map((project, index) => [project.projectDir, index]))
  const nodes = displayedProjects.map((project, index) => `  P${index}["${mermaidLabel(project.projectDir)}"]`).join('\n')
  const edges = relations.flatMap(relation => {
    const caller = projectIndex.get(relation.caller)
    const target = projectIndex.get(relation.target)
    return caller === undefined || target === undefined ? [] : [`  P${caller} -. 出站依赖名称匹配 .-> P${target}`]
  })
  return `flowchart LR
  L["图例：实线=源码证据；虚线=待确认推断；不代表生产运行"]
${nodes || '  N["工程间关系：当前未发现稳定候选"]'}
${edges.join('\n')}
  B["仅为源码候选 · 运行态待确认"]
`
}

export function renderEntryOverviewDiagram(projects: ProjectRecord[], evidence?: SystemEvidenceBundle): string {
  const bundle = evidence ?? { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt: '', records: [] }
  const surfaces = entrySurfaces({ projects }, bundle)
  const external = surfaces.filter(surface => surface.external)
  const services = surfaces.filter(surface => !surface.external)
  const dataThemes = aggregateThemes(bundle, record => record.dataAssets, DATA_THEMES)
  const entryNodes = external.length === 0
    ? '  E0["用户入口形态：待确认"]'
    : external.map((surface, index) => `  E${index}["${mermaidLabel(surface.name)}<br/>${surface.projects.length} 个承载工程"]`).join('\n')
  const entryEdges = external.length === 0
    ? '  U -. 待确认 .-> E0\n  E0 -. 源码候选 .-> S'
    : external.map((_surface, index) => `  U --> E${index}\n  E${index} -. 源码候选 .-> S`).join('\n')
  return `flowchart LR
  L["图例：实线=源码证据；虚线=待确认推断；不代表生产运行"]
  U["用户 / 外部系统"]
${entryNodes}
  S["服务与 API 边界<br/>${services.reduce((count, surface) => count + surface.projects.length, 0)} 个工程候选"]
  D["数据资产<br/>${dataThemes.length} 类源码候选"]
  R["注册中心 / 网关 / 部署拓扑<br/>运行态待确认"]
${entryEdges}
  S -. 源码候选 .-> D
  S -. 待确认 .-> R
`
}

export interface WriteSystemEvidenceArtifactsOptions {
  outputRoot: string
  registry: ProjectRegistry
  indexes: IndexManifest
  evidence: SystemEvidenceBundle
  protocolLock: ProtocolLock
}

export async function writeSystemEvidenceArtifacts(options: WriteSystemEvidenceArtifactsOptions): Promise<void> {
  const systemRoot = path.join(options.outputRoot, 'system')
  await Promise.all([
    atomicWriteJson(path.join(systemRoot, 'project-registry.json'), options.registry),
    atomicWriteJson(path.join(systemRoot, 'index-manifest.json'), options.indexes),
    atomicWriteJson(path.join(systemRoot, 'evidence', 'index.json'), options.evidence),
    ...options.evidence.records.map(record => atomicWriteJson(path.join(systemRoot, 'evidence', `${record.projectKey}.json`), record)),
    atomicWriteJson(path.join(systemRoot, 'protocol-lock.json'), options.protocolLock),
  ])
}

export interface WriteSynthesizedSystemArtifactsOptions extends WriteSystemEvidenceArtifactsOptions, PreparedSynthesizedSystemArtifacts {
  synthesis: SystemSynthesisRecord
}

export async function writeSynthesizedSystemArtifacts(options: WriteSynthesizedSystemArtifactsOptions): Promise<void> {
  await writeSystemEvidenceArtifacts(options)
  const systemRoot = path.join(options.outputRoot, 'system')
  const attemptRoot = path.join(options.outputRoot, 'runs', options.synthesis.runId, 'synthesis', `attempt-${options.synthesis.attempt}`)
  await Promise.all([
    atomicWriteJson(path.join(systemRoot, 'validation.json'), options.validation),
    atomicWriteJson(path.join(systemRoot, 'synthesis.json'), options.synthesis),
    atomicWrite(path.join(systemRoot, '00-system-fact-base.md'), options.factBase),
    atomicWrite(path.join(systemRoot, 'diagrams', '01-system-context.mmd'), options.diagrams.systemContext),
    atomicWrite(path.join(systemRoot, 'diagrams', '02-internal-relations.mmd'), options.diagrams.internalRelations),
    atomicWrite(path.join(systemRoot, 'diagrams', '03-entry-overview.mmd'), options.diagrams.entryOverview),
    atomicWriteJson(path.join(attemptRoot, 'attempt.json'), { ...options.synthesis, validation: options.validation }),
    atomicWrite(path.join(attemptRoot, '00-system-fact-base.md'), options.factBase),
    atomicWrite(path.join(attemptRoot, 'diagrams', '01-system-context.mmd'), options.diagrams.systemContext),
    atomicWrite(path.join(attemptRoot, 'diagrams', '02-internal-relations.mmd'), options.diagrams.internalRelations),
    atomicWrite(path.join(attemptRoot, 'diagrams', '03-entry-overview.mmd'), options.diagrams.entryOverview),
  ])
}
