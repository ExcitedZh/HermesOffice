# HermesOffice — fork de GenOffice (genspark-ai/genoffice, Apache-2.0,
# Copyright 2026 Mainfunc, Inc.). Modificações do fork por criptogus;
# atribuição original preservada em NOTICE.
#!/usr/bin/env python3
"""Troca o corpo do componente GensparkMark pelo HermesMark (badge H) em
todos os apps (docs/sheets/slides). Mantém a assinatura (size prop) para
não quebrar os usos."""
import re
from pathlib import Path

NEW = '''export function GensparkMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="hermes-mark-grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6E4FF6" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="6" fill="url(#hermes-mark-grad)" />
      <path d="M7.25 6.25v11.5M16.75 6.25v11.5M7.25 12h9.5" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}'''

PATTERN = re.compile(
    r"export function GensparkMark\([^)]*\) \{\s*return \(\s*<svg.*?</svg>\s*\)\s*\n\}",
    re.DOTALL,
)

FILES = [
    "apps/docs/src/renderer/components/icons.tsx",
    "apps/sheets/src/renderer/ribbon-icons.tsx",
    "apps/slides/src/renderer/components/icons.tsx",
]

for rel in FILES:
    p = Path(rel)
    text = p.read_text(encoding="utf-8")
    new_text, n = PATTERN.subn(NEW, text, count=1)
    if n == 1:
        p.write_text(new_text, encoding="utf-8")
        print(f"OK  {rel}")
    else:
        print(f"ERR {rel}: padrão não encontrado")
