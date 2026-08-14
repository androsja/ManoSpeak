#!/bin/zsh

set -eu

readonly REPO_ROOT="${0:A:h:h:h}"
readonly SOURCE_DIR="$REPO_ROOT/desktop/macos"
readonly BUILD_ROOT="$REPO_ROOT/build/macos"
readonly APP_NAME="VOZUAL Editor de Señas.app"
readonly APP_PATH="$BUILD_ROOT/$APP_NAME"
readonly CONTENTS="$APP_PATH/Contents"
readonly ICON_SOURCE="$REPO_ROOT/mobile/assets/images/logo_definitivo.png"
readonly TEMP_ROOT="$(mktemp -d /private/tmp/vozual-macos-app.XXXXXX)"

cleanup() {
    rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp "$SOURCE_DIR/Info.plist" "$CONTENTS/Info.plist"
swiftc \
    "$SOURCE_DIR/VOZUALEditor.swift" \
    -o "$CONTENTS/MacOS/VOZUALEditor" \
    -module-cache-path "$TEMP_ROOT/SwiftModuleCache" \
    -framework AppKit \
    -framework AVFoundation
/private/tmp/manospeak-capture-venv/bin/python \
    "$SOURCE_DIR/create_icns.py" \
    "$ICON_SOURCE" \
    "$CONTENTS/Resources/AppIcon.icns"
plutil -lint "$CONTENTS/Info.plist"
codesign --force --deep --sign - "$APP_PATH"
echo "APP=$APP_PATH"
