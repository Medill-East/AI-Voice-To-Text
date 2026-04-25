import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HotkeyDiagnosticLog } from '../src/main/hotkeyDiagnosticLog';

describe('HotkeyDiagnosticLog', () => {
  it('writes helper diagnostics as json lines', async () => {
    const root = await mkdtemp(join(tmpdir(), 'v2t-hotkey-log-'));
    const logPath = join(root, 'logs', 'hotkey-helper.log');
    const log = new HotkeyDiagnosticLog(logPath);

    await log.write({
      type: 'helper-error',
      helperPath: '/Users/me/Library/Application Support/V2T/keyboard-listener/MacKeyServer',
      signature: 'CDHash=abc123',
      stderr: 'Unable to create CGEvent tap',
      exitCode: 2
    });

    const content = await readFile(logPath, 'utf8');
    expect(content).toContain('"type":"helper-error"');
    expect(content).toContain('MacKeyServer');
    expect(content).toContain('"exitCode":2');
    expect(content).toContain('Unable to create CGEvent tap');
  });
});
