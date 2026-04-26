import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import type { IGlobalKeyDownMap, IGlobalKeyEvent, IGlobalKeyListener } from 'node-global-key-listener';

type RawInputState = 'DOWN' | 'UP';

interface RawInputKeyLine {
  type: 'key';
  state: RawInputState;
  vKey: number;
  scanCode: number;
}

interface WindowsRawInputKeyboardListenerOptions {
  serverPath?: string;
  spawnProcess?: typeof spawn;
  onError?: (error: unknown) => void;
  onInfo?: (info: string) => void;
}

const KEY_NAMES = new Map<number, IGlobalKeyEvent['name']>([
  [0x08, 'BACKSPACE'],
  [0x09, 'TAB'],
  [0x0d, 'RETURN'],
  [0x14, 'CAPS LOCK'],
  [0x1b, 'ESCAPE'],
  [0x20, 'SPACE'],
  [0x21, 'PAGE UP'],
  [0x22, 'PAGE DOWN'],
  [0x23, 'END'],
  [0x24, 'HOME'],
  [0x25, 'LEFT ARROW'],
  [0x26, 'UP ARROW'],
  [0x27, 'RIGHT ARROW'],
  [0x28, 'DOWN ARROW'],
  [0x2d, 'INS'],
  [0x2e, 'DELETE'],
  [0x5b, 'LEFT META'],
  [0x5c, 'RIGHT META'],
  [0xa0, 'LEFT SHIFT'],
  [0xa1, 'RIGHT SHIFT'],
  [0xa2, 'LEFT CTRL'],
  [0xa3, 'RIGHT CTRL'],
  [0xa4, 'LEFT ALT'],
  [0xa5, 'RIGHT ALT'],
  [0xba, 'SEMICOLON'],
  [0xbb, 'EQUALS'],
  [0xbc, 'COMMA'],
  [0xbd, 'MINUS'],
  [0xbe, 'DOT'],
  [0xbf, 'FORWARD SLASH'],
  [0xc0, 'BACKTICK'],
  [0xdb, 'SQUARE BRACKET OPEN'],
  [0xdc, 'BACKSLASH'],
  [0xdd, 'SQUARE BRACKET CLOSE'],
  [0xde, 'QUOTE']
]);

export function parseWindowsRawInputLine(line: string): IGlobalKeyEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (!isRawInputKeyLine(parsed)) {
    return null;
  }

  return {
    vKey: parsed.vKey,
    name: keyNameForVirtualKey(parsed.vKey),
    state: parsed.state,
    scanCode: parsed.scanCode,
    _raw: trimmed
  };
}

export class WindowsRawInputKeyboardListener {
  private process?: ChildProcess;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private readonly decoder = new StringDecoder('utf8');
  private readonly down: IGlobalKeyDownMap = {};
  private readonly spawnProcess: typeof spawn;

  constructor(private readonly callback: IGlobalKeyListener, private readonly options: WindowsRawInputKeyboardListenerOptions = {}) {
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  async start(): Promise<void> {
    if (!this.options.serverPath) {
      throw new Error('V2TKeyboardListener.exe 路径未配置');
    }

    const child = this.spawnProcess(this.options.serverPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    child.stdout?.on('data', (chunk: Buffer) => this.handleStdoutChunk(chunk));
    child.stderr?.on('data', (chunk: Buffer) => this.handleStderrChunk(chunk));
    child.on('error', (error) => this.options.onError?.(error));
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        this.options.onError?.(code);
      }
    });
    this.process = child;
  }

  stop(): void {
    this.process?.kill();
    this.process = undefined;
  }

  handleLine(line: string): void {
    const event = parseWindowsRawInputLine(line);
    if (!event || !event.name) {
      return;
    }

    this.down[event.name] = event.state === 'DOWN';
    this.callback(event, { ...this.down });
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer += this.decoder.write(chunk);
    this.stdoutBuffer = drainLines(this.stdoutBuffer, (line) => this.handleLine(line));
  }

  private handleStderrChunk(chunk: Buffer): void {
    this.stderrBuffer += this.decoder.write(chunk);
    this.stderrBuffer = drainLines(this.stderrBuffer, (line) => this.options.onInfo?.(line));
  }
}

function drainLines(buffer: string, handleLine: (line: string) => void): string {
  const lines = buffer.split(/\r?\n/);
  const rest = lines.pop() ?? '';
  for (const line of lines) {
    handleLine(line);
  }
  return rest;
}

function isRawInputKeyLine(value: unknown): value is RawInputKeyLine {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.type === 'key' &&
    (record.state === 'DOWN' || record.state === 'UP') &&
    typeof record.vKey === 'number' &&
    typeof record.scanCode === 'number'
  );
}

function keyNameForVirtualKey(vKey: number): IGlobalKeyEvent['name'] {
  if (vKey >= 0x30 && vKey <= 0x39) {
    return String.fromCharCode(vKey) as IGlobalKeyEvent['name'];
  }
  if (vKey >= 0x41 && vKey <= 0x5a) {
    return String.fromCharCode(vKey) as IGlobalKeyEvent['name'];
  }
  if (vKey >= 0x70 && vKey <= 0x87) {
    return `F${vKey - 0x6f}` as IGlobalKeyEvent['name'];
  }
  return KEY_NAMES.get(vKey);
}
