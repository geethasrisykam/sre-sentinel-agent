import { setLogLevel } from '../logger.js';

// Silence info/warn during tests; failures still print test output via vitest.
setLogLevel('error');
