import { describe, expect, it } from 'vitest'

import { createStatusMessage } from '../src/tools/status.js'

describe('createStatusMessage', () => {
  it('reports the configured artifact directory and scaffold state', () => {
    const message = createStatusMessage({ outputDirectory: '.kantu/artifacts' })

    expect(message).toContain('Kantu is loaded.')
    expect(message).toContain('.kantu/artifacts')
    expect(message).toContain('not implemented')
  })
})

