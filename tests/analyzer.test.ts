import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'

import { SYSTEM_SCAN_PROTOCOL, type ProjectRecord } from '../src/contracts/system-scan.js'
import { DshSystemAnalyzer } from '../src/system/analyzer.js'

const project: ProjectRecord = {
  projectKey: 'service',
  projectName: 'service',
  projectDir: 'service',
  gitHead: '0123456789abcdef0123456789abcdef01234567',
  projectType: 'java-project',
  classificationEvidence: ['pom.xml'],
  productionStatus: 'UNCONFIRMED',
}

function success(value: unknown) {
  return { isError: false, value, content: [] }
}

describe('DshSystemAnalyzer', () => {
  it('indexes through the DSH MCP tool bridge and collects isolated structured evidence', async () => {
    const calls: Array<{ name: string, arguments: unknown }> = []
    let subagentRequest: Record<string, unknown> | undefined
    const tools = {
      get(name: string) {
        return name.startsWith('mcp__codebase_memory_mcp__') ? {} : undefined
      },
      async execute(input: { name: string, arguments: unknown }) {
        calls.push(input)
        if (input.name.endsWith('__list_projects')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({ projects: [] }) }] })
        }
        if (input.name.endsWith('__index_repository')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({ project: 'indexed-service', nodes: 12, edges: 20 }) }] })
        }
        if (input.name.endsWith('__index_status')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({ project: 'indexed-service', status: 'ready', nodes: 12, edges: 20 }) }] })
        }
        if (input.name.endsWith('__get_architecture')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({ languages: ['Java'], packages: ['src'] }) }] })
        }
        throw new Error(`unexpected tool: ${input.name}`)
      },
    }
    const subagents = {
      getProvider(name: string) {
        return name === 'spawn' ? {} : undefined
      },
      async start(_name: string, request: Record<string, unknown>) {
        subagentRequest = request
        return {
          result: Promise.resolve({
            stopReason: 'completed',
            output: [],
            structured: {
              projectTypeCandidates: ['java-backend'],
              entries: ['HTTP entry — src/Main.java'],
              outboundDependencies: [],
              dataAssets: ['Repository candidate — src/OrderRepository.java'],
              infrastructure: ['Spring configuration — pom.xml'],
              aliases: ['service-a'],
              capabilityCandidates: ['Order capability — src/order'],
              evidencePaths: ['pom.xml', 'src/Main.java'],
              conflicts: [],
              scopeStatus: 'CLEAN',
              scopeViolations: ['无：仅使用唯一授权 project，未发生越界'],
            },
          }),
          async dispose() {},
        }
      },
    }
    const ctx = {
      get(name: string) {
        if (name === 'tools') return tools
        if (name === 'subagents') return subagents
        return undefined
      },
    } as unknown as Context
    const analyzer = new DshSystemAnalyzer(ctx, {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: true,
      registerSystemScanTool: true,
      registerStatusTool: true,
    })
    const options = {
      workspaceRoot: '/workspace',
      generatedAt: '2026-08-19T00:00:00.000Z',
      refresh: true,
      agent: {} as never,
    }

    const indexes = await analyzer.index([project], options)
    const evidence = await analyzer.collectEvidence([project], indexes, options)

    expect(indexes).toEqual({
      protocolVersion: SYSTEM_SCAN_PROTOCOL,
      generatedAt: options.generatedAt,
      records: [expect.objectContaining({ status: 'FRESH', mcpProject: 'indexed-service' })],
    })
    expect(calls.map(call => call.name)).toEqual(expect.arrayContaining([
      'mcp__codebase_memory_mcp__list_projects',
      'mcp__codebase_memory_mcp__index_repository',
      'mcp__codebase_memory_mcp__index_status',
      'mcp__codebase_memory_mcp__get_architecture',
    ]))
    expect(evidence.records[0]).toMatchObject({
      status: 'COLLECTED',
      entries: ['HTTP entry — src/Main.java'],
      scopeStatus: 'CLEAN',
      scopeViolations: [],
    })
    expect(subagentRequest).toMatchObject({
      maxDepth: 1,
      toolFilter: { allow: expect.arrayContaining(['mcp__codebase_memory_mcp__get_architecture']) },
    })
    expect(JSON.stringify(subagentRequest?.outputSchema)).not.toContain('maxItems')
    expect(subagentRequest).toMatchObject({
      persona: expect.stringContaining('不存在 Glob、Inspect、OUT'),
    })
  })

  it('fails closed when the DSH tools service is unavailable', async () => {
    const ctx = { get() { return undefined } } as unknown as Context
    const analyzer = new DshSystemAnalyzer(ctx, {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })
    const options = { workspaceRoot: '/workspace', generatedAt: '2026-08-19T00:00:00.000Z', refresh: false }

    const indexes = await analyzer.index([project], options)
    const evidence = await analyzer.collectEvidence([project], indexes, options)

    expect(indexes.records[0]).toMatchObject({ provider: 'unavailable', status: 'PENDING' })
    expect(evidence.records[0]).toMatchObject({ status: 'SKIPPED' })
  })

  it('reuses an exact-root ready index without rebuilding it', async () => {
    const calls: string[] = []
    const tools = {
      get(name: string) {
        return name.startsWith('mcp__codebase_memory_mcp__') ? {} : undefined
      },
      async execute(input: { name: string }) {
        calls.push(input.name)
        if (input.name.endsWith('__list_projects')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({
            projects: [{ name: 'existing-service', root_path: '/workspace/service', nodes: 10, edges: 15 }],
          }) }] })
        }
        if (input.name.endsWith('__index_status')) {
          return success({ content: [{ type: 'text', text: JSON.stringify({ project: 'existing-service', status: 'ready', nodes: 10, edges: 15 }) }] })
        }
        throw new Error(`unexpected tool: ${input.name}`)
      },
    }
    const ctx = { get(name: string) { return name === 'tools' ? tools : undefined } } as unknown as Context
    const analyzer = new DshSystemAnalyzer(ctx, {
      outputDirectory: 'archscope_docs',
      discoveryMaxDepth: 3,
      registerCommand: false,
      registerSystemScanTool: false,
      registerStatusTool: false,
    })

    const indexes = await analyzer.index([project], {
      workspaceRoot: '/workspace',
      generatedAt: '2026-08-19T00:00:00.000Z',
      refresh: false,
    })

    expect(indexes.records[0]).toMatchObject({ status: 'FRESH', mcpProject: 'existing-service' })
    expect(calls).not.toContain('mcp__codebase_memory_mcp__index_repository')
    expect(calls).toContain('mcp__codebase_memory_mcp__index_status')
  })
})
