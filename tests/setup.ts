/**
 * Vitest global test setup.
 * Sets environment variables for test mode.
 */

// Set test environment variables BEFORE any imports
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/muhasib_test';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long-unique';
process.env.PORT = '5001';
process.env.LOG_LEVEL = 'error'; // Suppress logs during tests
