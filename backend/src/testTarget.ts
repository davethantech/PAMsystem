import { startMockTargetServer } from './mockTargetServer.js';

const port = Number(process.env.TEST_TARGET_PORT ?? 9000);
await startMockTargetServer(port);
