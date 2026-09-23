#!/usr/bin/env python3
"""Sandbox for the Claude Code config: hook scenarios + health checks.

    /usr/bin/python3 sandbox/app.py          # Tkinter GUI
    /usr/bin/python3 sandbox/app.py --cli    # same checks, printed (CI-friendly)

Hooks run against this checkout's dispatcher in a throw-away HOME, so the real
state, vault and projects are never touched.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from health import CHECKS  # noqa: E402  (path set above)
from runner import run_scenarios  # noqa: E402
from scenarios import SCENARIOS  # noqa: E402

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def cli():
    passed = 0
    print("== Hooks (profil standard)")
    for sc, res in run_scenarios(SCENARIOS):
        passed += res["pass"]
        print("%s %-13s %-36s attendu=%-6s obtenu=%s" % (
            "✓" if res["pass"] else "✗", sc["category"], sc["name"], sc["expect"], res["verdict"]))
    print("%d/%d conformes\n" % (passed, len(SCENARIOS)))
    print("== Santé")
    worst = 0
    for name, fn in CHECKS:
        status, summary, detail = fn()
        worst = max(worst, {"ok": 0, "warn": 1, "fail": 2}[status])
        print("%-8s %-36s %s" % (status, name, summary))
        if name == "Barre de statut" and detail:
            print("         " + ANSI.sub("", detail))
    return 0 if passed == len(SCENARIOS) and worst < 2 else 1


def gui():
    import tkinter as tk
    from tkinter import ttk
    from gui_health import HealthTab
    from gui_hooks import HooksTab

    root = tk.Tk()
    root.title("Sandbox — config Claude Code")
    root.geometry("900x720")
    tabs = ttk.Notebook(root)
    tabs.add(HooksTab(tabs), text="Hooks")
    tabs.add(HealthTab(tabs), text="Santé")
    tabs.pack(fill="both", expand=True)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(cli() if "--cli" in sys.argv else gui())
