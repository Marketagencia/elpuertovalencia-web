import fs from 'node:fs';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(import.meta.dirname, '..', 'data', 'test-'));
fs.mkdirSync(path.join(import.meta.dirname, '..', 'data'), { recursive: true });
process.env.GL_DATA_DIR = dir;
process.env.APP_SECRET = 'test-secret';
export const TEST_DIR = dir;
