import pino from 'pino';

/**
 * Structured logger using pino.
 * In development: pretty-printed, colorized output.
 * In production: JSON output for log aggregation (ELK, Datadog, etc.)
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  // In production, output structured JSON
  ...(process.env.NODE_ENV === 'production' && {
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }),
  // Redact sensitive fields from logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'apiKey',
      'secret',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Create a child logger with a specific context.
 * Usage: const log = createLogger('auth');
 *        log.info('User logged in');
 */
export function createLogger(context: string) {
  return logger.child({ context });
}
