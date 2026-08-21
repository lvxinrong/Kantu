import path from 'node:path'

import type { Context } from '@deepseek-ai/cordis'
import { CallId, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'

import type { Config } from '../config.js'
import {
  SYSTEM_SCAN_PROTOCOL,
  type IndexManifest,
  type IndexRecord,
  type ProjectRecord,
  type ProjectRelationCandidate,
  type ProjectSystemEvidence,
  type SystemEvidenceBundle,
  type SystemScanProgress,
} from '../contracts/system-scan.js'
import { collectSafeProjectMetadata } from './project-metadata.js'
import { SYSTEM_RELATION_TYPES } from './relations.js'

type Agent = ToolExecutionInput['agent']

interface SubagentResultLike {
  output: ContentBlock[]
  structured?: unknown
  stopReason: string
}

interface SubagentRunLike {
  result: Promise<SubagentResultLike>
  dispose(): Promise<void>
}

interface SubagentRuntimeLike {
  getProvider(name: string): unknown
  start(name: string, request: unknown): Promise<SubagentRunLike>
}

interface ListedProject {
  name: string
  root_path: string
  nodes?: number
  edges?: number
}

interface AnalyzerOptions {
  workspaceRoot: string
  generatedAt: string
  refresh: boolean
  signal?: AbortSignal
  agent?: Agent
  onProgress?: (progress: SystemScanProgress) => void
}

export interface SystemAnalyzer {
  index(projects: ProjectRecord[], options: AnalyzerOptions): Promise<IndexManifest>
  collectEvidence(projects: ProjectRecord[], indexes: IndexManifest, options: AnalyzerOptions): Promise<SystemEvidenceBundle>
}

const EVIDENCE_FIELDS = [
  'projectTypeCandidates',
  'entries',
  'outboundDependencies',
  'dataAssets',
  'infrastructure',
  'aliases',
  'capabilityCandidates',
  'evidencePaths',
  'conflicts',
] as const

const EVIDENCE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...EVIDENCE_FIELDS, 'relationCandidates', 'scopeStatus', 'scopeViolations'],
  properties: {
    ...Object.fromEntries(EVIDENCE_FIELDS.map(field => [field, {
      type: 'array',
      items: { type: 'string' },
    }])),
    relationCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['targetAlias', 'relationType', 'evidenceStrength', 'description', 'evidencePaths', 'runtimeStatus'],
        properties: {
          targetAlias: { type: 'string' },
          targetProjectKey: { type: 'string' },
          relationType: { type: 'string', enum: [...SYSTEM_RELATION_TYPES] },
          evidenceStrength: { type: 'string', enum: ['DIRECT_SOURCE', 'CONFIGURATION', 'NAME_MATCH'] },
          description: { type: 'string' },
          evidencePaths: { type: 'array', items: { type: 'string' } },
          runtimeStatus: { type: 'string', enum: ['UNCONFIRMED'] },
        },
      },
    },
    scopeStatus: {
      type: 'string',
      enum: ['CLEAN', 'VIOLATION'],
      description: 'CLEAN when no boundary was crossed; VIOLATION only after an actual out-of-scope tool access.',
    },
    scopeViolations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Actual violations only. Return [] when scopeStatus is CLEAN; never place a no-violation explanation here.',
    },
  },
} as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function redact(value: string, maxLength = 800): string {
  return value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*/giu, '<redacted-private-key>')
    .replace(/((?:https?|jdbc:[a-z0-9]+):\/\/)[^/\s:@]+:[^@\s/]+@/giu, '$1<redacted-credentials>@')
    .replace(/((?:api[ _.-]?key|access[ _.-]?key|secret|credential|client[ _.-]?secret|password|passwd|token)\s*[=:]\s*)["']?[^\s,;"'<>]{8,}/giu, '$1<redacted>')
    .replace(/((?:Authorization\s*[:=]\s*|Bearer\s+))[A-Za-z0-9._~+/=-]{8,}/giu, '$1<redacted>')
    .replace(/(<(?:password|passwd|secret|token|accessKey|secretKey)>)[\s\S]*?(<\/[^>]+>)/giu, '$1<redacted>$2')
    .slice(0, maxLength)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => redact(item.trim()))
    .filter(Boolean)
    .slice(0, 100)
}

function relationCandidates(value: unknown, knownProjectKeys: Set<string>): ProjectRelationCandidate[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!isObject(item)
      || typeof item.targetAlias !== 'string'
      || typeof item.relationType !== 'string'
      || !SYSTEM_RELATION_TYPES.includes(item.relationType as never)
      || (item.evidenceStrength !== 'DIRECT_SOURCE' && item.evidenceStrength !== 'CONFIGURATION' && item.evidenceStrength !== 'NAME_MATCH')
      || typeof item.description !== 'string') return []
    const paths = stringArray(item.evidencePaths).slice(0, 20)
    if (paths.length === 0) return []
    const requestedKey = typeof item.targetProjectKey === 'string' && knownProjectKeys.has(item.targetProjectKey)
      ? item.targetProjectKey
      : undefined
    return [{
      targetAlias: redact(item.targetAlias.trim()),
      ...requestedKey === undefined ? {} : { targetProjectKey: requestedKey },
      relationType: item.relationType as ProjectRelationCandidate['relationType'],
      evidenceStrength: item.evidenceStrength as ProjectRelationCandidate['evidenceStrength'],
      description: redact(item.description.trim()),
      evidencePaths: paths,
      runtimeStatus: 'UNCONFIRMED' as const,
    }]
  }).slice(0, 100)
}

function parseJsonText(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function canonicalPayload(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {}
  if (isObject(value.structuredContent)) return value.structuredContent
  if (Array.isArray(value.content)) {
    for (const block of value.content) {
      if (!isObject(block) || block.type !== 'text' || typeof block.text !== 'string') continue
      const parsed = parseJsonText(block.text)
      if (isObject(parsed)) return parsed
    }
  }
  return value
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length)
  let cursor = 0
  async function consume(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor
      cursor += 1
      const value = values[index]
      if (value !== undefined) output[index] = await worker(value, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => consume()))
  return output
}

function skippedEvidence(project: ProjectRecord, index: IndexRecord | undefined, reason: string): ProjectSystemEvidence {
  return {
    projectKey: project.projectKey,
    projectDir: project.projectDir,
    ...index?.mcpProject === undefined ? {} : { mcpProject: index.mcpProject },
    status: 'SKIPPED',
    projectTypeCandidates: [],
    entries: [],
    outboundDependencies: [],
    dataAssets: [],
    infrastructure: [],
    aliases: [],
    capabilityCandidates: [],
    evidencePaths: [],
    conflicts: [],
    relationCandidates: [],
    scopeStatus: 'CLEAN',
    scopeViolations: [],
    failureReason: reason,
  }
}

function shouldReportProgress(completed: number, total: number): boolean {
  if (completed === total) return true
  const interval = Math.max(1, Math.ceil(total / 4))
  return completed % interval === 0
}

export class DshSystemAnalyzer implements SystemAnalyzer {
  private callSequence = 0
  private readonly serverName: string
  private readonly indexMode: 'fast' | 'moderate' | 'full'
  private readonly evidenceProvider: string
  private readonly concurrency: number

  constructor(private readonly ctx: Context, config: Config) {
    this.serverName = config.codebaseMemoryServerName ?? 'codebase_memory_mcp'
    this.indexMode = config.indexMode ?? 'moderate'
    this.evidenceProvider = config.evidenceProvider ?? 'spawn'
    this.concurrency = config.systemConcurrency ?? 4
  }

  private tool(rawName: string): string {
    return `mcp__${this.serverName}__${rawName}`
  }

  private tools(): Context['tools'] | undefined {
    return (this.ctx as unknown as { get(name: string): Context['tools'] | undefined }).get('tools')
  }

  private hasTool(rawName: string): boolean {
    return this.tools()?.get(this.tool(rawName)) !== undefined
  }

  private async call(rawName: string, args: Record<string, unknown>, options: AnalyzerOptions): Promise<Record<string, unknown>> {
    const name = this.tool(rawName)
    const tools = this.tools()
    if (tools === undefined) throw new Error('DSH tools service is unavailable.')
    const result = await tools.execute({
      callId: CallId(`archscope-${Date.now()}-${this.callSequence += 1}`),
      name,
      arguments: args,
      signal: options.signal ?? new AbortController().signal,
    })
    if (result.isError) throw new Error(`${name}: ${result.error.message}`)
    return canonicalPayload(result.value)
  }

  private async listedProjects(options: AnalyzerOptions): Promise<ListedProject[]> {
    if (!this.hasTool('list_projects')) return []
    const payload = await this.call('list_projects', {}, options)
    if (!Array.isArray(payload.projects)) return []
    return payload.projects.filter(isObject).flatMap(item => {
      if (typeof item.name !== 'string' || typeof item.root_path !== 'string') return []
      return [{
        name: item.name,
        root_path: path.resolve(item.root_path),
        ...typeof item.nodes === 'number' ? { nodes: item.nodes } : {},
        ...typeof item.edges === 'number' ? { edges: item.edges } : {},
      }]
    })
  }

  private async assertIndexReady(project: ListedProject, options: AnalyzerOptions): Promise<ListedProject> {
    const payload = await this.call('index_status', { project: project.name }, options)
    if (payload.status !== 'ready') {
      throw new Error(`codebase-memory index ${project.name} is not ready (status: ${String(payload.status ?? 'unknown')})`)
    }
    return {
      ...project,
      ...typeof payload.nodes === 'number' ? { nodes: payload.nodes } : {},
      ...typeof payload.edges === 'number' ? { edges: payload.edges } : {},
    }
  }

  async index(projects: ProjectRecord[], options: AnalyzerOptions): Promise<IndexManifest> {
    const requiredIndexTools = ['list_projects', 'index_repository', 'index_status']
    const missingIndexTools = requiredIndexTools.filter(name => !this.hasTool(name))
    if (missingIndexTools.length > 0) {
      return {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        generatedAt: options.generatedAt,
        records: projects.map(project => ({
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          provider: 'unavailable',
          status: 'PENDING',
          reason: `Required DSH codebase-memory tools are unavailable: ${missingIndexTools.map(name => this.tool(name)).join(', ')}.`,
        })),
      }
    }

    let existing: ListedProject[] = []
    try {
      existing = await this.listedProjects(options)
    } catch {
      existing = []
    }
    let completed = 0
    const records = await mapLimit(projects, this.concurrency, async project => {
      options.signal?.throwIfAborted()
      const root = path.resolve(options.workspaceRoot, project.projectDir)
      const matched = existing.find(item => item.root_path === root)
      try {
        let indexed = matched
        if (indexed === undefined || options.refresh) {
          const payload = await this.call('index_repository', {
            repo_path: root,
            mode: this.indexMode,
            persistence: false,
          }, options)
          const projectName = typeof payload.project === 'string' ? payload.project : undefined
          indexed = projectName === undefined
            ? undefined
            : {
                name: projectName,
                root_path: root,
                ...typeof payload.nodes === 'number' ? { nodes: payload.nodes } : {},
                ...typeof payload.edges === 'number' ? { edges: payload.edges } : {},
              }
          if (indexed === undefined) {
            const refreshed = await this.listedProjects(options)
            indexed = refreshed.find(item => item.root_path === root)
          }
        }
        if (indexed === undefined) throw new Error('index completed without a resolvable MCP project')
        indexed = await this.assertIndexReady(indexed, options)
        return {
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          provider: 'codebase-memory-mcp',
          status: 'FRESH',
          reason: matched !== undefined && !options.refresh ? 'Reused an existing index matched by exact root path.' : `Indexed with mode ${this.indexMode}.`,
          mcpProject: indexed.name,
          ...indexed.nodes === undefined ? {} : { nodeCount: indexed.nodes },
          ...indexed.edges === undefined ? {} : { edgeCount: indexed.edges },
          indexedAt: new Date().toISOString(),
        } satisfies IndexRecord
      } catch (error) {
        return {
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          provider: 'codebase-memory-mcp',
          status: 'FAILED',
          reason: error instanceof Error ? error.message : String(error),
        } satisfies IndexRecord
      } finally {
        completed += 1
        if (shouldReportProgress(completed, projects.length)) {
          options.onProgress?.({
            stage: 'INDEXING',
            message: `代码智能索引进度 ${completed}/${projects.length}`,
            completed,
            total: projects.length,
          })
        }
      }
    })
    return { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt: options.generatedAt, records }
  }

  async collectEvidence(projects: ProjectRecord[], indexes: IndexManifest, options: AnalyzerOptions): Promise<SystemEvidenceBundle> {
    const service = (this.ctx as unknown as { get(name: string): unknown }).get('subagents') as SubagentRuntimeLike | undefined
    const providerAvailable = service?.getProvider(this.evidenceProvider) !== undefined
    if (service === undefined || !providerAvailable || options.agent === undefined) {
      const reason = options.agent === undefined
        ? 'System evidence workers require the invoking DSH agent.'
        : `DSH subagent provider ${this.evidenceProvider} is unavailable.`
      return {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        generatedAt: options.generatedAt,
        records: projects.map(project => skippedEvidence(project, indexes.records.find(item => item.projectKey === project.projectKey), reason)),
      }
    }

    const readTools = ['get_architecture', 'search_graph', 'query_graph', 'get_code_snippet', 'trace_path', 'search_code']
      .map(name => this.tool(name))
      .filter(name => this.tools()?.get(name) !== undefined)
    if (!this.hasTool('get_architecture') || readTools.length === 0) {
      return {
        protocolVersion: SYSTEM_SCAN_PROTOCOL,
        generatedAt: options.generatedAt,
        records: projects.map(project => skippedEvidence(project, indexes.records.find(item => item.projectKey === project.projectKey), 'The required read-only codebase-memory architecture tool is unavailable.')),
      }
    }

    let completed = 0
    const knownProjectKeys = new Set(projects.map(project => project.projectKey))
    const knownProjectIdentities = projects.map(project => ({ projectKey: project.projectKey, projectDir: project.projectDir }))
    const records = await mapLimit(projects, this.concurrency, async project => {
      const index = indexes.records.find(item => item.projectKey === project.projectKey)
      if (index?.status !== 'FRESH' || index.mcpProject === undefined) {
        completed += 1
        if (shouldReportProgress(completed, projects.length)) {
          options.onProgress?.({
            stage: 'COLLECTING_EVIDENCE',
            message: `系统证据采集进度 ${completed}/${projects.length}`,
            completed,
            total: projects.length,
          })
        }
        return skippedEvidence(project, index, 'A fresh code-intelligence index is required before evidence collection.')
      }
      const projectRoot = path.resolve(options.workspaceRoot, project.projectDir)
      let run: SubagentRunLike | undefined
      try {
        const architecture = await this.call('get_architecture', {
          project: index.mcpProject,
          aspects: ['overview', 'structure', 'dependencies', 'routes', 'languages'],
        }, options)
        const architectureBaseline = redact(JSON.stringify(architecture), 12_000)
        const metadataBaseline = await collectSafeProjectMetadata(projectRoot).catch(() => ({
          files: [],
          omittedFiles: 0,
          boundary: 'PROJECT_ROOT_ONLY' as const,
        }))
        const prompt = `你是 ArchScope 系统级只读证据 worker。只分析一个工程，不建立全局结论，不写文件，不判断生产启用。\n\n工程键：${project.projectKey}\n工程相对路径：${project.projectDir}\n工程绝对路径：${projectRoot}\n唯一允许使用的 codebase-memory project：${index.mcpProject}\n工作区已知工程身份（只能用于目标身份映射，不能读取这些工程）：${JSON.stringify(knownProjectIdentities)}\n\nArchScope 已通过 get_architecture 获取代码图谱基线，并在父进程中通过工程根目录边界检查、符号链接拒绝、大小限制和凭据保护，确定性采集了配置/文档元数据。你仍需按需调用允许的 codebase-memory 只读工具补充代码证据，不得读取或查询其他 MCP project。\n\n代码图谱基线：\n${architectureBaseline}\n\n安全元数据基线：\n${JSON.stringify(metadataBaseline)}\n\n从架构、入口、路由、依赖、数据访问、部署配置和基础设施角度采集粗粒度证据。代码定义和调用关系以 codebase-memory 为准；manifest、README、CI、容器和部署配置可引用安全元数据基线。每条结论都附源码相对路径或图谱对象；服务名、域名、IP、路由、表名、Topic、Queue 与 JDBC 结构是本地事实，应保留用于关系核对，但密码、Token、API Key、私钥、Bearer Token、嵌入式账号密码和签名参数不得输出。\n\n除原始 outboundDependencies 外，必须把每条可审查关系单独写入 relationCandidates。targetAlias 使用源码中的服务/工程/通道名称；只有与上面已知工程身份明确匹配时才填写 targetProjectKey。relationType 区分 FEIGN_CLIENT、HTTP_ROUTE_FAMILY、MAVEN_API_DEPENDENCY、SDK_DEPENDENCY、MESSAGE_CHANNEL、SHARED_DATA_ASSET、CONFIGURED_ENDPOINT、NAME_MATCH_CANDIDATE、OTHER；直接调用/契约使用 DIRECT_SOURCE，配置指向使用 CONFIGURATION，仅名称相似使用 NAME_MATCH。每条关系必须携带 description、evidencePaths，runtimeStatus 固定 UNCONFIRMED。不要把框架普通依赖伪装成跨工程关系。\n\n返回结构化结果：工程类型候选、启动/用户入口、出站依赖、结构化关系候选、数据资产、基础设施、别名/服务名、能力候选、证据路径、冲突与不确定项，以及 scopeStatus 和 scopeViolations。没有证据时返回空数组，不要猜测。未发生真实越界时必须返回 scopeStatus=CLEAN 且 scopeViolations=[]；禁止在 scopeViolations 中填写“无违规”或工具使用说明。`
        run = await service.start(this.evidenceProvider, {
          label: `archscope-system-evidence:${project.projectKey}`,
          prompt: [{ type: 'text', text: prompt }],
          parent: options.agent,
          signal: options.signal ?? new AbortController().signal,
          persona: `你是 ArchScope 的单工程系统证据采集器。你只能使用请求中列出的 codebase-memory 工具；不存在 Glob、Inspect、OUT、Read、Bash 或 shell 工具，不得尝试调用它们。代码定义、调用关系和路由优先使用 search_graph、trace_path、get_code_snippet；非代码文本搜索使用 search_code。严格使用提示中唯一授权的 MCP project。`,
          outputSchema: EVIDENCE_OUTPUT_SCHEMA,
          maxDepth: 1,
          toolFilter: { allow: readTools },
        })
        const result = await run.result
        if (result.stopReason !== 'completed' || !isObject(result.structured)) {
          throw new Error(`evidence worker stopped with ${result.stopReason}`)
        }
        const structured = result.structured
        const scopeStatus = structured.scopeStatus === 'VIOLATION' ? 'VIOLATION' : 'CLEAN'
        const evidence = {
          projectKey: project.projectKey,
          projectDir: project.projectDir,
          mcpProject: index.mcpProject,
          status: 'COLLECTED',
          ...Object.fromEntries(EVIDENCE_FIELDS.map(field => [field, stringArray(structured[field])])),
          relationCandidates: relationCandidates(structured.relationCandidates, knownProjectKeys),
          scopeStatus,
          scopeViolations: scopeStatus === 'VIOLATION'
            ? stringArray(structured.scopeViolations)
            : [],
        } as ProjectSystemEvidence
        if (evidence.evidencePaths.length === 0) {
          throw new Error('evidence worker returned no reviewable source paths or graph objects')
        }
        return evidence
      } catch (error) {
        return {
          ...skippedEvidence(project, index, error instanceof Error ? error.message : String(error)),
          status: 'FAILED' as const,
        } satisfies ProjectSystemEvidence
      } finally {
        await run?.dispose().catch(() => undefined)
        completed += 1
        if (shouldReportProgress(completed, projects.length)) {
          options.onProgress?.({
            stage: 'COLLECTING_EVIDENCE',
            message: `系统证据采集进度 ${completed}/${projects.length}`,
            completed,
            total: projects.length,
          })
        }
      }
    })
    return { protocolVersion: SYSTEM_SCAN_PROTOCOL, generatedAt: options.generatedAt, records }
  }
}
