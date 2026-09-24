"""Adapter between wrap.js and the vendored token-saver compression engine.

    python3 -I -B ts_adapter.py < request.json > result.json

Request (JSON on stdin):
    {"command": str, "exit_code": int, "stdout": str, "stderr": str}
Result (JSON on stdout, ASCII only):
    {"ok": true, "processor": str, "stdout": str, "stderr": str,
     "redacted": bool, "streams": {"stdout": {...}, "stderr": {...}}}
or {"ok": false, "error": str} on ANY problem. This script never raises and
always exits 0; the caller owns the timeout and falls back to its own engine.

Only the pure compression engine is imported (engine, config, registry,
processors). Nothing that writes to disk or talks to the network is loaded:
no stats database, no audit log, no delta store, no update check. Isolation:
  - HOME points to a directory that does not exist, so ~/.token-saver (config
    file, user processors) is never read and never created;
  - every TOKEN_SAVER_* variable is dropped, and the process runs from "/", so
    no project .token-saver.json above the user's working directory applies;
  - after loading, every configuration value must come from the built-in
    defaults, otherwise the adapter refuses to run (ok: false);
  - `-I -B` on the caller's side: no PYTHON* variables, no user site-packages,
    no bytecode written next to the vendored sources.
The command label is only used to pick a processor; it is never executed.
"""

import json
import os
import sys
import tempfile

MIN_PYTHON = (3, 10)
VENDOR = os.path.join(
    os.path.dirname(os.path.realpath(__file__)),
    "..", "..", "..", "vendor", "token-saver",
)
FORBIDDEN_MODULES = (
    "src.telemetry", "src.tracker", "src.stats", "src.delta_store",
    "src.delta", "src.updater", "src.version_check", "src.cli",
)


def isolate():
    """Cut every path by which on-disk or environment state could leak in."""
    sys.dont_write_bytecode = True
    for key in [k for k in os.environ if k.startswith("TOKEN_SAVER_")]:
        del os.environ[key]
    os.environ["HOME"] = os.path.join(
        tempfile.gettempdir(), "ccx-ts-nohome-%d" % os.getpid()
    )
    os.chdir("/")
    import logging  # pylint: disable=import-outside-toplevel

    logging.disable(logging.CRITICAL)


def load_engine():
    """Import the vendored engine with pure defaults, or raise."""
    sys.path.insert(0, os.path.realpath(VENDOR))
    from src import config  # pylint: disable=import-outside-toplevel

    config.reload()
    sources = config.get("_config_source") or {}
    foreign = sorted(k for k, v in sources.items() if v != "default")
    if foreign:
        raise RuntimeError("non-default configuration: " + ",".join(foreign))
    from src import engine  # pylint: disable=import-outside-toplevel

    loaded = [m for m in FORBIDDEN_MODULES if m in sys.modules]
    if loaded:
        raise RuntimeError("side-effecting module loaded: " + ",".join(loaded))
    return engine.CompressionEngine()


def read_request(raw):
    """Validate the request at the boundary."""
    req = json.loads(raw.decode("utf-8"))
    if not isinstance(req, dict):
        raise ValueError("request must be an object")
    command, exit_code = req.get("command"), req.get("exit_code")
    if not isinstance(command, str) or not command.strip():
        raise ValueError("command must be a non-empty string")
    if isinstance(exit_code, bool) or not isinstance(exit_code, int):
        raise ValueError("exit_code must be an integer")
    streams = {}
    for name in ("stdout", "stderr"):
        value = req.get(name, "")
        if not isinstance(value, str):
            raise ValueError(name + " must be a string")
        streams[name] = value
    return command, exit_code, streams


def compress_streams(eng, command, exit_code, streams):
    """Compress each stream on its own; stdout and stderr never mix."""
    result = {"ok": True, "redacted": False, "streams": {}}
    for name, text in streams.items():
        out, processor, changed, redacted = text, "none", False, False
        if text.strip():
            out, processor, changed = eng.compress(
                command, text, exit_code=exit_code
            )
            redacted = bool((eng.last_event or {}).get("redacted"))
        if not isinstance(out, str):
            raise TypeError("engine returned non-text output")
        result[name] = out
        result["streams"][name] = {
            "processor": processor, "changed": bool(changed),
            "redacted": redacted,
        }
        result["redacted"] = result["redacted"] or redacted
    changed = [
        s["processor"] for s in result["streams"].values() if s["changed"]
    ]
    result["processor"] = changed[0] if changed else "none"
    return result


def main():
    """Read, compress, answer. Every failure becomes {"ok": false}."""
    try:
        if sys.version_info < MIN_PYTHON:
            raise RuntimeError(
                "python >= %d.%d required" % MIN_PYTHON
            )
        raw = sys.stdin.buffer.read()
        isolate()
        command, exit_code, streams = read_request(raw)
        eng = load_engine()
        answer = compress_streams(eng, command, exit_code, streams)
    except BaseException as exc:  # pylint: disable=broad-exception-caught
        answer = {"ok": False, "error": type(exc).__name__ + ": " + str(exc)}
    try:
        data = json.dumps(answer, ensure_ascii=True)
    except BaseException:  # pylint: disable=broad-exception-caught
        data = '{"ok": false, "error": "unserializable result"}'
    sys.stdout.buffer.write(data.encode("ascii"))
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
