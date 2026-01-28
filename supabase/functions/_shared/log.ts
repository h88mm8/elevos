/**
 * Structured logging utilities for Supabase Edge Functions
 * Provides correlation IDs and consistent log format
 */

export interface LogContext {
  correlationId: string;
  functionName: string;
  [key: string]: unknown;
}

export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function createLogger(functionName: string, correlationId?: string) {
  const ctx: LogContext = {
    correlationId: correlationId || generateCorrelationId(),
    functionName,
  };

  const formatMessage = (level: string, message: string, extra?: Record<string, unknown>) => {
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      correlationId: ctx.correlationId,
      function: ctx.functionName,
      message,
      ...extra,
    });
  };

  return {
    correlationId: ctx.correlationId,
    
    info(message: string, extra?: Record<string, unknown>) {
      console.log(formatMessage('INFO', message, extra));
    },
    
    warn(message: string, extra?: Record<string, unknown>) {
      console.warn(formatMessage('WARN', message, extra));
    },
    
    error(message: string, error?: Error | unknown, extra?: Record<string, unknown>) {
      const errorDetails = error instanceof Error 
        ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
        : { errorDetails: String(error) };
      console.error(formatMessage('ERROR', message, { ...errorDetails, ...extra }));
    },
    
    debug(message: string, extra?: Record<string, unknown>) {
      console.log(formatMessage('DEBUG', message, extra));
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
