import pino from 'pino';
import { ResultOrError, ok } from '@core/types.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LoggerConfig {
  level: LogLevel;
  pretty: boolean;
  destination?: string;
  redact?: string[];
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: (process.env['LOG_LEVEL'] as LogLevel) ?? 'info',
  pretty: process.env['NODE_ENV'] !== 'production',
  redact: ['req.headers.authorization', 'req.headers["x-api-key"]', '*.apiKey', '*.password', '*.secret', '*.token']
};

export class AgentLogger {
  private logger: pino.Logger;
  private config: LoggerConfig;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = this.createLogger();
  }

  private createLogger(): pino.Logger {
    const options: pino.LoggerOptions = {
      level: this.config.level,
      redact: this.config.redact,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
        bindings: () => ({ pid: process.pid, hostname: process.env['HOSTNAME'] })
      }
    };

    if (this.config.pretty) {
      return pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }
        }
      });
    }

    if (this.config.destination) {
      return pino(options, pino.destination(this.config.destination));
    }

    return pino(options);
  }

  getLogger(): pino.Logger {
    return this.logger;
  }

  child(bindings: Record<string, unknown>): AgentLogger {
    const child = new AgentLogger(this.config);
    child.logger = this.logger.child(bindings);
    return child;
  }

  setLevel(level: LogLevel): void {
    this.logger.level = level;
    this.config.level = level;
  }

  trace(message: string, meta?: Record<string, unknown>): void {
    this.logger.trace(meta, message);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.logger.debug(meta, message);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.logger.info(meta, message);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.logger.warn(meta, message);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.logger.error(meta, message);
  }

  fatal(message: string, meta?: Record<string, unknown>): void {
    this.logger.fatal(meta, message);
  }

  async flush(): Promise<void> {
    await new Promise(resolve => this.logger.flush(resolve));
  }
}

export function createLogger(config?: Partial<LoggerConfig>): AgentLogger {
  return new AgentLogger(config);
}

export const defaultLogger = createLogger();