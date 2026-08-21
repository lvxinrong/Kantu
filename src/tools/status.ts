import { defineTool } from '@deepseek-ai/dsh-tools'

import type { ArchScopeStatusResult } from '../contracts/system-scan.js'
import type { ArchScopeService } from '../service.js'

export function createStatusMessage(status: ArchScopeStatusResult): string {
  if (!status.found) {
    return `No ArchScope run was found. Analysis artifacts will be written to ${status.outputDirectory}.`
  }

  if (status.status === 'AWAITING_SYNTHESIS' || status.status === 'SYNTHESIZING') {
    return [
      `ArchScope evidence collection finished · ${status.projectCount} projects · current main-agent worldview synthesis ${status.status === 'SYNTHESIZING' ? 'in progress' : 'pending'}.`,
      `Fresh indexes ${status.indexedProjectCount}/${status.projectCount} · collected evidence ${status.evidenceProjectCount}/${status.projectCount} · scope violations ${status.scopeViolationCount}.`,
      `System artifact validation has not finished (${status.validation}) · project-scan gate ${status.gate}.`,
      `Evidence: ${status.outputDirectory}/runs/${status.runId}/system/evidence/index.json`,
      `Run: ${status.runId} · document revision ${status.documentRevision} · machine status ${status.status}.`,
    ].join('\n')
  }

  const scanOutcome = status.status === 'FAILED'
    ? 'failed'
    : status.status === 'COMPLETED' || status.status === 'BLOCKED'
      ? 'finished'
      : 'in progress'
  const sourceAnalysisComplete = status.projectCount > 0
    && status.indexedProjectCount === status.projectCount
    && status.evidenceProjectCount === status.projectCount
    && status.scopeViolationCount === 0
  const analysisOutcome = sourceAnalysisComplete
    ? 'completed at source level; runtime evidence pending'
    : 'awaiting source evidence'
  const artifactRoot = status.validation === 'PASSED'
    ? `${status.outputDirectory}/system`
    : `${status.outputDirectory}/runs/${status.runId}/system`

  return [
    `ArchScope system scan ${scanOutcome} · ${status.projectCount} projects · system analysis ${analysisOutcome}.`,
    `Fresh indexes ${status.indexedProjectCount}/${status.projectCount} · collected evidence ${status.evidenceProjectCount}/${status.projectCount} · scope violations ${status.scopeViolationCount}.`,
    `System artifact validation ${status.validation} · project-scan gate ${status.gate}.`,
    `Artifacts: ${artifactRoot}/00-system-fact-base.md`,
    `Run: ${status.runId} · document revision ${status.documentRevision} · machine status ${status.status}.`,
  ].join('\n')
}

export function createStatusTool(service: ArchScopeService) {
  return defineTool({
    name: 'archscope_status',
    description: 'Inspect a persisted ArchScope scan run. Omit runId to inspect the latest run.',
    parameters: {
      runId: { type: 'string', description: 'Optional ArchScope run id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          found: { type: 'boolean', required: true },
          runId: { type: 'string', required: true },
          documentRevision: { type: 'string', required: true },
          status: { type: 'string', required: true },
          gate: { type: 'string', required: true },
          validation: { type: 'string', required: true },
          projectCount: { type: 'number', required: true },
          indexedProjectCount: { type: 'number', required: true },
          evidenceProjectCount: { type: 'number', required: true },
          scopeViolationCount: { type: 'number', required: true },
          outputDirectory: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: createStatusMessage(value as unknown as ArchScopeStatusResult) }],
    },
    async execute(args, exec) {
      return service.status(args.runId, { workspaceRoot: exec.agent?.session.header.cwd })
    },
  })
}
