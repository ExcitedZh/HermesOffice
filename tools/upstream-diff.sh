# HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0).
# Atribuição original preservada em NOTICE.
#!/usr/bin/env bash
# Classifica o diff do upstream (GenOffice) para o sync do HermesOffice.
# Uso: tools/upstream-diff.sh [upstream/main]
set -uo pipefail
cd "$(dirname "$0")/.."

UPSTREAM="${1:-upstream/main}"
BASE="$(git merge-base HEAD "$UPSTREAM" 2>/dev/null || echo "")"

if [ -z "$BASE" ]; then
  echo "ERRO: não achei merge-base com $UPSTREAM (rode: git fetch upstream)"
  exit 1
fi

echo "== Upstream: $UPSTREAM (base $BASE) =="
echo
echo "-- Commits novos do upstream --"
git log --oneline "$BASE..$UPSTREAM" | head -40
echo
echo "-- Arquivos alterados (classificados) --"
git diff --name-status "$BASE" "$UPSTREAM" | while read -r st file; do
  case "$file" in
    packages/*-engine/*|packages/file-parse/*)      cls="[ENGINE] " ;;
    packages/ai-provider/*|packages/agent-core/*|packages/ai-search/*) cls="[AI-CORE]" ;;
    apps/*/src/main/*|apps/*/src/preload/*|apps/*/src/shared/*) cls="[MAIN]   " ;;
    apps/*/src/renderer/*|packages/ui/*)            cls="[UI]     " ;;
    apps/shell/electron-builder*|.github/*|*.yml|*.yaml|e2e/*|scripts/*) cls="[INFRA]  " ;;
    tools/rebrand*|README*|NOTICE|LICENSE|docs/*)   cls="[FORK]   " ;;
    *)                                              cls="[OUTRO]  " ;;
  esac
  printf '  %s %s %s\n' "$cls" "$st" "$file"
done

echo
echo "== Atenção: camada Hermes tocada? =="
git diff --name-only "$BASE" "$UPSTREAM" | grep -E \
  "ai-provider/src/(providers|stream|chat|types)\.ts|docs-main\.ts|sheets-main\.ts|ai-ipc\.ts|AiPanel\.tsx|shell/src/(main/index|renderer/src/Home)\.(ts|tsx)" \
  && echo "  ^ revisar manualmente (tabela de conflitos no skill hermesoffice-upstream-sync)" \
  || echo "  nenhum arquivo da camada Hermes foi tocado — merge deve ser limpo"

echo
echo "== Rebrand sujo? (nomes antigos no diff) =="
git diff --name-only "$BASE" "$UPSTREAM" | grep -i "genoffice\|genspark" \
  && echo "  ^ rodar: python3 tools/rebrand-hermesoffice.py após o merge" \
  || echo "  nenhum nome antigo no diff — rebrand --check deve passar limpo"
