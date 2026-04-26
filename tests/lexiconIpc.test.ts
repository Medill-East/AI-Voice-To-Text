import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('lexicon IPC surface', () => {
  it('exposes lexicon loading and saving through preload and main IPC', async () => {
    const preload = await readFile(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    const main = await readFile(new URL('../src/main/index.ts', import.meta.url), 'utf8');

    expect(preload).toContain('getLexicon(): Promise<Lexicon>');
    expect(preload).toContain('saveLexicon(lexicon: Lexicon): Promise<LexiconSaveResult>');
    expect(preload).toContain("ipcRenderer.invoke('v2t:get-lexicon')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:save-lexicon', lexicon)");
    expect(preload).toContain("ipcRenderer.invoke('v2t:copy-hotkey-diagnostics')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:repair-hotkey-helper')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:cleanup-stale-hotkey-helpers')");
    expect(preload).toContain('getPrompts(): Promise<PromptFiles>');
    expect(preload).toContain('savePrompt(mode: InputMode, content: string)');
    expect(preload).toContain('onAutoSyncStatus');
    expect(preload).toContain('refreshModelCatalog(): Promise<SetupPayload>');
    expect(preload).toContain('onModelCatalogRefresh');
    expect(preload).toContain('checkForUpdates(): Promise<AppUpdateState>');
    expect(preload).toContain('downloadUpdate(): Promise<AppUpdateState>');
    expect(preload).toContain('installUpdate(): Promise<AppUpdateState>');
    expect(preload).toContain('onAppUpdateStatus');
    expect(preload).toContain("ipcRenderer.invoke('v2t:sync-all')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:refresh-model-catalog')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:check-for-updates')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:download-update')");
    expect(preload).toContain("ipcRenderer.invoke('v2t:install-update')");
    expect(main).toContain("ipcMain.handle('v2t:get-lexicon'");
    expect(main).toContain("ipcMain.handle('v2t:save-lexicon'");
    expect(main).toContain("ipcMain.handle('v2t:copy-hotkey-diagnostics'");
    expect(main).toContain("ipcMain.handle('v2t:repair-hotkey-helper'");
    expect(main).toContain("ipcMain.handle('v2t:cleanup-stale-hotkey-helpers'");
    expect(main).toContain("ipcMain.handle('v2t:get-prompts'");
    expect(main).toContain("ipcMain.handle('v2t:save-prompt'");
    expect(main).toContain("ipcMain.handle('v2t:sync-all'");
    expect(main).toContain("ipcMain.handle('v2t:refresh-model-catalog'");
    expect(main).toContain("ipcMain.handle('v2t:check-for-updates'");
    expect(main).toContain("ipcMain.handle('v2t:download-update'");
    expect(main).toContain("ipcMain.handle('v2t:install-update'");
    expect(main).toContain("ipcMain.handle('v2t:reinstall-model'");
    expect(main).toContain("ipcMain.handle('v2t:cancel-model-install'");
    expect(main).toContain("scheduleAutoSync('voice-input')");
    expect(main).toContain('store.saveLexicon');
  });
});
