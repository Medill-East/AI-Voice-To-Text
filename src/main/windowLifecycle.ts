export function closeShouldHideToTray(isQuitting: boolean): boolean {
  return !isQuitting;
}

export function quitTrayMenuLabel(): string {
  return '完全退出 V2T';
}
