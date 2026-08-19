import { describe, expect, it } from 'vitest'

import { createStatusMessage } from '../src/tools/status.js'

describe('createStatusMessage', () => {
  it('reports when no persisted run exists', () => {
    const message = createStatusMessage({
      found: false,
      runId: '',
      status: 'NOT_FOUND',
      gate: 'BLOCKED',
      validation: 'NOT_RUN',
      projectCount: 0,
      outputDirectory: '.kantu/artifacts',
    })

    expect(message).toContain('No Kantu run was found')
    expect(message).toContain('.kantu/artifacts')
  })

  it('renders validation and gate separately', () => {
    const message = createStatusMessage({
      found: true,
      runId: 'system-1',
      status: 'BLOCKED',
      gate: 'BLOCKED',
      validation: 'PASSED',
      projectCount: 3,
      outputDirectory: 'kantu_docs',
    })

    expect(message).toContain('Validation: PASSED')
    expect(message).toContain('Gate: BLOCKED')
  })
})
