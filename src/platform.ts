export type PlatformTriple = {
  os: 'linux' | 'macos';
  arch: 'x86_64' | 'aarch64';
};

export function detectPlatform(): PlatformTriple | undefined {
  const p = process.platform;
  const a = process.arch;
  if (p === 'linux') {
    if (a === 'x64') return { os: 'linux', arch: 'x86_64' };
    if (a === 'arm64') return { os: 'linux', arch: 'aarch64' };
  } else if (p === 'darwin') {
    if (a === 'x64') return { os: 'macos', arch: 'x86_64' };
    if (a === 'arm64') return { os: 'macos', arch: 'aarch64' };
  }
  return undefined;
}

export function assetNamePrefix(triple: PlatformTriple): string {
  return `acton-${triple.os}-${triple.arch}-`;
}

export function prettyPlatform(triple: PlatformTriple): string {
  const osName = triple.os === 'macos' ? 'macOS' : 'Linux';
  const arch = triple.arch === 'x86_64' ? 'x86_64' : 'arm64';
  return `${osName} ${arch}`;
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

