#!/usr/bin/env python3
"""Adiciona header de atribuição do fork nos arquivos da camada Hermes.

Idempotente: pula arquivos que já contêm a marca do header. Prefixa o
comentário no topo (válido antes de imports/docstrings em TS/PY/SH).
"""
from pathlib import Path

MARK = "fork de GenOffice"
HEADER_TS = """/**
 * HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0,
 * Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
 * atribuição original preservada em NOTICE.
 */
"""
HEADER_PY = """# HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0,
# Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
# atribuição original preservada em NOTICE.
"""
HEADER_SH = """# HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0).
# Atribuição original preservada em NOTICE.
"""

TS_FILES = [
    "packages/ai-provider/src/providers.ts",
    "packages/ai-provider/src/stream.ts",
    "packages/ai-provider/src/chat.ts",
    "packages/ai-provider/src/types.ts",
    "apps/docs/src/main/docs-main.ts",
    "apps/sheets/src/main/sheets-main.ts",
    "apps/slides/src/main/ai-ipc.ts",
    "apps/docs/src/renderer/ai/AiPanel.tsx",
    "apps/shell/src/main/index.ts",
    "apps/shell/src/renderer/src/Home.tsx",
    "apps/docs/src/renderer/components/icons.tsx",
    "apps/sheets/src/renderer/ribbon-icons.tsx",
    "apps/slides/src/renderer/components/icons.tsx",
]
PY_FILES = ["tools/rebrand-hermesoffice.py", "tools/hermesmark-swap.py"]
SH_FILES = ["tools/upstream-diff.sh"]

for rel in TS_FILES:
    p = Path(rel)
    t = p.read_text(encoding="utf-8")
    if MARK in t:
        print(f"skip {rel}"); continue
    p.write_text(HEADER_TS + t, encoding="utf-8")
    print(f"OK   {rel}")

for rel in PY_FILES:
    p = Path(rel)
    t = p.read_text(encoding="utf-8")
    if MARK in t:
        print(f"skip {rel}"); continue
    p.write_text(HEADER_PY + t, encoding="utf-8")
    print(f"OK   {rel}")

for rel in SH_FILES:
    p = Path(rel)
    t = p.read_text(encoding="utf-8")
    if MARK in t:
        print(f"skip {rel}"); continue
    p.write_text(HEADER_SH + t, encoding="utf-8")
    print(f"OK   {rel}")
