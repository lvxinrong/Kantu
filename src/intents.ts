export type KantuIntent =
  | { kind: 'help' }
  | { kind: 'system.scan'; refresh: boolean }
  | { kind: 'project.scan'; projectKey: string; refresh: boolean }
  | { kind: 'run.status'; runId?: string }
  | { kind: 'run.resume'; runId?: string }

export type KantuIntentParseResult =
  | { ok: true; intent: KantuIntent }
  | { ok: false; error: string }

