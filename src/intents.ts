export type ArchScopeIntent =
  | { kind: 'help' }
  | { kind: 'system.scan'; refresh: boolean }
  | { kind: 'project.scan'; projectKey: string; refresh: boolean }
  | { kind: 'run.resume'; runId?: string }

export type ArchScopeIntentParseResult =
  | { ok: true; intent: ArchScopeIntent }
  | { ok: false; error: string }
