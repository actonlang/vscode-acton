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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const node_1 = require("vscode-languageclient/node");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const installer_1 = require("./installer");
const platform_1 = require("./platform");
const child_process_1 = require("child_process");
let client;
function activate(context) {
    const log = vscode.window.createOutputChannel('Acton');
    context.subscriptions.push(log);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.command = 'acton.showBinaryInfo';
    status.tooltip = 'Acton toolchain status';
    status.hide();
    context.subscriptions.push(status);
    function showStatus(text) {
        if (text) {
            status.text = text;
            status.show();
        }
        else
            status.hide();
    }
    function statusLabel(info) {
        if (!info)
            return undefined;
        const ver = (info.displayVersion || info.version || '').trim();
        const showTip = info.channel === 'tip' && ver.toLowerCase() !== 'tip';
        return `Acton ${ver} (managed${showTip ? ' tip' : ''})`;
    }
    // Read settings
    const cfgInstall = vscode.workspace.getConfiguration('acton');
    const manageInstallation = cfgInstall.get('manageInstallation', true) ?? true;
    const releaseChannel = cfgInstall.get('releaseChannel', 'latest') ?? 'latest';
    const autoUpdate = cfgInstall.get('autoUpdate', 'ask') ?? 'ask';
    // Resolve language server path
    const cfg = vscode.workspace.getConfiguration('acton.lsp');
    let serverCmd = cfg.get('serverPath', 'lsp-server-acton');
    const debounceMs = cfg.get('debounce', 200);
    if (!path.isAbsolute(serverCmd) && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        const wsRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const localServer = path.join(wsRoot, 'dist', 'bin', 'lsp-server-acton');
        if (fs.existsSync(localServer))
            serverCmd = localServer;
    }
    // Managed install handling
    let managed = (0, installer_1.readInstallInfo)(context.globalStorageUri);
    if (managed) {
        (0, installer_1.ensureDisplayVersion)(context, managed).then(updated => {
            managed = updated;
            const lbl = statusLabel(managed);
            if (lbl)
                showStatus(lbl);
        }).catch(() => { });
    }
    function which(cmd) {
        const envPath = (process.env.PATH || '').split(path.delimiter);
        for (const d of envPath) {
            const c = path.join(d, cmd);
            try {
                if (fs.existsSync(c) && fs.statSync(c).isFile())
                    return c;
            }
            catch { }
        }
        return undefined;
    }
    // If nothing found and allowed, offer managed install
    if (manageInstallation && !managed && !which('acton')) {
        vscode.window.showInformationMessage('Acton not found in PATH. Install a managed Acton toolchain?', 'Install latest', 'Install tip', 'Skip').then(async (sel) => {
            try {
                if (sel === 'Install latest') {
                    managed = await (0, installer_1.installOrUpdate)(context, 'latest');
                    const lbl = statusLabel(managed);
                    if (lbl)
                        showStatus(lbl);
                }
                else if (sel === 'Install tip') {
                    managed = await (0, installer_1.installOrUpdate)(context, 'tip');
                    const lbl = statusLabel(managed);
                    if (lbl)
                        showStatus(lbl);
                }
            }
            catch (e) {
                vscode.window.showErrorMessage(`Acton install failed: ${e?.message || e}`);
            }
        });
    }
    // If managed and default server path, use managed LSP
    const isDefaultServerPath = (p) => !p || p === 'lsp-server-acton';
    if (managed && manageInstallation) {
        const lbl0 = statusLabel(managed);
        if (lbl0)
            showStatus(lbl0);
        if (isDefaultServerPath(serverCmd) && managed.lspPath)
            serverCmd = managed.lspPath;
        // One-time update check on startup
        const chan = managed.channel || releaseChannel;
        (0, installer_1.getRelease)(chan).then(r => {
            const remoteVer = chan === 'tip'
                ? ((0, installer_1.computeRemoteBuildId)(r, 'tip', (0, platform_1.detectPlatform)() || undefined) || 'tip')
                : r.tag_name.replace(/^v/, '');
            const localVer = chan === 'tip' ? (managed?.buildId || managed?.displayVersion || managed?.version) : managed?.version;
            if (remoteVer && localVer && remoteVer !== localVer) {
                if (autoUpdate === 'auto') {
                    (0, installer_1.installOrUpdate)(context, chan).then(async (info) => {
                        managed = info;
                        const lbl = statusLabel(info);
                        if (lbl)
                            showStatus(lbl);
                        vscode.window.showInformationMessage(`Updated Acton to ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
                    }).catch(e => vscode.window.showErrorMessage(`Acton auto-update failed: ${e?.message || e}`));
                }
                else if (autoUpdate === 'ask') {
                    const rem = chan === 'tip' && remoteVer.toLowerCase() !== 'tip' ? `${remoteVer} (tip)` : remoteVer;
                    vscode.window.showInformationMessage(`Acton ${rem} is available. Update now?`, 'Update', 'Later').then(sel => {
                        if (sel === 'Update') {
                            (0, installer_1.installOrUpdate)(context, chan).then(async (info) => {
                                managed = info;
                                const lbl = statusLabel(info);
                                if (lbl)
                                    showStatus(lbl);
                                vscode.window.showInformationMessage(`Updated Acton to ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
                            }).catch(e => vscode.window.showErrorMessage(`Acton update failed: ${e?.message || e}`));
                        }
                    });
                }
            }
        }).catch(() => { });
    }
    else {
        showStatus(undefined);
    }
    // Re-check daily (useful for tip and latest)
    try {
        const msDay = 24 * 60 * 60 * 1000;
        const timer = setInterval(() => {
            try {
                if (!manageInstallation || !managed)
                    return;
                const chan = managed.channel || releaseChannel;
                (0, installer_1.getRelease)(chan).then(r => {
                    const remoteVer = chan === 'tip'
                        ? ((0, installer_1.computeRemoteBuildId)(r, 'tip', (0, platform_1.detectPlatform)() || undefined) || 'tip')
                        : r.tag_name.replace(/^v/, '');
                    const localVer = chan === 'tip' ? (managed?.buildId || managed?.displayVersion || managed?.version) : managed?.version;
                    if (remoteVer && localVer && remoteVer !== localVer) {
                        if (autoUpdate === 'auto') {
                            (0, installer_1.installOrUpdate)(context, chan).then(async (info) => {
                                managed = info;
                                const lbl = statusLabel(info);
                                if (lbl)
                                    showStatus(lbl);
                            }).catch(() => { });
                        }
                        else if (autoUpdate === 'ask') {
                            const rem = chan === 'tip' && remoteVer.toLowerCase() !== 'tip' ? `${remoteVer} (tip)` : remoteVer;
                            vscode.window.showInformationMessage(`Acton ${rem} is available. Update now?`, 'Update', 'Later').then(sel => {
                                if (sel === 'Update')
                                    vscode.commands.executeCommand('acton.installOrUpdate');
                            });
                        }
                    }
                }).catch(() => { });
            }
            catch { }
        }, msDay);
        context.subscriptions.push({ dispose: () => clearInterval(timer) });
    }
    catch { }
    // -------- Build / Run Active File --------
    function findProjectRoot(startPath) {
        try {
            let dir = startPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (!dir)
                return undefined;
            let prev = '';
            while (dir !== prev) {
                const candidates = ['Acton.toml', 'Build.act', 'build.act.json'];
                for (const f of candidates) {
                    try {
                        if (fs.statSync(path.join(dir, f)).isFile())
                            return dir;
                    }
                    catch { }
                }
                prev = dir;
                dir = path.dirname(dir);
            }
        }
        catch { }
        return undefined;
    }
    function moduleNameFromFile(root, filePath) {
        const rel = path.relative(root, filePath);
        const parts = rel.split(path.sep);
        const idx = parts.indexOf('src');
        if (idx >= 0 && idx + 1 < parts.length) {
            const sub = parts.slice(idx + 1).join('/');
            const baseNoExt = sub.replace(/\.act$/i, '');
            return baseNoExt.replace(/\//g, '.');
        }
        return undefined;
    }
    function computeProgramForEditor(wsRoot) {
        const ed = vscode.window.activeTextEditor;
        if (!ed || ed.document.languageId !== 'acton')
            return {};
        const filePath = ed.document.fileName;
        const root = findProjectRoot(path.dirname(filePath)) || wsRoot || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const cwd = root || path.dirname(filePath);
        if (root) {
            const mod = moduleNameFromFile(root, filePath);
            if (mod)
                return { program: path.join(root, 'out', 'bin', mod), cwd };
        }
        // Fallback: binary next to source without extension
        const dir = path.dirname(filePath);
        const base = path.basename(filePath, path.extname(filePath));
        return { program: path.join(dir, base), cwd };
    }
    function getActonCmd() {
        const toolsCfg = vscode.workspace.getConfiguration('acton.tools');
        const override = toolsCfg.get('actoncPath') || toolsCfg.get('actonPath');
        const defaultCmd = 'actonc';
        if ((!override || override === 'acton' || override === 'actonc') && manageInstallation && managed?.actonPath) {
            try {
                const binDir = path.dirname(managed.actonPath);
                const actoncCandidate = path.join(binDir, 'actonc');
                if (fs.existsSync(actoncCandidate))
                    return actoncCandidate;
            }
            catch { }
            return managed.actonPath;
        }
        return override || defaultCmd;
    }
    // -------- Test discovery (VS Code Testing API) --------
    const testController = vscode.tests.createTestController('actonTests', 'Acton Tests');
    context.subscriptions.push(testController);
    const testMeta = new WeakMap();
    const testIndex = new Map();
    const testDiagnostics = vscode.languages.createDiagnosticCollection('acton-tests');
    context.subscriptions.push(testDiagnostics);
    const diagByKey = new Map();
    const failDecorationType = vscode.window.createTextEditorDecorationType({
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        after: {
            margin: '0 0 0 1rem',
            color: 'rgb(255, 92, 92)',
            backgroundColor: 'rgba(255, 92, 92, 0.15)',
            fontWeight: 'bold'
        }
    });
    context.subscriptions.push(failDecorationType);
    const decoByKey = new Map();
    let discoveryInFlight;
    let refreshTimer;
    function moduleToFile(root, modName) {
        const rel = modName.split('.').join(path.sep) + '.act';
        const full = path.join(root, 'src', rel);
        try {
            if (fs.existsSync(full))
                return vscode.Uri.file(full);
        }
        catch { }
        return undefined;
    }
    function parseTestListOutput(text) {
        const modules = new Map();
        let current;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.replace(/\s+$/, '');
            if (!line)
                continue;
            const modMatch = line.match(/^Module\s+(.+):$/);
            if (modMatch) {
                current = modMatch[1].trim();
                if (!modules.has(current))
                    modules.set(current, []);
                continue;
            }
            if (current && /^\s+/.test(line)) {
                const entry = line.trim();
                const label = entry.replace(/\s+\([^)]*\)\s*$/, '');
                modules.get(current).push(label);
            }
        }
        return modules;
    }
    async function runActonTestList(cwd) {
        const actonCmd = getActonCmd();
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(actonCmd, ['test', 'list'], { cwd, env: { ...process.env, NO_COLOR: '1' } });
            let out = '';
            let err = '';
            proc.stdout.on('data', d => { out += d.toString(); });
            proc.stderr.on('data', d => { err += d.toString(); });
            proc.on('close', (code) => {
                if (code === 0)
                    resolve(out + (err ? '\n' + err : ''));
                else
                    reject(new Error(err || out || `acton test list failed with exit code ${code}`));
            });
            proc.on('error', (e) => reject(e));
        });
    }
    function hasAnyTestItems() {
        let has = false;
        testController.items.forEach(() => { has = true; });
        return has;
    }
    function testIndexKey(project, module, name) {
        return [project, module || '', name || ''].join('::');
    }
    function updateDiagnosticsForUri(uri) {
        const key = uri.toString();
        const diags = [];
        for (const entry of diagByKey.values()) {
            if (entry.uri.toString() === key)
                diags.push(entry.diagnostic);
        }
        testDiagnostics.set(uri, diags);
    }
    function setTestDiagnostic(key, uri, range, message) {
        const diag = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        diag.source = 'acton test';
        diagByKey.set(key, { uri, diagnostic: diag });
        updateDiagnosticsForUri(uri);
    }
    function clearTestDiagnostic(key) {
        const entry = diagByKey.get(key);
        if (!entry)
            return;
        diagByKey.delete(key);
        updateDiagnosticsForUri(entry.uri);
    }
    function buildTestMessage(text, uri, range) {
        const msg = new vscode.TestMessage(text);
        if (uri && range)
            msg.location = new vscode.Location(uri, range);
        return msg;
    }
    function reapplyStoredFailures(run, currentKeys, currentProjects) {
        for (const [key, entry] of diagByKey.entries()) {
            if (currentKeys.has(key))
                continue;
            const item = testIndex.get(key);
            if (!item)
                continue;
            const meta = testMeta.get(item);
            if (!meta?.project || !currentProjects.has(meta.project))
                continue;
            const uri = item.uri ?? entry.uri;
            const range = item.range ?? entry.diagnostic.range;
            const msg = buildTestMessage(entry.diagnostic.message, uri, range);
            run.failed(item, msg);
        }
    }
    async function discoverTests(force = false) {
        if (!force && hasAnyTestItems())
            return;
        if (discoveryInFlight)
            return discoveryInFlight;
        discoveryInFlight = (async () => {
            const prevIndex = new Map(testIndex);
            testIndex.clear();
            const newRoots = [];
            const folders = vscode.workspace.workspaceFolders || [];
            const resetChildren = (item) => {
                item.children.forEach(child => item.children.delete(child.id));
            };
            const upsertItem = (key, create) => {
                const existing = prevIndex.get(key);
                if (existing) {
                    resetChildren(existing);
                    return existing;
                }
                return create();
            };
            for (const folder of folders) {
                const wsRoot = folder.uri.fsPath;
                const projRoot = findProjectRoot(wsRoot) || wsRoot;
                const projectFiles = ['Acton.toml', 'Build.act', 'build.act.json'];
                const hasProjectFile = projectFiles.some(f => {
                    try {
                        return fs.existsSync(path.join(projRoot, f));
                    }
                    catch {
                        return false;
                    }
                });
                if (!hasProjectFile)
                    continue;
                let output = '';
                try {
                    output = await runActonTestList(projRoot);
                }
                catch (e) {
                    log.appendLine(`[test] discovery failed in ${projRoot}: ${e?.message || e}`);
                    continue;
                }
                const modules = parseTestListOutput(output);
                if (modules.size === 0)
                    continue;
                const rootKey = testIndexKey(projRoot);
                const rootItem = upsertItem(rootKey, () => testController.createTestItem(`acton:${projRoot}`, path.basename(projRoot), vscode.Uri.file(projRoot)));
                rootItem.label = path.basename(projRoot);
                testMeta.set(rootItem, { project: projRoot });
                testIndex.set(rootKey, rootItem);
                newRoots.push(rootItem);
                for (const [modName, tests] of modules.entries()) {
                    const modUri = moduleToFile(projRoot, modName);
                    const ranges = modUri ? await findTestRangesForFile(modUri) : new Map();
                    const modKey = testIndexKey(projRoot, modName);
                    const modItem = upsertItem(modKey, () => testController.createTestItem(`acton:${projRoot}:${modName}`, modName, modUri));
                    modItem.label = modName;
                    testMeta.set(modItem, { project: projRoot, module: modName });
                    testIndex.set(modKey, modItem);
                    rootItem.children.add(modItem);
                    for (const testName of tests) {
                        const testId = `acton:${projRoot}:${modName}:${testName}`;
                        const testKey = testIndexKey(projRoot, modName, testName);
                        const testItem = upsertItem(testKey, () => testController.createTestItem(testId, testName, modUri));
                        testItem.label = testName;
                        const range = ranges.get(testName);
                        if (range)
                            testItem.range = range;
                        testMeta.set(testItem, { project: projRoot, module: modName, name: testName });
                        testIndex.set(testKey, testItem);
                        modItem.children.add(testItem);
                    }
                }
            }
            testController.items.replace(newRoots);
        })();
        try {
            await discoveryInFlight;
        }
        finally {
            discoveryInFlight = undefined;
        }
    }
    testController.resolveHandler = async () => {
        await discoverTests(false);
    };
    context.subscriptions.push(vscode.commands.registerCommand('acton.refreshTests', async () => {
        await discoverTests(true);
    }));
    function scheduleTestRefresh() {
        if (refreshTimer)
            clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            void discoverTests(true);
        }, 300);
    }
    const actWatcher = vscode.workspace.createFileSystemWatcher('**/src/**/*.act');
    const buildWatcher = vscode.workspace.createFileSystemWatcher('**/Build.act');
    const buildJsonWatcher = vscode.workspace.createFileSystemWatcher('**/build.act.json');
    for (const w of [actWatcher, buildWatcher, buildJsonWatcher]) {
        w.onDidChange(scheduleTestRefresh);
        w.onDidCreate(scheduleTestRefresh);
        w.onDidDelete(scheduleTestRefresh);
        context.subscriptions.push(w);
    }
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(doc => {
        if (doc.languageId !== 'acton')
            return;
        const projRoot = findProjectRoot(path.dirname(doc.fileName)) || path.dirname(doc.fileName);
        const modName = moduleNameFromFile(projRoot, doc.fileName);
        if (!modName)
            return;
        void refreshRangesForModule(projRoot, modName, doc.uri);
    }));
    function collectLeafTests(items, exclude) {
        const excluded = new Set(exclude ? Array.from(exclude) : []);
        const out = [];
        const visit = (item) => {
            if (excluded.has(item))
                return;
            if (item.children.size === 0) {
                out.push(item);
            }
            else {
                item.children.forEach(child => visit(child));
            }
        };
        for (const item of items)
            visit(item);
        return out;
    }
    function parseJsonReport(text) {
        const trimmed = text.trim();
        if (!trimmed)
            return undefined;
        try {
            return JSON.parse(trimmed);
        }
        catch { }
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first >= 0 && last > first) {
            try {
                return JSON.parse(trimmed.slice(first, last + 1));
            }
            catch { }
        }
        return undefined;
    }
    function statusIsPass(status) {
        if (!status)
            return undefined;
        const up = status.toUpperCase();
        if (up.includes('FAIL') || up.includes('ERR'))
            return false;
        if (up.startsWith('OK'))
            return true;
        return undefined;
    }
    function displayTestNameFromRaw(name) {
        let out = name;
        if (out.startsWith('_test_'))
            out = out.slice('_test_'.length);
        if (out.endsWith('_wrapper'))
            out = out.slice(0, -'_wrapper'.length);
        return out;
    }
    async function findTestRangesForFile(uri) {
        const ranges = new Map();
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const text = doc.getText();
            const re = /^(\s*)def\s+(_test_[A-Za-z0-9_]+)\s*\(/gm;
            let m;
            while ((m = re.exec(text)) !== null) {
                const rawName = m[2];
                const name = displayTestNameFromRaw(rawName);
                const defOffset = m.index + (m[1]?.length || 0);
                const pos = doc.positionAt(defOffset);
                ranges.set(name, new vscode.Range(pos, pos));
            }
        }
        catch { }
        return ranges;
    }
    async function refreshRangesForModule(project, modName, uri) {
        if (!uri)
            return;
        const modItem = testIndex.get(testIndexKey(project, modName));
        if (!modItem)
            return;
        const ranges = await findTestRangesForFile(uri);
        modItem.children.forEach(child => {
            const meta = testMeta.get(child);
            if (!meta?.name)
                return;
            const range = ranges.get(meta.name);
            if (range) {
                child.range = range;
                const key = testIndexKey(project, modName, meta.name);
                const entry = diagByKey.get(key);
                if (entry) {
                    entry.diagnostic.range = range;
                    updateDiagnosticsForUri(entry.uri);
                }
            }
            else {
                const key = testIndexKey(project, modName, meta.name);
                clearTestDiagnostic(key);
            }
        });
    }
    const runHandler = async (request, token) => {
        await discoverTests(false);
        const roots = [];
        testController.items.forEach(item => roots.push(item));
        const include = request.include && request.include.length > 0 ? request.include : roots;
        const tests = collectLeafTests(include, request.exclude);
        const currentKeys = new Set();
        const currentProjects = new Set();
        const run = testController.createTestRun(request, undefined, true);
        if (tests.length === 0) {
            run.end();
            return;
        }
        tests.forEach(t => {
            const meta = testMeta.get(t);
            if (meta?.project)
                currentProjects.add(meta.project);
            if (meta?.project && meta?.module && meta?.name) {
                currentKeys.add(testIndexKey(meta.project, meta.module, meta.name));
            }
            run.enqueued(t);
            run.started(t);
        });
        const byProject = new Map();
        for (const test of tests) {
            const meta = testMeta.get(test);
            const project = meta?.project;
            if (!project)
                continue;
            const group = byProject.get(project) || [];
            group.push(test);
            byProject.set(project, group);
        }
        for (const [project, group] of byProject.entries()) {
            const modules = new Set();
            const names = new Set();
            const moduleUris = new Map();
            for (const test of group) {
                const meta = testMeta.get(test);
                if (meta?.module)
                    modules.add(meta.module);
                if (meta?.name)
                    names.add(meta.name);
                if (meta?.module && test.uri)
                    moduleUris.set(meta.module, test.uri);
            }
            for (const modName of modules) {
                await refreshRangesForModule(project, modName, moduleUris.get(modName));
            }
            const args = ['test', '--json'];
            for (const mod of modules)
                args.push('--module', mod);
            for (const name of names)
                args.push('--name', name);
            const actonCmd = getActonCmd();
            run.appendOutput(`$ ${actonCmd} ${args.join(' ')}\n`, undefined, group[0]);
            const proc = (0, child_process_1.spawn)(actonCmd, args, { cwd: project, env: { ...process.env, NO_COLOR: '1' } });
            token.onCancellationRequested(() => {
                try {
                    proc.kill();
                }
                catch { }
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', d => { stdout += d.toString(); });
            proc.stderr.on('data', d => { stderr += d.toString(); });
            const exitCode = await new Promise((resolve) => {
                proc.on('close', (code) => resolve(code ?? 1));
                proc.on('error', () => resolve(1));
            });
            const report = parseJsonReport(stdout);
            if (!report?.tests) {
                run.appendOutput(stderr || stdout || 'Test run produced no JSON output.\n', undefined, group[0]);
                for (const test of group) {
                    const msg = buildTestMessage('actonc test --json did not return JSON output.', test.uri ?? undefined, test.range ?? undefined);
                    run.errored(test, msg);
                }
                continue;
            }
            const parsed = report.tests.reduce((acc, t) => {
                if (!t.module || !t.name)
                    return acc;
                const byMod = acc.get(t.module) || new Map();
                const detailsParts = [];
                if (t.exception)
                    detailsParts.push(t.exception);
                if (t.output)
                    detailsParts.push(t.output);
                const details = detailsParts.length > 0 ? detailsParts.join("\n") : undefined;
                byMod.set(t.name, { status: t.status, details });
                acc.set(t.module, byMod);
                return acc;
            }, new Map());
            for (const test of group) {
                const meta = testMeta.get(test);
                const outcome = meta?.module && meta?.name ? parsed.get(meta.module)?.get(meta.name) : undefined;
                if (!outcome) {
                    const msg = buildTestMessage('Missing test result in actonc JSON output.', test.uri ?? undefined, test.range ?? undefined);
                    run.errored(test, msg);
                    continue;
                }
                const status = outcome?.status;
                const pass = statusIsPass(status);
                if (pass === true) {
                    run.passed(test);
                    if (meta?.project && meta?.module && meta?.name && test.uri) {
                        clearTestDiagnostic(testIndexKey(meta.project, meta.module, meta.name));
                    }
                }
                else if (pass === false) {
                    const msgText = outcome?.details
                        ? outcome.details
                        : (status ? `Test failed (${status}).` : 'Test failed.');
                    const msg = buildTestMessage(msgText, test.uri ?? undefined, test.range ?? undefined);
                    run.failed(test, msg);
                    if (meta?.project && meta?.module && meta?.name && test.uri) {
                        const range = test.range ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
                        setTestDiagnostic(testIndexKey(meta.project, meta.module, meta.name), test.uri, range, msgText);
                    }
                }
                else if (exitCode === 0) {
                    run.passed(test);
                    if (meta?.project && meta?.module && meta?.name && test.uri) {
                        clearTestDiagnostic(testIndexKey(meta.project, meta.module, meta.name));
                    }
                }
                else {
                    const msgText = outcome?.details ? outcome.details : 'Test failed.';
                    const msg = buildTestMessage(msgText, test.uri ?? undefined, test.range ?? undefined);
                    run.failed(test, msg);
                    if (meta?.project && meta?.module && meta?.name && test.uri) {
                        const range = test.range ?? new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
                        setTestDiagnostic(testIndexKey(meta.project, meta.module, meta.name), test.uri, range, msgText);
                    }
                }
            }
        }
        reapplyStoredFailures(run, currentKeys, currentProjects);
        run.end();
    };
    const runProfile = testController.createRunProfile('Run', vscode.TestRunProfileKind.Run, runHandler);
    context.subscriptions.push(runProfile);
    // Gutter run icons will be provided automatically by VS Code when
    // tests have a uri + range set.
    async function buildActiveFile() {
        const ed = vscode.window.activeTextEditor;
        if (!ed || ed.document.languageId !== 'acton') {
            vscode.window.showErrorMessage('Open an Acton (.act) file first.');
            return false;
        }
        const actonCmd = getActonCmd();
        const file = ed.document.fileName;
        const cwd = findProjectRoot(path.dirname(file)) || path.dirname(file);
        const out = log;
        out.clear();
        out.appendLine(`$ ${actonCmd} "${file}"`);
        out.show(true);
        return new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)(actonCmd, [file], { cwd });
            proc.stdout.on('data', d => out.append(d.toString()));
            proc.stderr.on('data', d => out.append(d.toString()));
            proc.on('close', (code) => {
                if (code === 0)
                    out.appendLine('Build succeeded.');
                else
                    out.appendLine(`Build failed with exit code ${code}.`);
                resolve(code === 0);
            });
            proc.on('error', (e) => {
                out.appendLine(`Failed to spawn '${actonCmd}': ${e}`);
                resolve(false);
            });
        });
    }
    async function runActiveFile() {
        const ed = vscode.window.activeTextEditor;
        if (!ed || ed.document.languageId !== 'acton') {
            vscode.window.showErrorMessage('Open an Acton (.act) file first.');
            return;
        }
        const ok = await buildActiveFile();
        if (!ok)
            return;
        const def = computeProgramForEditor();
        if (!def.program) {
            vscode.window.showErrorMessage('Could not determine program path for this .act file (is it under src/?).');
            return;
        }
        const term = vscode.window.createTerminal({ name: 'Acton Run' });
        term.show(true);
        const quoted = def.program.includes(' ') ? `"${def.program}"` : def.program;
        if (def.cwd)
            term.sendText(`cd ${def.cwd.replace(/\s/g, '\\ ')}`);
        term.sendText(quoted);
    }
    context.subscriptions.push(vscode.commands.registerCommand('acton.buildActiveFile', buildActiveFile));
    context.subscriptions.push(vscode.commands.registerCommand('acton.runActiveFile', runActiveFile));
    // -------- Debug (Run) integration via a delegating 'acton' type --------
    function resolveActonBinaryPath() {
        try {
            const cmd = getActonCmd();
            if (path.isAbsolute(cmd))
                return fs.existsSync(cmd) ? cmd : undefined;
            const found = which(cmd) || which('acton');
            if (found)
                return found;
        }
        catch { }
        return undefined;
    }
    function findLldbPluginRelativeToActon() {
        const actonBin = resolveActonBinaryPath();
        if (!actonBin)
            return undefined;
        try {
            const binDir = path.dirname(actonBin);
            const distRoot = path.dirname(binDir);
            const candidate = path.join(distRoot, 'lldb', 'acton.py');
            if (fs.existsSync(candidate))
                return candidate;
        }
        catch { }
        return undefined;
    }
    const actonDebugProvider = {
        provideDebugConfigurations(folder, _token) {
            const wsRoot = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const def = computeProgramForEditor(wsRoot);
            const cfg = {
                name: 'Acton',
                type: 'acton',
                request: 'launch',
                program: def.program,
                cwd: def.cwd || wsRoot
            };
            log.appendLine('[run] provideDebugConfigurations for Acton');
            return [cfg];
        },
        async resolveDebugConfiguration(folder, config, _token) {
            // We delegate to lldb-dap after ensuring build and program path
            log.appendLine(`[run] resolveDebugConfiguration (noDebug=${!!config?.noDebug})`);
            log.show(true);
            const ok = await buildActiveFile();
            if (!ok)
                return undefined;
            const wsRoot = folder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            const def = computeProgramForEditor(wsRoot);
            if (!def.program) {
                vscode.window.showErrorMessage('Could not determine program path for this .act file.');
                return undefined;
            }
            const initCommands = [];
            const pluginPath = findLldbPluginRelativeToActon();
            if (pluginPath) {
                log.appendLine(`[debug] Importing Acton LLDB plugin: ${pluginPath}`);
                initCommands.push(`command script import "${pluginPath}"`);
                initCommands.push('type category enable Acton');
            }
            else {
                log.appendLine('[debug] Acton LLDB plugin not found relative to acton binary');
            }
            const lldbCfg = {
                name: 'Acton',
                type: 'lldb-dap',
                request: 'launch',
                program: def.program,
                cwd: def.cwd || wsRoot,
                console: 'integratedTerminal',
                internalConsoleOptions: 'neverOpen',
                noDebug: !!config?.noDebug,
                initCommands,
                // Ask lldb-dap to format frames via our Python formatter (no ANSI colors here)
                frameFormat: '${script.frame:acton.frame_title}{ at ${file.basename}:${line.number}}\n'
            };
            await vscode.debug.startDebugging(folder, lldbCfg);
            // Cancel the original 'acton' debug session
            return undefined;
        }
    };
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('acton', actonDebugProvider));
    // Start language client
    const serverExecutable = { command: serverCmd, args: [] };
    const serverOptions = { run: serverExecutable, debug: serverExecutable };
    const clientOptions = {
        documentSelector: [{ scheme: 'file', language: 'acton' }],
        initializationOptions: { debounceMs }
    };
    client = new node_1.LanguageClient('actonLanguageServer', 'Acton Language Server', serverOptions, clientOptions);
    context.subscriptions.push(client);
    client.start();
    // Commands for managed installation
    context.subscriptions.push(vscode.commands.registerCommand('acton.installOrUpdate', async () => {
        try {
            const pick = await vscode.window.showQuickPick([
                { label: 'Latest (stable)', value: 'latest' },
                { label: 'Tip (prerelease)', value: 'tip' }
            ], { title: 'Install Acton release channel' });
            if (!pick)
                return;
            const info = await (0, installer_1.installOrUpdate)(context, pick.value);
            managed = info;
            const lbl = statusLabel(info);
            if (lbl)
                showStatus(lbl);
            vscode.window.showInformationMessage(`Installed Acton ${info.displayVersion || info.version}${info.channel === 'tip' ? ' (tip)' : ''}.`);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Acton install/update failed: ${e?.message || e}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('acton.useSystemBinary', async () => {
        try {
            const confLsp = vscode.workspace.getConfiguration('acton.lsp');
            await confLsp.update('serverPath', 'lsp-server-acton', vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Configured to use system Acton language server (lsp-server-acton).');
            showStatus(undefined);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to switch to system binary: ${e?.message || e}`);
        }
    }));
    context.subscriptions.push(vscode.commands.registerCommand('acton.showBinaryInfo', async () => {
        const lines = [];
        lines.push('Acton — Managed Binary Info');
        lines.push('');
        lines.push(`Managed install: ${managed ? 'present' : 'none'}`);
        if (managed) {
            const ver = managed.displayVersion || managed.version;
            const suffix = managed.channel === 'tip' && (ver || '').toLowerCase() !== 'tip' ? ' (tip)' : '';
            lines.push(`version:`);
            lines.push(`  ${ver}${suffix}`);
            lines.push('installDir:');
            lines.push(`  ${managed.installDir}`);
            lines.push('actonPath:');
            lines.push(`  ${managed.actonPath}`);
            if (managed.lspPath) {
                lines.push('lspPath:');
                lines.push(`  ${managed.lspPath}`);
            }
        }
        log.clear();
        log.appendLine(lines.join('\n'));
        log.show(true);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('acton.removeManagedBinary', async () => {
        const ok = await vscode.window.showWarningMessage('Remove managed Acton installation?', { modal: true }, 'Remove');
        if (ok !== 'Remove')
            return;
        try {
            await (0, installer_1.removeManagedInstall)(context.globalStorageUri);
            managed = undefined;
            showStatus(undefined);
            vscode.window.showInformationMessage('Removed managed Acton installation.');
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to remove managed install: ${e?.message || e}`);
        }
    }));
}
function deactivate() {
    return client?.stop();
}
//# sourceMappingURL=extension.js.map