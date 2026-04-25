export function closeShouldHideToTray(isQuitting: boolean): boolean {
  return !isQuitting;
}

export function quitTrayMenuLabel(): string {
  return '完全退出 V2T';
}

export function quitMenuItemConfig(): { label: string; accelerator: string } {
  return {
    label: quitTrayMenuLabel(),
    accelerator: 'Command+Q'
  };
}
