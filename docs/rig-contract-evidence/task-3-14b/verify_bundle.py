#!/usr/bin/env python3
"""Verify the derived-only Task 3.14b bundle's SHA256SUMS.txt."""
from __future__ import annotations
import hashlib
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / 'SHA256SUMS.txt'
FORBIDDEN = {'.blend', '.glb', '.zip'}

def main() -> int:
    if not MANIFEST.is_file():
        print('FAIL: SHA256SUMS.txt is missing')
        return 1
    expected: dict[str, str] = {}
    for line_no, line in enumerate(MANIFEST.read_text(encoding='utf-8').splitlines(), 1):
        if not line.strip():
            continue
        try:
            digest, rel = line.split('  ', 1)
        except ValueError:
            print(f'FAIL: malformed manifest line {line_no}')
            return 1
        p = Path(rel)
        target = (ROOT / p).resolve()
        if p.is_absolute() or ROOT not in target.parents or target.name in {'SHA256SUMS.txt', 'task-3-14b-derived-evidence.tar.gz'}:
            print(f'FAIL: unsafe or excluded manifest path: {rel}')
            return 1
        if p.suffix.lower() in FORBIDDEN:
            print(f'FAIL: forbidden source binary listed: {rel}')
            return 1
        if rel in expected:
            print(f'FAIL: duplicate manifest path: {rel}')
            return 1
        expected[rel] = digest
    actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p.name not in {'SHA256SUMS.txt', 'task-3-14b-derived-evidence.tar.gz', 'RESTORE_VERIFICATION.md'} and '.git' not in p.parts}
    if actual != set(expected):
        print(f'FAIL: file set mismatch; unlisted={sorted(actual-set(expected))}; missing={sorted(set(expected)-actual)}')
        return 1
    for rel, digest in expected.items():
        actual_digest = hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()
        if actual_digest != digest:
            print(f'FAIL: hash mismatch: {rel}')
            return 1
    print(f'BUNDLE.VERIFIED files={len(expected)} forbidden_source_assets=0')
    return 0

if __name__ == '__main__':
    sys.exit(main())
