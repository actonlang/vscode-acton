# Use a strict shell for reliability
set shell := ["bash", "-euxo", "pipefail", "-c"]

default: help

help:
    @echo "Available recipes:"
    @echo "  just install       # npm ci"
    @echo "  just compile       # tsc -> out/"
    @echo "  just watch         # tsc --watch"
    @echo "  just clean         # remove out/ and *.vsix"
    @echo "  just package       # build VSIX via npx @vscode/vsce package"
    @echo "  just package-fast  # package without compile (use after compile)"
    @echo "  just all           # install + compile + package"

install:
    npm ci

compile:
    npm run compile

watch:
    npm run watch

clean:
    rm -rf out *.vsix

# Package after compiling (includes TS build)
package: compile
    npx --yes @vscode/vsce package

# Package quickly assuming out/ is already built
package-fast:
    npx --yes @vscode/vsce package

all: install compile package

