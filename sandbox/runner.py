"""Run hook scenarios against the real dispatcher, fully isolated.

Every run gets a throw-away HOME (so hook state, the Obsidian vault bridge and
the context monitor never touch the real machine) and a throw-away working
directory. Each scenario uses its own session id, so once-per-session gates
behave as on a first attempt.
"""
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DISPATCH = REPO / "hooks" / "dispatch.js"
PROFILES = ("minimal", "standard", "strict")


class Sandbox:
    """A temporary HOME + working directory, removed on close()."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="ccx-sandbox-"))
        self.home = self.root / "home"
        self.cwd = self.root / "work"
        self.home.mkdir()
        (self.cwd / "migrations").mkdir(parents=True)
        (self.cwd / "src").mkdir()
        (self.cwd / "src" / "app.js").write_text("console.log('hi')\n")

    def env(self, profile):
        env = dict(os.environ)
        env.update({
            "HOME": str(self.home),
            "CC_PROFILE": profile,
            "CC_VAULT_DISABLED": "1",
            "CC_CONTEXT_MONITOR": "off",
            "CCX_NO_TYPECHECK": "1",
        })
        for key in ("CCX_DISABLED", "CCX_ALLOW_CONFIG", "CCX_ALLOW_MIGRATION"):
            env.pop(key, None)
        return env

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


def _payload(call, sandbox):
    tool_input = dict(call["tool_input"])
    if "file_path" in tool_input:
        tool_input["file_path"] = str(sandbox.cwd / tool_input["file_path"])
    return {
        "session_id": "sandbox-" + uuid.uuid4().hex[:12],
        "cwd": str(sandbox.cwd),
        "hook_event_name": "PreToolUse",
        "tool_name": call["tool_name"],
        "tool_input": tool_input,
    }


def _warning_text(stdout):
    try:
        data = json.loads(stdout)
    except ValueError:
        return ""
    return data.get("systemMessage", "") if isinstance(data, dict) else ""


def run_call(call, profile, sandbox):
    """Run one tool call through the dispatcher and classify the result."""
    proc = subprocess.run(
        ["node", str(DISPATCH), call["event"]],
        input=json.dumps(_payload(call, sandbox)),
        capture_output=True, text=True, cwd=str(sandbox.cwd),
        env=sandbox.env(profile), timeout=30,
    )
    warning = _warning_text(proc.stdout.strip())
    if proc.returncode == 2:
        verdict, message = "refus", proc.stderr.strip()
    elif proc.returncode == 0 and warning:
        verdict, message = "avert", warning
    elif proc.returncode == 0:
        verdict, message = "ok", ""
    else:
        verdict, message = "erreur", (proc.stderr or proc.stdout).strip()
    return {"code": proc.returncode, "verdict": verdict, "message": message}


def run_scenarios(scenarios, profile="standard"):
    """Run every scenario in one sandbox; yields (scenario, result) pairs."""
    sandbox = Sandbox()
    try:
        for sc in scenarios:
            result = run_call(sc["call"], sc["profile"] or profile, sandbox)
            result["pass"] = result["verdict"] == sc["expect"]
            yield sc, result
    finally:
        sandbox.close()
