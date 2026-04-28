export interface NativeImageLike {
  setTemplateImage(value: boolean): void;
}

export interface NativeImageModuleLike<TImage extends NativeImageLike = NativeImageLike> {
  createFromDataURL(dataUrl: string): TImage;
}

export function createTrayImage<TImage extends NativeImageLike>(platform: NodeJS.Platform, nativeImage: NativeImageModuleLike<TImage>): TImage {
  const svg =
    platform === 'darwin'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path fill="black" d="M9 2.2a3 3 0 0 0-3 3v3.2a3 3 0 0 0 6 0V5.2a3 3 0 0 0-3-3Zm-1.5 3a1.5 1.5 0 1 1 3 0v3.2a1.5 1.5 0 1 1-3 0V5.2Z"/><path fill="black" d="M4.2 7.6a.8.8 0 0 1 1.6 0v.7a3.2 3.2 0 0 0 6.4 0v-.7a.8.8 0 0 1 1.6 0v.7a4.8 4.8 0 0 1-4 4.73V15h2.1a.8.8 0 0 1 0 1.6H6.1a.8.8 0 1 1 0-1.6h2.1v-1.97a4.8 4.8 0 0 1-4-4.73v-.7Z"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#1f2724"/><path d="M5 5h8v2H10v7H8V7H5z" fill="#fffaf0"/></svg>';
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  image.setTemplateImage(platform === 'darwin');
  return image;
}
