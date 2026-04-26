import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('settings navigation structure', () => {
  it('defines the fixed app pages used by the sidebar navigation', async () => {
    const app = await readFile(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(app).toContain("type AppPage = 'voice' | 'models' | 'hotkey' | 'lexicon' | 'prompts' | 'sync' | 'advanced' | 'app'");
    for (const label of ['语音输入', '模型', '快捷键', '词库', '提示词', 'GitHub 同步', '高级设置', '应用']) {
      expect(app).toContain(label);
    }
    expect(app).not.toContain('触发按键');
    expect(app).toContain('className="page-nav"');
    expect(app).toContain('className="page-content"');
    expect(app).toContain('复制诊断信息');
    expect(app).toContain('单击快捷键');
    expect(app).toContain('双击快捷键');
    expect(app).toContain('推荐分');
    expect(app).toContain('公开榜单');
    expect(app).toContain('官方评测');
    expect(app).toContain('V2T 本机适配分');
    expect(app).toContain('同步历史');
    expect(app).toContain('自动同步');
    expect(app).toContain('一键同步');
    expect(app).toContain('自然输入 Prompt');
    expect(app).toContain('结构输入 Prompt');
    expect(app).toContain('外观');
    expect(app).toContain('跟随系统');
    expect(app).toContain('浅色');
    expect(app).toContain('深色');
    expect(app).toContain('公开高分参考');
    expect(app).toContain('ModelComparisonTable');
    expect(app).toContain('中文推荐分');
    expect(app).toContain('英文公开榜参考');
    expect(app).toContain('刷新模型榜单');
    expect(app).toContain('上次刷新');
    expect(app).toContain("permissionKind === 'macos-accessibility'");
    expect(app).toContain('Windows 系统键盘监听');
    expect(app).not.toContain('className=\"mode-switch\"');
    expect(app).toContain('单独的私有仓库');
    expect(app).toContain('settings.json、lexicon.json、prompts/natural.md、prompts/structured.md');
    expect(app).toContain('autoCapitalize="off"');
    expect(app).toContain('autoCorrect="off"');
    expect(app).toContain('spellCheck={false}');
    expect(app).not.toContain('showAdvanced');
    expect(app).not.toContain('收起高级设置');
  });
});
