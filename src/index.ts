import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import { createArchScopeCommand } from './commands/archscope.js'
import type { Config as ArchScopeConfig } from './config.js'
import { ArchScopeService } from './service.js'
import { createStatusTool } from './tools/status.js'
import { createSystemScanTool } from './tools/system-scan.js'

export const name = 'archscope'
export const inject = ['tools']
export { Config } from './config.js'
export type * from './intents.js'
export type * from './contracts/system-scan.js'
export {
  ARCHSCOPE_COMMAND_HELP,
  KANTU_COMMAND_HELP,
  createArchScopeCommand,
  createKantuCommand,
  executeArchScopeIntent,
  executeKantuIntent,
  parseArchScopeCommand,
  parseKantuCommand,
} from './commands/archscope.js'
export { ArchScopeService, KantuService } from './service.js'
export { loadProtocolPack, parseProtocolContract, protocolResource } from './protocol/catalog.js'
export type * from './protocol/catalog.js'
export { markdownHeadings, metadataValues, validateSystemDocument } from './protocol/validation.js'
export {
  prepareSystemArtifacts,
  renderEntryOverviewDiagram,
  renderInternalRelationsDiagram,
  renderSystemContextDiagram,
  renderSystemFactBase,
  validateSystemArtifacts,
} from './system/artifacts.js'

export function apply(ctx: Context, config: ArchScopeConfig): void {
  const service = new ArchScopeService(ctx, config)

  if (config.registerCommand) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(
        createArchScopeCommand(service),
      )
      if (config.registerLegacyAliases !== false) {
        commandCtx.commands.register(createArchScopeCommand(service, 'kantu'))
      }
    })
  }

  if (config.registerSystemScanTool) {
    ctx.tools.register(createSystemScanTool(service))
    if (config.registerLegacyAliases !== false) ctx.tools.register(createSystemScanTool(service, 'kantu_scan_system'))
  }

  if (config.registerStatusTool) {
    ctx.tools.register(createStatusTool(service))
    if (config.registerLegacyAliases !== false) ctx.tools.register(createStatusTool(service, 'kantu_status'))
  }
}
