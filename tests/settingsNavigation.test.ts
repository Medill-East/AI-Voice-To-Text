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
    expect(app).toContain('检查监听组件');
    expect(app).toContain('清理旧监听进程');
    expect(app).toContain('单击快捷键');
    expect(app).toContain('双击快捷键');
    expect(app).toContain('推荐分');
    expect(app).toContain('公开榜单');
    expect(app).toContain('官方评测');
    expect(app).toContain('V2T 本机适配分');
    expect(app).toContain('同步历史');
    expect(app).toContain('自动同步');
    expect(app).toContain('一键同步');
    expect(app).toContain('选择本地同步仓库位置');
    expect(app).toContain('使用本机覆盖远端');
    expect(app).toContain('导入远端到本机');
    expect(app).toContain('智能合并');
    expect(app).toContain('查看冲突备份');
    expect(app).toContain('上次长语音处理异常退出');
    expect(app).toContain('自然输入 Prompt');
    expect(app).toContain('结构输入 Prompt');
    expect(app).toContain('外观');
    expect(app).toContain('跟随系统');
    expect(app).toContain('浅色');
    expect(app).toContain('深色');
    expect(app).toContain('复制更新诊断');
    expect(app).toContain('更新包签名不匹配');
    expect(app).toContain('下载新版');
    expect(app).toContain('manualUpdateDownload ? null');
    expect(app).toContain('导入模型');
    expect(app).toContain('导入压缩包');
    expect(app).toContain('导入已解压目录');
    expect(app).toContain('清除残留');
    expect(app).toContain('当前一键下载主要来自 GitHub/k2-fsa Release');
    expect(app).toContain('公开高分参考');
    expect(app).toContain('ModelComparisonTable');
    expect(app).toContain('中文推荐分');
    expect(app).toContain('英文公开榜参考');
    expect(app).toContain('刷新模型榜单');
    expect(app).toContain('复制榜单诊断');
    expect(app).toContain('下载测速');
    expect(app).toContain('重新测速');
    expect(app).toContain('结构化引擎');
    expect(app).toContain('本地规则');
    expect(app).toContain('Prompt 仅在启用 LLM 后生效');
    expect(app).toContain('上次刷新');
    expect(app).toContain("permissionKind === 'macos-accessibility'");
    expect(app).toContain('Windows Raw Input');
    expect(app).toContain('Defender 已隔离 WinKeyServer.exe 时不要恢复');
    expect(app).toContain('V2TKeyboardListener.exe');
    expect(app).not.toContain('className=\"mode-switch\"');
    expect(app).toContain('单独的私有仓库');
    expect(app).toContain('settings.json、lexicon.json、prompts/natural.md、prompts/structured.md');
    expect(app).toContain('autoCapitalize="off"');
    expect(app).toContain('autoCorrect="off"');
    expect(app).toContain('spellCheck={false}');
    expect(app).not.toContain('showAdvanced');
    expect(app).not.toContain('收起高级设置');

    const styles = await readFile(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    expect(styles).toContain('.setting-check input[type="checkbox"]');
    expect(styles).toContain('width: 16px');
  });
});
