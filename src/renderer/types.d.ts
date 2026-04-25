import type { V2TApi } from '../preload';

declare global {
  interface Window {
    v2t: V2TApi;
  }
}
