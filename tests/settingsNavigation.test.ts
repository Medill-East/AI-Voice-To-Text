import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('settings navigation structure', () => {
  it('defines the fixed app pages used by the sidebar navigation', async () => {
    const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(app).toContain("type AppPage = 'voice' | 'models' | 'hotkey' | 'lexicon' | 'sync' | 'advanced' | 'app'");
    for (const label of ['语音输入', '模型', '快捷键', '词库', 'GitHub 同步', '高级设置', '应用']) {
      expect(app).toContain(label);
    }
    expect(app).not.toContain('触发按键');
    expect(app).toContain('className="page-nav"');
    expect(app).toContain('className="page-content"');
    expect(app).not.toContain('showAdvanced');
    expect(app).not.toContain('收起高级设置');
  });
});
