import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { assetNamePrefix, detectPlatform, isWindows, PlatformTriple, prettyPlatform } from './platform';

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  updated_at?: string;
};

export type ReleaseInfo = {
  tag_name: string;
  prerelease: boolean;
  assets: ReleaseAsset[];
};

export type Channel = 'latest' | 'tip';

export type InstallInfo = {
  version: string;
  channel: Channel;
  platform: PlatformTriple;
  installedAt: string;
  assetName: string;
  installDir: string;
  actonPath: string;
  lspPath?: string;
  displayVersion?: string;
  buildId?: string;
};

function infoPath(storage: vscode.Uri): string {
  return vscode.Uri.joinPath(storage, 'acton', 'install.json').fsPath;
}

export function readInstallInfo(storage: vscode.Uri): InstallInfo | undefined {
  try {
    const txt = fs.readFileSync(infoPath(storage), 'utf8');
    const info = JSON.parse(txt) as InstallInfo;
    if (info && fs.existsSync(info.actonPath)) return info;
  } catch {}
  return undefined;
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

export async function getRelease(channel: Channel): Promise<ReleaseInfo> {
  if (channel === 'latest') {
    return fetchJSON<ReleaseInfo>('https://api.github.com/repos/actonlang/acton/releases/latest');
  }
  const releases = await fetchJSON<ReleaseInfo[]>('https://api.github.com/repos/actonlang/acton/releases');
  const tip = releases.find(r => r.prerelease) || releases[0];
  if (!tip) throw new Error('No releases found for Acton');
  return tip;
}

function pickAssetForPlatform(rel: ReleaseInfo, triple: PlatformTriple): ReleaseAsset | undefined {
  const prefix = assetNamePrefix(triple);
  if (rel.prerelease || rel.tag_name.toLowerCase() === 'tip') {
    const tipAsset = rel.assets.find(a => a.name.startsWith(prefix) && a.name.includes('-tip') && a.name.endsWith('.tar.xz'));
    if (tipAsset) return tipAsset;
  }
  const tarxz = rel.assets.find(a => a.name.startsWith(prefix) && a.name.endsWith('.tar.xz'));
  if (tarxz) return tarxz;
  return undefined;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

async function downloadWithProgress(url: string, dest: string): Promise<void> {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  if (!res.ok || !res.body) throw new Error(`Failed to download: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') || 0);
  const stream = fs.createWriteStream(dest);
  let done = 0;
  const reader = res.body.getReader();
  const progress = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading Acton…', cancellable: true }, async (p, token) => {
    token.onCancellationRequested(() => ctrl.abort());
    try {
      while (true) {
        const { value, done: rdone } = await reader.read();
        if (rdone) break;
        if (value) {
          stream.write(Buffer.from(value));
          done += value.length;
          if (total > 0) p.report({ increment: (value.length / total) * 100 });
        }
      }
    } finally {
      stream.end();
    }
  });
  await progress;
}

function extractTarXz(archive: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const args = ['-xJf', archive, '-C', destDir];
    const proc = spawn('tar', args);
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    proc.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`tar failed (${code}): ${stderr}`));
    });
  });
}

function findBinaryUnder(root: string, name: string): string | undefined {
  const stack: string[] = [root];
  while (stack.length) {
    const d = stack.pop()!;
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === name) return full;
    }
  }
  return undefined;
}

export async function installOrUpdate(context: vscode.ExtensionContext, channel: Channel): Promise<InstallInfo> {
  if (isWindows()) throw new Error('Managed installation is not supported on Windows.');
  const triple = detectPlatform();
  if (!triple) throw new Error('Unsupported platform for Acton managed installation');

  const rel = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Resolving Acton ${channel === 'tip' ? 'tip (prerelease)' : 'latest'}…` }, () => getRelease(channel));
  const asset = pickAssetForPlatform(rel, triple);
  if (!asset) {
    const plat = prettyPlatform(triple);
    throw new Error(`No suitable asset in release ${rel.tag_name} for ${plat}.`);
  }

  const baseDir = vscode.Uri.joinPath(context.globalStorageUri, 'acton').fsPath;
  ensureDir(baseDir);
  const archivePath = path.join(baseDir, asset.name);
  await downloadWithProgress(asset.browser_download_url, archivePath);

  const extractDir = path.join(baseDir, 'current');
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch {}
  ensureDir(extractDir);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Extracting Acton…' }, async () => {
    await extractTarXz(archivePath, extractDir);
  });

  // Locate binaries
  const actonPath = findBinaryUnder(extractDir, process.platform === 'win32' ? 'acton.exe' : 'acton');
  if (!actonPath) throw new Error('Could not locate acton binary after extraction');
  try { fs.chmodSync(actonPath, 0o755); } catch {}
  const lspPath = findBinaryUnder(extractDir, process.platform === 'win32' ? 'lsp-server-acton.exe' : 'lsp-server-acton');
  if (lspPath) {
    try { fs.chmodSync(lspPath, 0o755); } catch {}
  }

  const info: InstallInfo = {
    version: rel.tag_name.replace(/^v/, ''),
    channel,
    platform: triple,
    installedAt: new Date().toISOString(),
    assetName: asset.name,
    installDir: extractDir,
    actonPath,
    lspPath,
  };
  // Determine a user-friendly display version
  info.displayVersion = await computeDisplayVersion(info, rel);
  // Build identifier for update comparisons (esp. tip)
  info.buildId = computeRemoteBuildId(rel, channel, triple) || info.displayVersion || info.version;
  fs.writeFileSync(infoPath(context.globalStorageUri), JSON.stringify(info, null, 2));
  return info;
}

export async function removeManagedInstall(storage: vscode.Uri): Promise<void> {
  const base = vscode.Uri.joinPath(storage, 'acton').fsPath;
  try {
    fs.rmSync(base, { recursive: true, force: true });
  } catch {}
}

async function getBinaryVersion(binPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      const proc = spawn(binPath, ['--version']);
      let out = '';
      proc.stdout.on('data', d => out += d.toString());
      proc.on('error', () => resolve(undefined));
      proc.on('close', () => {
        const line = out.trim().split(/\r?\n/)[0]?.trim() || '';
        const m = line.match(/\d+\.\d+\.\d+(?:[._-]\S+)?/);
        resolve(m ? m[0] : (line || undefined));
      });
    } catch {
      resolve(undefined);
    }
  });
}

function extractVersionFromDebAssets(rel: ReleaseInfo): string | undefined {
  const re = /^acton_([0-9][0-9.]+(?:\.[0-9.]+)?)_/;
  for (const a of rel.assets) {
    const m = a.name.match(re);
    if (m) return m[1];
  }
  return undefined;
}

async function computeDisplayVersion(info: InstallInfo, rel: ReleaseInfo): Promise<string> {
  const v1 = await getBinaryVersion(info.actonPath);
  const v1Clean = (v1 || '').trim();
  const v1HasDigits = /\d/.test(v1Clean);
  if (v1Clean && v1HasDigits) return v1Clean;
  if (info.channel === 'tip') {
    const fromDeb = extractVersionFromDebAssets(rel);
    if (fromDeb) return fromDeb;
  }
  const tag = rel.tag_name?.replace(/^v/, '') || info.version;
  if (tag && tag.toLowerCase() !== 'tip') return tag;
  const updated = rel.assets.find(a => a.name === info.assetName)?.updated_at;
  if (updated) return `tip ${updated.replace('T', ' ').replace('Z', ' UTC')}`;
  return tag || 'tip';
}

export async function ensureDisplayVersion(context: vscode.ExtensionContext, info: InstallInfo): Promise<InstallInfo> {
  try {
    if (!info.displayVersion || !/\d/.test(info.displayVersion)) {
      const rel = await getRelease(info.channel);
      const disp = await computeDisplayVersion(info, rel);
      if (disp && disp !== info.displayVersion) {
        info.displayVersion = disp;
        if (!info.buildId) {
          const triple = detectPlatform();
          info.buildId = computeRemoteBuildId(rel, info.channel, triple || undefined) || disp || info.version;
        }
        fs.writeFileSync(infoPath(context.globalStorageUri), JSON.stringify(info, null, 2));
      }
    }
  } catch {}
  return info;
}

export function computeRemoteBuildId(rel: ReleaseInfo, channel: Channel, triple?: PlatformTriple): string | undefined {
  if (channel === 'latest') return rel.tag_name?.replace(/^v/, '');
  const fromDeb = extractVersionFromDebAssets(rel);
  if (fromDeb) return fromDeb;
  if (triple) {
    const prefix = assetNamePrefix(triple);
    const a = rel.assets.find(x => x.name.startsWith(prefix) && x.name.endsWith('.tar.xz'));
    if (a?.updated_at) return a.updated_at;
  }
  const latest = rel.assets.reduce<string | undefined>((acc, a) => {
    if (!a.updated_at) return acc;
    if (!acc || a.updated_at > acc) return a.updated_at;
    return acc;
  }, undefined);
  return latest || rel.tag_name;
}
