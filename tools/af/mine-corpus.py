#!/usr/bin/env python3
"""Reproduce docs/design/agent-friendly.md's corpus counts (Reviewer R R-AF P2: the numbers must be re-runnable).
Usage: python3 tools/af/mine-corpus.py <reports-dir>   (default: ../benzo-sol/reports)"""
import glob, os, re, sys, json
from collections import Counter
reports = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "../../../benzo-sol/reports")
rows = []
for f in sorted(glob.glob(os.path.join(reports, "*.md"))):
    for line in open(f, errors="ignore"):
        m = re.match(r'^\|\s*(\d+|P\d-\d+|F\d+|R-AF-\d+|—)\s*\|\s*(P[0-3])\s*\|\s*([^|]*)\|\s*([^|]*)\|', line)
        if m: rows.append({"report": os.path.basename(f), "sev": m.group(2), "where": m.group(3).strip(), "what": m.group(4).strip()})
rulings = sum(len(re.findall(r'^- R\d+ ', open(f).read(), re.M)) for f in glob.glob("docs/PHASE-*.md"))
print(json.dumps({"reports": len(glob.glob(os.path.join(reports, "*.md"))), "findings": len(rows), "by_severity": dict(Counter(r["sev"] for r in rows)), "head_rulings_matched": rulings}, indent=1))
