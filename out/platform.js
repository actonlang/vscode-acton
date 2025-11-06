"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectPlatform = detectPlatform;
exports.assetNamePrefix = assetNamePrefix;
exports.prettyPlatform = prettyPlatform;
exports.isWindows = isWindows;
function detectPlatform() {
    const p = process.platform;
    const a = process.arch;
    if (p === 'linux') {
        if (a === 'x64')
            return { os: 'linux', arch: 'x86_64' };
        if (a === 'arm64')
            return { os: 'linux', arch: 'aarch64' };
    }
    else if (p === 'darwin') {
        if (a === 'x64')
            return { os: 'macos', arch: 'x86_64' };
        if (a === 'arm64')
            return { os: 'macos', arch: 'aarch64' };
    }
    return undefined;
}
function assetNamePrefix(triple) {
    return `acton-${triple.os}-${triple.arch}-`;
}
function prettyPlatform(triple) {
    const osName = triple.os === 'macos' ? 'macOS' : 'Linux';
    const arch = triple.arch === 'x86_64' ? 'x86_64' : 'arm64';
    return `${osName} ${arch}`;
}
function isWindows() {
    return process.platform === 'win32';
}
//# sourceMappingURL=platform.js.map