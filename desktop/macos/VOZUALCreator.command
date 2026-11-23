#!/bin/zsh

set -eu

readonly REPO_ROOT="${0:A:h:h:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

if ! command -v npm >/dev/null 2>&1; then
    osascript -e 'display alert "VOZUAL Creator no puede iniciar" message "No se encontró Node.js con npm. Instálalo y vuelve a abrir VOZUAL Creator." as critical'
    exit 1
fi

cd "$REPO_ROOT/mobile"
exec npm run creator:json
