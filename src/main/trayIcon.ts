export interface NativeImageLike {
  setTemplateImage(value: boolean): void;
}

export interface NativeImageModuleLike<TImage extends NativeImageLike = NativeImageLike> {
  createFromDataURL(dataUrl: string): TImage;
}

export function createTrayImage<TImage extends NativeImageLike>(platform: NodeJS.Platform, nativeImage: NativeImageModuleLike<TImage>): TImage {
  const svg =
    platform === 'darwin'
      ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><path d="M3 4h12v2H10v9H8V6H3z" fill="black"/></svg>'
      : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18"><rect width="18" height="18" rx="4" fill="#1f2724"/><path d="M5 5h8v2H10v7H8V7H5z" fill="#fffaf0"/></svg>';
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
  image.setTemplateImage(platform === 'darwin');
  return image;
}
