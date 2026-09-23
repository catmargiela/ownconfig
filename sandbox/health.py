"""Health checks for the whole Claude Code setup.

Every check returns (status, summary, detail) where status is "ok", "warn" or
"fail". Checks only read state; none of them changes the configuration.
Settings files are never printed: only the values a check needs are parsed.
"""
import json
import re
import subprocess
from pathlib import Path

from runner import REPO

HOME = Path.home()
STATUSLINE = HOME / ".claude" / "statusline.sh"

SAMPLE_STATUS = {
    "workspace": {"current_dir": str(REPO)},
    "model": {"display_name": "Opus 5.5 (1M context)"},
    "effort": {"level": "medium"},
    "context_window": {"used_percentage": 42},
    "cost": {"total_cost_usd": 3.21, "total_duration_ms": 5400000,
             "total_lines_added": 120, "total_lines_removed": 18},
    "rate_limits": {"five_hour": {"used_percentage": 57},
                    "seven_day": {"used_percentage": 83}},
    "prompt_cache": {"hit_ratio": 0.93},
}


def _run(args, timeout=120, stdin=None, cwd=None):
    try:
        proc = subprocess.run(args, capture_output=True, text=True,
                              timeout=timeout, input=stdin, cwd=cwd)
        return proc.returncode, (proc.stdout + proc.stderr).strip()
    except FileNotFoundError:
        return 127, "commande introuvable : " + args[0]
    except subprocess.TimeoutExpired:
        return 124, "délai dépassé"


def check_tests():
    code, out = _run(["node", str(REPO / "test.js")], cwd=str(REPO))
    match = re.search(r"(\d+) réussis, (\d+) échoués sur (\d+)", out)
    if not match:
        return "fail", "résultat illisible", out[-2000:]
    failed = int(match.group(2))
    status = "ok" if code == 0 and failed == 0 else "fail"
    return status, match.group(0), out[-2000:]


def check_plugin():
    code, out = _run(["claude", "plugin", "validate", "--strict",
                      str(REPO / "plugins" / "rebenga")])
    return ("ok" if code == 0 else "fail"), out.splitlines()[-1] if out else "?", out


def check_version():
    code, out = _run(["claude", "--version"])
    return ("ok" if code == 0 else "fail"), out.split("\n")[0], out


def check_github_mcp():
    code, out = _run(["claude", "mcp", "get", "github"], cwd=str(HOME))
    line = next((l.strip() for l in out.splitlines() if "Status" in l), "")
    if "Connected" in line:
        return "ok", line, out
    return ("warn" if code == 0 else "fail"), line or "serveur non configuré", out


def check_plugin_cost():
    code, out = _run(["claude", "plugin", "details", "rebenga@ownconfig"], cwd=str(HOME))
    line = next((l.strip() for l in out.splitlines() if "Always-on" in l), "")
    if code != 0 or not line:
        return "warn", "plugin rebenga non installé", out
    return "ok", line, out


def check_statusline():
    if not STATUSLINE.exists():
        return "warn", "pas de ~/.claude/statusline.sh", ""
    code, out = _run(["bash", str(STATUSLINE)], stdin=json.dumps(SAMPLE_STATUS), timeout=10)
    return ("ok" if code == 0 and out else "fail"), "rendu avec des données d'exemple", out


CHECKS = [
    ("Tests de la config (test.js)", check_tests),
    ("Plugin rebenga (validate --strict)", check_plugin),
    ("Version de Claude Code", check_version),
    ("Serveur MCP GitHub", check_github_mcp),
    ("Coût permanent du plugin", check_plugin_cost),
    ("Barre de statut", check_statusline),
]
