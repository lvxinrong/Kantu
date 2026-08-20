import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import { createArchScopeCommand } from './commands/archscope.js'
import type { Config as ArchScopeConfig } from './config.js'
import { ArchScopeService } from './service.js'
import { createStatusTool } from './tools/status.js'
import { createSystemScanTool } from './tools/system-scan.js'
import {
  createCommitSystemSynthesisTool,
  createSystemProjectEvidenceTool,
  createSystemSynthesisContextTool,
} from './tools/system-synthesis.js'

export const name = 'archscope'
export const inject = ['tools']
export { Config } from './config.js'
export type * from './intents.js'
export type * from './contracts/system-scan.js'
export {
  ARCHSCOPE_COMMAND_HELP,
  createArchScopeCommand,
  executeArchScopeIntent,
  parseArchScopeCommand,
} from './commands/archscope.js'
export { ArchScopeService } from './service.js'
export { loadProtocolPack, parseProtocolContract, protocolResource } from './protocol/catalog.js'
export type * from './protocol/catalog.js'
export { activeProjectBlockers, markdownHeadings, metadataValues, validateSensitiveContent, validateSystemDocument } from './protocol/validation.js'
export {
  prepareSynthesizedSystemArtifacts,
  renderEntryOverviewDiagram,
  renderInternalRelationsDiagram,
  renderSystemContextDiagram,
  renderSystemFactBase,
  validateSystemArtifacts,
  writeSystemEvidenceArtifacts,
  writeSynthesizedSystemArtifacts,
} from './system/artifacts.js'
export { buildSystemSynthesisContext } from './system/synthesis.js'

export function apply(ctx: Context, config: ArchScopeConfig): void {
  const service = new ArchScopeService(ctx, config)

  if (config.registerCommand) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(
        createArchScopeCommand(service),
      )
    })
  }

  if (config.registerSystemScanTool) {
    ctx.tools.register(createSystemScanTool(service))
    ctx.tools.register(createSystemSynthesisContextTool(service))
    ctx.tools.register(createSystemProjectEvidenceTool(service))
    ctx.tools.register(createCommitSystemSynthesisTool(service))
  }

  if (config.registerStatusTool) {
    ctx.tools.register(createStatusTool(service))
  }
}
