"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readInstallInfo = readInstallInfo;
exports.getRelease = getRelease;
exports.installOrUpdate = installOrUpdate;
exports.removeManagedInstall = removeManagedInstall;
exports.ensureDisplayVersion = ensureDisplayVersion;
exports.computeRemoteBuildId = computeRemoteBuildId;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const platform_1 = require("./platform");
function infoPath(storage) {
    return vscode.Uri.joinPath(storage, 'acton', 'install.json').fsPath;
}
function readInstallInfo(storage) {
    try {
        const txt = fs.readFileSync(infoPath(storage), 'utf8');
        const info = JSON.parse(txt);
        if (info && fs.existsSync(info.actonPath))
            return info;
    }
    catch { }
    return undefined;
}
async function fetchJSON(url) {
    const res = await fetch(url, { headers: { 'Accept': 'application/vnd.github+json' } });
    if (!res.ok)
        throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json();
}
async function getRelease(channel) {
    if (channel === 'latest') {
        return fetchJSON('https://api.github.com/repos/actonlang/acton/releases/latest');
    }
    const releases = await fetchJSON('https://api.github.com/repos/actonlang/acton/releases');
    const tip = releases.find(r => r.prerelease) || releases[0];
    if (!tip)
        throw new Error('No releases found for Acton');
    return tip;
}
function pickAssetForPlatform(rel, triple) {
    const prefix = (0, platform_1.assetNamePrefix)(triple);
    if (rel.prerelease || rel.tag_name.toLowerCase() === 'tip') {
        const tipAsset = rel.assets.find(a => a.name.startsWith(prefix) && a.name.includes('-tip') && a.name.endsWith('.tar.xz'));
        if (tipAsset)
            return tipAsset;
    }
    const tarxz = rel.assets.find(a => a.name.startsWith(prefix) && a.name.endsWith('.tar.xz'));
    if (tarxz)
        return tarxz;
    return undefined;
}
function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}
async function downloadWithProgress(url, dest) {
    const ctrl = new AbortController();
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok || !res.body)
        throw new Error(`Failed to download: HTTP ${res.status}`);
    const total = Number(res.headers.get('content-length') || 0);
    const stream = fs.createWriteStream(dest);
    let done = 0;
    const reader = res.body.getReader();
    const progress = vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading Acton…', cancellable: true }, async (p, token) => {
        token.onCancellationRequested(() => ctrl.abort());
        try {
            while (true) {
                const { value, done: rdone } = await reader.read();
                if (rdone)
                    break;
                if (value) {
                    stream.write(Buffer.from(value));
                    done += value.length;
                    if (total > 0)
                        p.report({ increment: (value.length / total) * 100 });
                }
            }
        }
        finally {
            stream.end();
        }
    });
    await progress;
}
function extractTarXz(archive, destDir) {
    return new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const args = ['-xJf', archive, '-C', destDir];
        const proc = spawn('tar', args);
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`tar failed (${code}): ${stderr}`));
        });
    });
}
function findBinaryUnder(root, name) {
    const stack = [root];
    while (stack.length) {
        const d = stack.pop();
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const e of entries) {
            const full = path.join(d, e.name);
            if (e.isDirectory())
                stack.push(full);
            else if (e.isFile() && e.name === name)
                return full;
        }
    }
    return undefined;
}
async function installOrUpdate(context, channel) {
    if ((0, platform_1.isWindows)())
        throw new Error('Managed installation is not supported on Windows.');
    const triple = (0, platform_1.detectPlatform)();
    if (!triple)
        throw new Error('Unsupported platform for Acton managed installation');
    const rel = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Resolving Acton ${channel === 'tip' ? 'tip (prerelease)' : 'latest'}…` }, () => getRelease(channel));
    const asset = pickAssetForPlatform(rel, triple);
    if (!asset) {
        const plat = (0, platform_1.prettyPlatform)(triple);
        throw new Error(`No suitable asset in release ${rel.tag_name} for ${plat}.`);
    }
    const baseDir = vscode.Uri.joinPath(context.globalStorageUri, 'acton').fsPath;
    ensureDir(baseDir);
    const archivePath = path.join(baseDir, asset.name);
    await downloadWithProgress(asset.browser_download_url, archivePath);
    const extractDir = path.join(baseDir, 'current');
    try {
        fs.rmSync(extractDir, { recursive: true, force: true });
    }
    catch { }
    ensureDir(extractDir);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Extracting Acton…' }, async () => {
        await extractTarXz(archivePath, extractDir);
    });
    // Locate binaries
    const actonPath = findBinaryUnder(extractDir, process.platform === 'win32' ? 'acton.exe' : 'acton');
    if (!actonPath)
        throw new Error('Could not locate acton binary after extraction');
    try {
        fs.chmodSync(actonPath, 0o755);
    }
    catch { }
    const lspPath = findBinaryUnder(extractDir, process.platform === 'win32' ? 'lsp-server-acton.exe' : 'lsp-server-acton');
    if (lspPath) {
        try {
            fs.chmodSync(lspPath, 0o755);
        }
        catch { }
    }
    const info = {
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
async function removeManagedInstall(storage) {
    const base = vscode.Uri.joinPath(storage, 'acton').fsPath;
    try {
        fs.rmSync(base, { recursive: true, force: true });
    }
    catch { }
}
async function getBinaryVersion(binPath) {
    return new Promise((resolve) => {
        try {
            const proc = (0, child_process_1.spawn)(binPath, ['--version']);
            let out = '';
            proc.stdout.on('data', d => out += d.toString());
            proc.on('error', () => resolve(undefined));
            proc.on('close', () => {
                const line = out.trim().split(/\r?\n/)[0]?.trim() || '';
                const m = line.match(/\d+\.\d+\.\d+(?:[._-]\S+)?/);
                resolve(m ? m[0] : (line || undefined));
            });
        }
        catch {
            resolve(undefined);
        }
    });
}
function extractVersionFromDebAssets(rel) {
    const re = /^acton_([0-9][0-9.]+(?:\.[0-9.]+)?)_/;
    for (const a of rel.assets) {
        const m = a.name.match(re);
        if (m)
            return m[1];
    }
    return undefined;
}
async function computeDisplayVersion(info, rel) {
    const v1 = await getBinaryVersion(info.actonPath);
    const v1Clean = (v1 || '').trim();
    const v1HasDigits = /\d/.test(v1Clean);
    if (v1Clean && v1HasDigits)
        return v1Clean;
    if (info.channel === 'tip') {
        const fromDeb = extractVersionFromDebAssets(rel);
        if (fromDeb)
            return fromDeb;
    }
    const tag = rel.tag_name?.replace(/^v/, '') || info.version;
    if (tag && tag.toLowerCase() !== 'tip')
        return tag;
    const updated = rel.assets.find(a => a.name === info.assetName)?.updated_at;
    if (updated)
        return `tip ${updated.replace('T', ' ').replace('Z', ' UTC')}`;
    return tag || 'tip';
}
async function ensureDisplayVersion(context, info) {
    try {
        if (!info.displayVersion || !/\d/.test(info.displayVersion)) {
            const rel = await getRelease(info.channel);
            const disp = await computeDisplayVersion(info, rel);
            if (disp && disp !== info.displayVersion) {
                info.displayVersion = disp;
                if (!info.buildId) {
                    const triple = (0, platform_1.detectPlatform)();
                    info.buildId = computeRemoteBuildId(rel, info.channel, triple || undefined) || disp || info.version;
                }
                fs.writeFileSync(infoPath(context.globalStorageUri), JSON.stringify(info, null, 2));
            }
        }
    }
    catch { }
    return info;
}
function computeRemoteBuildId(rel, channel, triple) {
    if (channel === 'latest')
        return rel.tag_name?.replace(/^v/, '');
    const fromDeb = extractVersionFromDebAssets(rel);
    if (fromDeb)
        return fromDeb;
    if (triple) {
        const prefix = (0, platform_1.assetNamePrefix)(triple);
        const a = rel.assets.find(x => x.name.startsWith(prefix) && x.name.endsWith('.tar.xz'));
        if (a?.updated_at)
            return a.updated_at;
    }
    const latest = rel.assets.reduce((acc, a) => {
        if (!a.updated_at)
            return acc;
        if (!acc || a.updated_at > acc)
            return a.updated_at;
        return acc;
    }, undefined);
    return latest || rel.tag_name;
}
//# sourceMappingURL=installer.js.map