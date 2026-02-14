// Logger Library
// Logging utilities

export const logger = {
  info: (message: string, meta?: any) => console.log(message, meta),
  error: (message: string, error?: any) => console.error(message, error),
  warn: (message: string, meta?: any) => console.warn(message, meta),
  debug: (message: string, meta?: any) => console.debug(message, meta),
};
