import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'

import type { SystemSynthesisCommitResult } from '../contracts/system-scan.js'
import type { ArchScopeService } from '../service.js'

function requireAgent(exec: ToolRunContext) {
  if (exec.agent === undefined) throw new Error('ArchScope system synthesis requires the invoking DeepSeek Harness main agent.')
  const workspaceRoot = exec.agent.session.header.cwd
  if (workspaceRoot === undefined || workspaceRoot.trim() === '') {
    throw new Error('ArchScope system synthesis requires the current DeepSeek Harness session workspace.')
  }
  return { agent: exec.agent, workspaceRoot }
}

export function createSystemSynthesisContextTool(service: ArchScopeService) {
  return defineTool({
    name: 'archscope_get_system_synthesis_context',
    description: 'Internal ArchScope handoff tool for the current main agent. Load the complete system-writer protocol plus bounded evidence for a run that is awaiting synthesis. Use only when ArchScope explicitly asks you to synthesize that run.',
    parameters: {
      runId: { type: 'string', required: true, description: 'Exact ArchScope system run id awaiting main-agent synthesis.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          protocolDigest: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.prompt }],
    },
    async execute(args, exec) {
      const { workspaceRoot } = requireAgent(exec)
      return service.getSystemSynthesisContext(args.runId, { workspaceRoot })
    },
  })
}

export function createSystemProjectEvidenceTool(service: ArchScopeService) {
  return defineTool({
    name: 'archscope_get_system_project_evidence',
    description: 'Internal ArchScope synthesis tool. Retrieve complete persisted evidence for 1-8 high-impact project keys when the initial system context is bounded. It never scans code or leaves the current run evidence boundary.',
    parameters: {
      runId: { type: 'string', required: true, description: 'Exact ArchScope system run id currently being synthesized.' },
      projectKeys: {
        type: 'array',
        required: true,
        description: 'One to eight exact projectKey values from the ArchScope project registry.',
        items: { type: 'string' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          protocolDigest: { type: 'string', required: true },
          projectKeys: { type: 'array', required: true, items: { type: 'string' } },
          missingProjectKeys: { type: 'array', required: true, items: { type: 'string' } },
          evidenceJson: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.evidenceJson }],
    },
    async execute(args, exec) {
      const { workspaceRoot } = requireAgent(exec)
      return service.getSystemProjectEvidence(args.runId, { workspaceRoot, projectKeys: args.projectKeys })
    },
  })
}

export function createCommitSystemSynthesisTool(service: ArchScopeService) {
  return defineTool({
    name: 'archscope_commit_system_synthesis',
    description: 'Commit the current DSH main agent system worldview for an ArchScope run. ArchScope normalizes machine metadata, writes Markdown and Mermaid artifacts, and validates evidence, boundaries, redaction, structure, and the project-level gate.',
    parameters: {
      runId: { type: 'string', required: true },
      factBase: { type: 'string', required: true, description: 'Complete 22-section system fact-base Markdown, without a surrounding code fence.' },
      systemContextDiagram: { type: 'string', required: true, description: 'Mermaid flowchart source for the system context diagram, without a code fence.' },
      internalRelationsDiagram: { type: 'string', required: true, description: 'Mermaid flowchart source for internal project relations, without a code fence.' },
      entryOverviewDiagram: { type: 'string', required: true, description: 'Mermaid flowchart source for the coarse entry overview, without a code fence.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          gate: { type: 'string', required: true },
          validation: { type: 'string', required: true },
          projectCount: { type: 'number', required: true },
          indexedProjectCount: { type: 'number', required: true },
          evidenceProjectCount: { type: 'number', required: true },
          scopeViolationCount: { type: 'number', required: true },
          outputDirectory: { type: 'string', required: true },
          reused: { type: 'boolean', required: true },
          synthesisAttempt: { type: 'number', required: true },
          retryAllowed: { type: 'boolean', required: true },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                severity: { type: 'string', required: true },
                code: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        const result = value as unknown as SystemSynthesisCommitResult
        const errors = result.issues.filter(issue => issue.severity === 'ERROR')
        const action = result.retryAllowed
          ? `Validation failed with ${errors.length} error(s). Revise the document from these issues and call archscope_commit_system_synthesis once more:\n${errors.map(issue => `- ${issue.code}: ${issue.message}`).join('\n')}`
          : `System synthesis committed. Validation ${result.validation}; machine status ${result.status}; project-scan gate ${result.gate}. Report the result to the user in Chinese.`
        return [{ type: 'text', text: action }]
      },
    },
    async execute(args, exec) {
      const { agent, workspaceRoot } = requireAgent(exec)
      return service.commitSystemSynthesis({
        runId: args.runId,
        workspaceRoot,
        writer: {
          kind: 'dsh-main-agent',
          sessionId: String(agent.id),
          ...agent.options.provider === undefined ? {} : { provider: agent.options.provider },
          ...agent.options.model === undefined ? {} : { model: agent.options.model },
        },
        draft: {
          factBase: args.factBase,
          diagrams: {
            systemContext: args.systemContextDiagram,
            internalRelations: args.internalRelationsDiagram,
            entryOverview: args.entryOverviewDiagram,
          },
        },
      })
    },
  })
}
