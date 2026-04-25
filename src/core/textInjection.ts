import type { TextInjectionResult } from './types';

export interface ClipboardWriter {
  writeText(text: string): void;
}

export interface PasteKeySender {
  paste(): Promise<void>;
}

export class TextInjectionService {
  private readonly clipboard: ClipboardWriter;
  private readonly keySender: PasteKeySender;

  constructor(dependencies: { clipboard: ClipboardWriter; keySender: PasteKeySender }) {
    this.clipboard = dependencies.clipboard;
    this.keySender = dependencies.keySender;
  }

  async injectText(text: string): Promise<TextInjectionResult> {
    this.clipboard.writeText(text);

    try {
      await this.keySender.paste();
      return { method: 'cursor' };
    } catch (error) {
      return {
        method: 'clipboard',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
