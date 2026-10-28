#!/usr/bin/env bash
# Best-effort compile check of the iOS code WITHOUT the iOS SDK: builds HeraldKit for Mac Catalyst
# (`arm64-apple-ios17.0-macabi`, where `os(iOS)` is true and UIKit/BackgroundTasks exist) and typechecks iOS/*.swift
# against it in Swift 6 mode. It catches most errors but is not a substitute for building with Xcode.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -z "${DEVELOPER_DIR:-}" ]] && ! xcrun --find swift >/dev/null 2>&1; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
SDK="$(xcrun --sdk macosx --show-sdk-path)"
SCRATCH="${TMPDIR:-/tmp}/herald-catalyst"

echo "==> Building HeraldKit for Mac Catalyst"
swift build --target HeraldKit --triple arm64-apple-ios17.0-macabi --scratch-path "$SCRATCH"

echo "==> Typechecking iOS/*.swift (Swift 6)"
swiftc -typecheck -swift-version 6 -parse-as-library \
  -target arm64-apple-ios17.0-macabi -sdk "$SDK" \
  -Fsystem "$SDK/System/iOSSupport/System/Library/Frameworks" \
  -I "$SDK/System/iOSSupport/usr/lib/swift" \
  -I "$SCRATCH/out/Products/Debug-maccatalyst" \
  iOS/*.swift
echo "OK"
