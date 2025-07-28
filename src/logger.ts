// Production-ready logger with levels and structured output
export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
  metadata?: any;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface Logger {
  debug(message: string, metadata?: any): void;
  info(message: string, metadata?: any): void;
  warn(message: string, metadata?: any): void;
  error(message: string, metadata?: any): void;
}

class ProductionLogger implements Logger {
  private level: LogLevel;
  private logFn: (entry: LogEntry) => void;

  constructor(level: LogLevel = 'info', logFn?: (entry: LogEntry) => void) {
    this.level = level;
    this.logFn = logFn || this.defaultLogFn;
  }

  debug(message: string, metadata?: any): void {
    if (this.shouldLog('debug')) {
      this.logFn({
        level: 'debug',
        message,
        timestamp: Date.now(),
        metadata
      });
    }
  }

  info(message: string, metadata?: any): void {
    if (this.shouldLog('info')) {
      this.logFn({
        level: 'info',
        message,
        timestamp: Date.now(),
        metadata
      });
    }
  }

  warn(message: string, metadata?: any): void {
    if (this.shouldLog('warn')) {
      this.logFn({
        level: 'warn',
        message,
        timestamp: Date.now(),
        metadata
      });
    }
  }

  error(message: string, metadata?: any): void {
    if (this.shouldLog('error')) {
      this.logFn({
        level: 'error',
        message,
        timestamp: Date.now(),
        metadata
      });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (this.level === 'silent') return false;
    
    const levels = ['debug', 'info', 'warn', 'error'];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private defaultLogFn(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const message = `[${timestamp}] ${entry.level.toUpperCase()}: ${entry.message}`;
    
    switch (entry.level) {
      case 'error':
        console.error(message, entry.metadata || '');
        break;
      case 'warn':
        console.warn(message, entry.metadata || '');
        break;
      case 'info':
        console.info(message, entry.metadata || '');
        break;
      case 'debug':
        console.debug(message, entry.metadata || '');
        break;
    }
  }
}

// Silent logger for production environments
class SilentLogger implements Logger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}

// Export factory function
export function createLogger(level: LogLevel = 'info', logFn?: (entry: LogEntry) => void): Logger {
  if (level === 'silent') {
    return new SilentLogger();
  }
  return new ProductionLogger(level, logFn);
}

// Default logger instance
export const logger = createLogger(
  (process.env.NODE_ENV === 'production') ? 'warn' : 'info'
);
