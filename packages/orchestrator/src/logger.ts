type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let currentLevel: Level = 'info';

export function setLogLevel(level: Level): void {
  currentLevel = level;
}

function emit(level: Level, event: string, fields: object): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const payload = {
    at: new Date().toISOString(),
    level,
    service: 'orchestrator',
    event,
    ...(fields as Record<string, unknown>),
  };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(payload)}\n`);
}

export const log = {
  debug: (event: string, fields: object = {}) => emit('debug', event, fields),
  info: (event: string, fields: object = {}) => emit('info', event, fields),
  warn: (event: string, fields: object = {}) => emit('warn', event, fields),
  error: (event: string, fields: object = {}) => emit('error', event, fields),
};
