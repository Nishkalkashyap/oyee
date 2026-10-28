#!/usr/bin/env bash
# Runs the OyeeKit tests (Swift Testing).
#
# With only the Command Line Tools installed, SwiftPM's Swift Build backend sometimes fails to find the Swift Testing
# macro plugin ("plugin for module 'TestingMacros' not found") when it compiles test files in parallel. Loading the
# plugin library explicitly makes it deterministic. With Xcode installed, plain `swift test` is fine.
set -euo pipefail
cd "$(dirname "$0")/.."

developer_dir="$(xcode-select -p 2>/dev/null || true)"
plugin=""
for candidate in \
  "${DEVELOPER_DIR:-$developer_dir}/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib" \
  "${DEVELOPER_DIR:-$developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib" \
  "/Library/Developer/CommandLineTools/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib"; do
  if [[ -f "$candidate" ]]; then plugin="$candidate"; break; fi
done

if [[ -n "$plugin" ]]; then
  exec swift test -Xswiftc -load-plugin-library -Xswiftc "$plugin" "$@"
else
  exec swift test "$@"
fi
