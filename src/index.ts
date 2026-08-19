import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-commands'

import { createKantuCommand } from './commands/kantu.js'
import type { Config as KantuConfig } from './config.js'
import { KantuService } from './service.js'
import { createStatusTool } from './tools/status.js'
import { createSystemScanTool } from './tools/system-scan.js'

export const name = 'kantu'
export const inject = ['tools']
export { Config } from './config.js'
export type * from './intents.js'
export type * from './contracts/system-scan.js'
export { KANTU_COMMAND_HELP, parseKantuCommand } from './commands/kantu.js'
export { KantuService } from './service.js'
export { loadProtocolPack, parseProtocolContract, protocolResource } from './protocol/catalog.js'
export type * from './protocol/catalog.js'
export { markdownHeadings, metadataValues, validateSystemDocument } from './protocol/validation.js'

export function apply(ctx: Context, config: KantuConfig): void {
  const service = new KantuService(ctx, config)

  if (config.registerCommand) {
    ctx.inject(['commands'], (commandCtx) => {
      commandCtx.commands.register(
        createKantuCommand(service),
      )
    })
  }

  if (config.registerSystemScanTool) {
    ctx.tools.register(createSystemScanTool(service))
  }

  if (config.registerStatusTool) {
    ctx.tools.register(createStatusTool(service))
  }
}
