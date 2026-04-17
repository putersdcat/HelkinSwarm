"""HelkinSwarm Python REPL service — stateful per-session sandboxed execution.

Spec: docs/0zj-Code-Execution-Skill-and-Math-Layer.md (Path B)
Issue: #639, #674 (canonical library parity rollout — build trigger v3)

Security model: the container itself is the sandbox (no network, read-only fs
where possible, CPU/memory limits set at Container Apps level). Code-level defense
strips dangerous builtins (__import__, open, eval, exec, compile) from the execution
namespace. Scientific libraries (numpy, pandas, scipy, etc.) are pre-loaded into the
namespace as safe, trusted imports.

Stateful sessions: each session_id maps to a persistent namespace dict. Sessions
expire after SESSION_TTL_S seconds since last use. Cleanup is lazy (evict on lookup).
"""
from __future__ import annotations

import base64
import io
import sys
import threading
import time
import traceback
import uuid
from contextlib import redirect_stdout, redirect_stderr
from typing import Any

# Non-interactive matplotlib backend — must be set before pyplot import
import matplotlib
matplotlib.use("Agg")

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Pre-import scientific libraries — they're available in sandbox namespace by alias
import numpy as np            # noqa: F401
import pandas as pd           # noqa: F401
import scipy                  # noqa: F401
import sympy as sp            # noqa: F401
import matplotlib.pyplot as plt  # noqa: F401
import seaborn as sns         # noqa: F401
import plotly.express as px   # noqa: F401
import statsmodels.api as sm  # noqa: F401

# -----------------------------------------------------------------------------
# Canonical library inventory probe (#674)
# -----------------------------------------------------------------------------
# The gold-standard swarm sandbox (docs/0zj) enumerates a broader Python library
# set than this REPL image ships. The block below probes each canonical library
# at startup and records a structured inventory so:
#   1. /health exposes an honest loaded-vs-missing report
#   2. Deferred libraries are surfaced explicitly instead of failing at runtime
#   3. Agents can read /health and know what tools are actually available
#
# Each entry is (module_name_to_import, package_name_in_pypi, optional_alias).
# Libraries that import cleanly are exposed in the sandbox namespace by alias.
# -----------------------------------------------------------------------------

CANONICAL_LIBRARIES: list[tuple[str, str, str | None]] = [
    # Core numerical (always expected)
    ("numpy", "numpy", "np"),
    ("scipy", "scipy", None),
    ("pandas", "pandas", "pd"),
    ("sympy", "sympy", "sp"),
    ("mpmath", "mpmath", None),
    ("statsmodels.api", "statsmodels", "sm"),
    ("networkx", "networkx", "nx"),
    # Plotting
    ("matplotlib.pyplot", "matplotlib", "plt"),
    ("seaborn", "seaborn", "sns"),
    ("plotly.express", "plotly", "px"),
    # Utilities
    ("tqdm", "tqdm", None),
    ("requests", "requests", None),
    ("ecdsa", "ecdsa", None),
    # Optimization
    ("pulp", "PuLP", None),
    # Astronomy / physics
    ("astropy", "astropy", None),
    ("qutip", "qutip", None),
    ("control", "control", None),
    # Biology / chemistry
    ("Bio", "biopython", None),
    ("pubchempy", "pubchempy", None),
    ("dendropy", "dendropy", None),
    # Games / media
    ("chess", "chess", None),
    ("mido", "mido", None),
    ("midiutil", "MIDIUtil", None),
]

# Libraries intentionally deferred — reported as "deferred" (not "missing")
# so callers know the absence is a design decision, not a bug.
DEFERRED_LIBRARIES: dict[str, str] = {
    "rdkit": "Requires Boost + curated wheels; material image-size impact.",
    "pyscf": "Requires gfortran/BLAS build chain.",
    "pygame": "Requires SDL2 system libraries.",
    "polygon": "Ambiguous PyPI package name; no stable wheel set.",
    "torch": "~2GB image bloat; not justified for current swarm tasks.",
    "snappy": "Requires libsnappy-dev apt package.",
}


def _probe_canonical_inventory() -> dict[str, Any]:
    """Import every canonical library and record status.

    Returns a dict with 'loaded' (list[str]), 'missing' (list[dict]),
    'deferred' (list[dict]), and 'loaded_aliases' (dict[str, str]).
    """
    loaded: list[str] = []
    missing: list[dict[str, str]] = []
    aliases: dict[str, Any] = {}
    for module_name, package_name, alias in CANONICAL_LIBRARIES:
        try:
            mod = __import__(module_name, fromlist=["*"])
            loaded.append(package_name)
            if alias:
                aliases[alias] = mod
            aliases[package_name] = mod
        except Exception as exc:  # noqa: BLE001 — record the failure verbatim
            missing.append({
                "package": package_name,
                "module": module_name,
                "error": f"{type(exc).__name__}: {exc}",
            })
    deferred_report = [
        {"package": pkg, "reason": reason}
        for pkg, reason in DEFERRED_LIBRARIES.items()
    ]
    return {
        "loaded": loaded,
        "missing": missing,
        "deferred": deferred_report,
        "_aliases": aliases,  # private, stripped before returning to callers
    }


_INVENTORY = _probe_canonical_inventory()

# Log inventory at startup so Container Apps log stream shows what's available.
_loaded = _INVENTORY["loaded"]
_missing = _INVENTORY["missing"]
print(
    f"[repl] Canonical library inventory: {len(_loaded)} loaded, "
    f"{len(_missing)} missing, {len(_INVENTORY['deferred'])} deferred",
    file=sys.stderr,
    flush=True,
)
if _missing:
    print(
        "[repl] Missing libraries (unexpected): "
        + ", ".join(m["package"] for m in _missing),
        file=sys.stderr,
        flush=True,
    )
print(
    "[repl] Loaded: " + ", ".join(_loaded),
    file=sys.stderr,
    flush=True,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SESSION_TTL_S = 300      # Session namespace TTL in seconds
MAX_OUTPUT_CHARS = 50_000
MAX_CODE_CHARS = 100_000
MAX_PLOTS = 5            # Limit plots per execution to avoid response bloat

# ---------------------------------------------------------------------------
# Session state (in-memory per-process; survives within a single swarm turn)
# ---------------------------------------------------------------------------

_sessions: dict[str, dict[str, Any]] = {}
_sessions_lock = threading.Lock()
_sessions_last_used: dict[str, float] = {}


def _evict_expired_sessions() -> None:
    """Evict sessions exceeding TTL. Must be called with _sessions_lock held."""
    now = time.monotonic()
    expired = [
        sid for sid, last in _sessions_last_used.items()
        if now - last > SESSION_TTL_S
    ]
    for sid in expired:
        del _sessions[sid]
        del _sessions_last_used[sid]


def _create_sandbox_globals() -> dict[str, Any]:
    """Create a fresh sandbox namespace with safe globals + pre-loaded scientific libs."""
    import numpy as _np
    import pandas as _pd
    import scipy as _scipy
    import sympy as _sp
    import matplotlib.pyplot as _plt
    import seaborn as _sns
    import plotly.express as _px
    import statsmodels.api as _sm

    safe_builtins: dict[str, Any] = {
        # --- Core built-ins ---
        "print": print,
        "len": len,
        "range": range,
        "enumerate": enumerate,
        "zip": zip,
        "map": map,
        "filter": filter,
        "sorted": sorted,
        "reversed": reversed,
        "list": list,
        "tuple": tuple,
        "dict": dict,
        "set": set,
        "frozenset": frozenset,
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "bytes": bytes,
        "bytearray": bytearray,
        "complex": complex,
        "abs": abs,
        "round": round,
        "min": min,
        "max": max,
        "sum": sum,
        "pow": pow,
        "divmod": divmod,
        "isinstance": isinstance,
        "issubclass": issubclass,
        "type": type,
        "repr": repr,
        "hasattr": hasattr,
        "getattr": getattr,
        "setattr": setattr,
        "delattr": delattr,
        "callable": callable,
        "id": id,
        "hash": hash,
        "hex": hex,
        "oct": oct,
        "bin": bin,
        "chr": chr,
        "ord": ord,
        "format": format,
        "vars": vars,
        "dir": dir,
        "iter": iter,
        "next": next,
        "any": any,
        "all": all,
        "NotImplemented": NotImplemented,
        "Ellipsis": Ellipsis,
        "None": None,
        "True": True,
        "False": False,
        # --- Safe exceptions ---
        "Exception": Exception,
        "ValueError": ValueError,
        "TypeError": TypeError,
        "KeyError": KeyError,
        "IndexError": IndexError,
        "AttributeError": AttributeError,
        "RuntimeError": RuntimeError,
        "StopIteration": StopIteration,
        "ZeroDivisionError": ZeroDivisionError,
        "OverflowError": OverflowError,
        "AssertionError": AssertionError,
        "NotImplementedError": NotImplementedError,
        # --- Explicitly blocked (prevent sandbox escapes) ---
        "__import__": None,  # block reimport of system modules
        "open": None,        # block filesystem access
        "eval": None,        # block dynamic evaluation
        "exec": None,        # block dynamic execution
        "compile": None,     # block dynamic compilation
        "input": None,       # block interactive input
        "__loader__": None,
        "__spec__": None,
    }

    return {
        # Scientific libraries as standard aliases
        "np": _np,
        "pd": _pd,
        "scipy": _scipy,
        "sp": _sp,
        "plt": _plt,
        "sns": _sns,
        "px": _px,
        "sm": _sm,
        # Also expose via full names for clarity
        "numpy": _np,
        "pandas": _pd,
        "sympy": _sp,
        "matplotlib": matplotlib,
        "seaborn": _sns,
        "plotly": __import__("plotly"),
        "statsmodels": __import__("statsmodels"),
        # Canonical parity libraries (#674) — injected only if they loaded
        # successfully at startup. Missing ones stay absent so agents see a
        # NameError rather than a silently-nil reference.
        **{
            alias: mod
            for alias, mod in _INVENTORY["_aliases"].items()
            if alias not in {"np", "pd", "sp", "sns", "px", "sm", "numpy",
                             "pandas", "sympy", "matplotlib", "seaborn",
                             "plotly", "statsmodels"}
        },
        "__builtins__": safe_builtins,
        "__name__": "__sandbox__",
    }


def _get_or_create_session(session_id: str) -> dict[str, Any]:
    """Return the namespace dict for session_id, creating it if new."""
    with _sessions_lock:
        _evict_expired_sessions()
        if session_id not in _sessions:
            _sessions[session_id] = _create_sandbox_globals()
        _sessions_last_used[session_id] = time.monotonic()
        return _sessions[session_id]


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------

app = FastAPI(title="HelkinSwarm Python REPL", version="1.0.0")


class ExecuteRequest(BaseModel):
    code: str = Field(..., max_length=MAX_CODE_CHARS, description="Python code to execute")
    session_id: str | None = Field(
        default=None,
        max_length=200,
        description="Session ID for stateful REPL. Omit to create a new session.",
    )
    timeout_s: int = Field(default=30, ge=1, le=120, description="Execution timeout in seconds")


class ExecuteResponse(BaseModel):
    status: str            # "ok" | "error" | "timeout"
    output: str            # stdout + stderr + traceback (if any)
    result: str | None     # repr() of last expression, or None
    plots: list[str]       # base64-encoded PNG images
    execution_ms: int
    session_id: str        # The session ID used (useful when caller didn't set one)
    truncated: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict[str, Any]:
    """Runtime health + canonical library inventory (#674).

    Exposes which libraries from the gold-standard swarm sandbox loaded,
    which are missing unexpectedly, and which are honestly deferred.
    Agents can call this endpoint to understand what is actually available
    before attempting to use a given library.
    """
    return {
        "status": "ok",
        "python_version": sys.version.split()[0],
        "inventory": {
            "loaded": _INVENTORY["loaded"],
            "loaded_count": len(_INVENTORY["loaded"]),
            "missing": _INVENTORY["missing"],
            "deferred": _INVENTORY["deferred"],
        },
    }


@app.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest) -> ExecuteResponse:  # noqa: C901  (complexity OK for REPL dispatch)
    session_id = req.session_id or str(uuid.uuid4())
    namespace = _get_or_create_session(session_id)

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    # Close any existing matplotlib figures before exec so we only capture new ones
    try:
        import matplotlib.pyplot as _plt
        _plt.close("all")
    except Exception:
        pass

    start = time.monotonic()
    result_value: str | None = None
    exec_error: str | None = None
    timed_out = False

    def _exec_thread() -> None:
        nonlocal result_value, exec_error
        try:
            with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
                code = req.code.strip()
                # Try as expression first — this lets callers do `df.describe()` and
                # get the repr in the `result` field without needing an explicit print.
                try:
                    compiled = compile(code, "<sandbox>", "eval")  # noqa: WPS421, S307
                    raw = eval(compiled, namespace)  # noqa: WPS421, S307
                    if raw is not None:
                        result_value = repr(raw)
                except SyntaxError:
                    # Code is a statement block — exec it
                    compiled = compile(code, "<sandbox>", "exec")  # noqa: WPS421, S307
                    exec(compiled, namespace)  # noqa: WPS421, S102
        except Exception:
            exec_error = traceback.format_exc(limit=15)

    t = threading.Thread(target=_exec_thread, daemon=True)
    t.start()
    t.join(timeout=float(req.timeout_s))
    elapsed_ms = int((time.monotonic() - start) * 1000)

    if t.is_alive():
        timed_out = True

    # Capture matplotlib figures generated during execution
    plots: list[str] = []
    try:
        import matplotlib.pyplot as _plt
        for fig_num in _plt.get_fignums()[:MAX_PLOTS]:
            fig = _plt.figure(fig_num)
            buf = io.BytesIO()
            fig.savefig(buf, format="png", bbox_inches="tight", dpi=100)
            buf.seek(0)
            plots.append(base64.b64encode(buf.read()).decode("utf-8"))
        _plt.close("all")
    except Exception:
        pass

    # Assemble output: stdout + stderr + error traceback
    output_parts: list[str] = []
    stdout_text = stdout_buf.getvalue()
    stderr_text = stderr_buf.getvalue()
    if stdout_text:
        output_parts.append(stdout_text)
    if stderr_text:
        output_parts.append("[stderr]\n" + stderr_text)
    if exec_error:
        output_parts.append("[error]\n" + exec_error)
    if timed_out:
        output_parts.append(f"[timeout after {req.timeout_s}s]")

    output = "\n".join(output_parts).strip()
    truncated = len(output) > MAX_OUTPUT_CHARS
    if truncated:
        output = output[:MAX_OUTPUT_CHARS]

    if timed_out:
        status = "timeout"
    elif exec_error:
        status = "error"
    else:
        status = "ok"

    return ExecuteResponse(
        status=status,
        output=output,
        result=result_value,
        plots=plots,
        execution_ms=elapsed_ms,
        session_id=session_id,
        truncated=truncated,
    )
