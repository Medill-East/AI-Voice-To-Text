import { describe, expect, it, vi } from 'vitest';
import { createTrayImage } from '../src/main/trayIcon';

describe('tray icon helper', () => {
  it('creates a visible template image for macOS menu bar', () => {
    const image = {
      setTemplateImage: vi.fn()
    };
    const nativeImage = {
      createFromDataURL: vi.fn().mockReturnValue(image)
    };

    const result = createTrayImage('darwin', nativeImage);

    expect(result).toBe(image);
    expect(nativeImage.createFromDataURL.mock.calls[0][0]).toContain('fill%3D%22black%22');
    expect(nativeImage.createFromDataURL.mock.calls[0][0]).not.toContain('%3Crect%20width%3D%2218%22%20height%3D%2218%22');
    expect(image.setTemplateImage).toHaveBeenCalledWith(true);
  });

  it('does not mark the tray icon as a template image on non-macOS platforms', () => {
    const image = {
      setTemplateImage: vi.fn()
    };
    const nativeImage = {
      createFromDataURL: vi.fn().mockReturnValue(image)
    };

    createTrayImage('win32', nativeImage);

    expect(image.setTemplateImage).toHaveBeenCalledWith(false);
  });
});
