# Acton language extension for Visual Studio Code

![Acton Logo](images/Acton-logo.png)

Official editor support for the [Acton Language](http://www.acton-lang.org).

Provides syntax highlighting and optional managed Acton installation.


## Features
- Syntax highlighting
- Managed Acton installation (Linux/macOS)
  - Install from GitHub Releases: choose `latest` (stable) or `tip` (prerelease)
  - Stores binaries under the extension's global storage
  - Status bar shows the installed version
  - Commands: Install/Update, Use System Binary, Show Binary Info, Remove

## Install

Install from the VS Code Extension marketplace.

## Release Notes

### 0.3.0

- Add managed Acton installation and updater
  - Download from GitHub Releases (Linux/macOS)
  - Channel selection: `latest` (stable) or `tip` (prerelease)
  - Update check on startup; configurable via `acton.autoUpdate` (default: `ask`)
  - Uses managed `lsp-server-acton` automatically when default server path is configured
  - Status bar shows installed version
  - New commands: Install/Update, Use System Binary, Show Binary Info, Remove

### 0.2.0

Add basic LSP server. It supports displaying parser diagnostics, i.e. syntax
errors, as tooltips and integrates overall in VS Code for parser errors.

### 0.1.2

Add language default icons for .act files, extension logo.

### 0.1.1

Minor package description & README updates.

### 0.1.0

Initial release of acton-lang language extension for VS Code.

## For more information

* [Acton Language](http://www.acton-lang.org)
