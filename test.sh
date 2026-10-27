#!/bin/sh
# 테스트 실행. Node 없이 macOS 내장 JavaScriptCore로 돈다.
#   tests/run.mjs  순수 로직·상태 (PRD 요구사항별)
set -e
cd "$(dirname "$0")"

if command -v node >/dev/null 2>&1; then
  RUN="node"
else
  RUN=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
  [ -x "$RUN" ] || { echo "node 또는 jsc가 필요합니다" >&2; exit 1; }
  RUN="$RUN -m"
fi

$RUN tests/run.mjs
