import { contextBridge, ipcRenderer } from 'electron';
import type {
  HardwareProfile,
  InputMode,
  ModelCatalogItem,
  ModelRecommendation,
  ModelStatusRecord,
  Settings,
  VoiceInputPipelineResult
} from '../core/types';
import type { HotkeyStatus } from '../main/hotkeyService';

export interface RecordingCommand {
  type: 'start' | 'stop';
  trigger: 'toggle' | 'hold';
}

export interface V2TApi {
  getSettings(): Promise<{ settings: Settings; hotkeyStatus?: HotkeyStatus }>;
  getSetup(): Promise<SetupPayload>;
  saveSettings(settings: Settings): Promise<{ settings: Settings; hotkeyStatus?: HotkeyStatus }>;
  updateHotkey(accelerator: string): Promise<HotkeyUpdateResult>;
  installModel(modelId: string): Promise<InstallModelResult>;
  setOpenAIKey(value: string): Promise<{ ok: true }>;
  processAudio(payload: { bytes: Uint8Array; mode: InputMode }): Promise<VoiceInputPipelineResult>;
  onRecordingCommand(callback: (command: RecordingCommand) => void): () => void;
  onHotkeyStatus(callback: (status: HotkeyStatus) => void): () => void;
}

export interface SetupPayload {
  settings: Settings;
  hotkeyStatus?: HotkeyStatus;
  hardware: HardwareProfile;
  modelRoot: string;
  catalog: ModelCatalogItem[];
  modelStatuses: Record<string, ModelStatusRecord>;
  recommendations: ModelRecommendation[];
}

interface ProcessAudioResponse {
  ok: boolean;
  result?: VoiceInputPipelineResult;
  error?: string;
}

interface InstallModelResult {
  ok: boolean;
  status?: ModelStatusRecord;
  setup: SetupPayload;
  error?: string;
}

interface HotkeyUpdateResult {
  ok: boolean;
  settings: Settings;
  hotkeyStatus?: HotkeyStatus;
  error?: string;
}

const api: V2TApi = {
  getSettings: () => ipcRenderer.invoke('v2t:get-settings'),
  getSetup: () => ipcRenderer.invoke('v2t:get-setup'),
  saveSettings: (settings) => ipcRenderer.invoke('v2t:save-settings', settings),
  updateHotkey: (accelerator) => ipcRenderer.invoke('v2t:update-hotkey', accelerator),
  installModel: (modelId) => ipcRenderer.invoke('v2t:install-model', modelId),
  setOpenAIKey: (value) => ipcRenderer.invoke('v2t:set-openai-key', value),
  processAudio: async (payload) => {
    const response = (await ipcRenderer.invoke('v2t:process-audio', payload)) as ProcessAudioResponse;
    if (!response.ok || !response.result) {
      throw new Error(response.error ?? '转写失败');
    }
    return response.result;
  },
  onRecordingCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: RecordingCommand) => callback(command);
    ipcRenderer.on('v2t:recording-command', listener);
    return () => ipcRenderer.off('v2t:recording-command', listener);
  },
  onHotkeyStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: HotkeyStatus) => callback(status);
    ipcRenderer.on('v2t:hotkey-status', listener);
    return () => ipcRenderer.off('v2t:hotkey-status', listener);
  }
};

contextBridge.exposeInMainWorld('v2t', api);
