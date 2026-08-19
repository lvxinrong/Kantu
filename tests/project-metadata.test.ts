import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { collectSafeProjectMetadata } from '../src/system/project-metadata.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('collectSafeProjectMetadata', () => {
  it('reads bounded metadata inside one project and redacts values before model injection', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'kantu-metadata-'))
    temporaryRoots.push(root)
    const outside = path.join(root, '..', `${path.basename(root)}-outside.txt`)
    await writeFile(outside, 'outside-secret', 'utf8')
    temporaryRoots.push(outside)
    await mkdir(path.join(root, '.github', 'workflows'), { recursive: true })
    await writeFile(path.join(root, 'package.json'), JSON.stringify({
      name: 'demo',
      repository: 'https://user:password@example.com/private.git',
      password: 'super-secret-value',
    }), 'utf8')
    await writeFile(path.join(root, '.env.production'), 'API_TOKEN=raw-token\nPUBLIC_NAME=demo\n', 'utf8')
    await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'steps:\n  - run: echo ok\n', 'utf8')
    await symlink(outside, path.join(root, 'README.md'))

    const metadata = await collectSafeProjectMetadata(root)
    const serialized = JSON.stringify(metadata)

    expect(metadata.boundary).toBe('PROJECT_ROOT_ONLY')
    expect(metadata.files.map(file => file.path)).toEqual(expect.arrayContaining([
      '.env.production',
      '.github/workflows/ci.yml',
      'package.json',
    ]))
    expect(metadata.files.map(file => file.path)).not.toContain('README.md')
    expect(serialized).not.toContain('raw-token')
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('outside-secret')
    expect(serialized).toContain('API_TOKEN=<redacted>')
    expect(serialized).toContain('https://<redacted-host>')
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside-secret')
  })
})
