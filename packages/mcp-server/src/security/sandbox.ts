import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = Number(process.env.SANDBOX_TIMEOUT ?? 5000);
const MEMORY_LIMIT_MB = Number(process.env.SANDBOX_MEMORY_LIMIT ?? 100);

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runInSandbox(code: string, language: 'python' | 'node'): Promise<SandboxResult> {
  const id = crypto.randomBytes(8).toString('hex');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `steelcore-${id}-`));

  try {
    const ext = language === 'python' ? 'py' : 'js';
    const file = path.join(tmpDir, `run.${ext}`);
    fs.writeFileSync(file, code, { mode: 0o600 });

    const cmd = language === 'python' ? 'python3' : 'node';
    const { stdout, stderr } = await execFileAsync(cmd, [file], {
      timeout: TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        NODE_OPTIONS: language === 'node' ? `--max-old-space-size=${MEMORY_LIMIT_MB}` : undefined,
      },
    });

    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    if (e.code === 'ETIMEDOUT') {
      return { stdout: '', stderr: 'Execution timed out', exitCode: 124 };
    }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? String(e.message),
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
