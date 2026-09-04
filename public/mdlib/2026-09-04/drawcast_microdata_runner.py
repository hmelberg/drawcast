# drawcast's microdata runner: the thin seam between the spec's `code`
# element and m2py.py, the real microdata.no emulator (vendored beside this
# file by scripts/sync-mdlib.mjs).
#
# Deliberately thin. The emulator answers with ONE string in which figures
# and tables ride as `__micro_transform_*__` blocks and failures are LOGGED
# rather than raised — every rule about what that string means lives in
# src/code/microdata-output.ts, where node can test it. This file only:
# puts the snapshot on the path, builds the interpreter once, runs a script,
# and leaves the datasets in `__g` for the shared data harvest
# (src/code/harvest.ts) to read.
#
# Valid CPython too: scripts/mdlib-sanity.py runs it against the vendored
# snapshot locally, which is the only way the Python half gets tested.
#
# JS-facing functions (every argument and return is a str):
#   _md_setup(path)            -> '' or a message
#   _md_install(name, source)  -> '' or a message      (browser: write to the FS)
#   _md_boot(catalog_json, rows) -> '' or a traceback
#   _md_run(code)              -> json {output, error}
import json, os, sys

_DIR = None
_M2PY = None
_CATALOG = None
_ROWS = 200
# The namespace the shared data harvest resolves "{id.path}" against. Mutated
# in place, never rebound, so the harvest reads the same dict this module
# exported into the interpreter's globals.
__g = {}


def _format_exc():
    import traceback
    return traceback.format_exc()


def _md_setup(path):
    """Point the runner at the vendored snapshot and make it importable."""
    global _DIR
    if not os.path.isdir(path):
        return 'no mdlib at ' + str(path)
    _DIR = os.path.abspath(path)
    if _DIR not in sys.path:
        sys.path.insert(0, _DIR)
    return ''


def _md_install(name, source):
    """Write one vendored file into the snapshot directory (pyodide's FS)."""
    if _DIR is None:
        return 'call _md_setup first'
    try:
        target = os.path.join(_DIR, *name.split('/'))
        parent = os.path.dirname(target)
        if parent and not os.path.isdir(parent):
            os.makedirs(parent, exist_ok=True)
        mode = 'wb' if isinstance(source, (bytes, bytearray)) else 'w'
        with open(target, mode) as f:
            f.write(source)
        return ''
    except Exception:
        return _format_exc()


def _md_boot(catalog_json, rows):
    """Import the emulator once and parse the variable catalogue once. The
    interpreter itself is built per run — see _md_run."""
    global _M2PY, _CATALOG, _ROWS
    if _M2PY is not None:
        return ''
    prev = os.getcwd()
    try:
        # m2py's top-level `from mockdata_core import …` and `from functions
        # import …` resolve from the snapshot directory.
        os.chdir(_DIR)
        import m2py
        # Explicit, not inherited: the emulator's own default is off today,
        # but a tutorial that teaches the LANGUAGE must not have its output
        # quietly reshaped by a disclosure rule an upstream release turns on.
        # A script can still opt in with `// m2py: dc=on`.
        m2py.M2PY_DISCLOSURE_CONTROL = '0'
        catalog = json.loads(catalog_json) if catalog_json else None
        if isinstance(catalog, dict) and 'variables' in catalog:
            catalog = catalog['variables']
        _CATALOG = catalog
        _ROWS = int(rows)
        _M2PY = m2py
        return ''
    except Exception:
        return _format_exc()
    finally:
        os.chdir(prev)


def _md_run(code):
    """Run one script in a FRESH interpreter. A failed COMMAND is in `output`;
    only a failure of the runner itself is `error`."""
    out = {'output': '', 'error': ''}
    if _M2PY is None:
        out['error'] = 'not booted'
        return json.dumps(out)
    # The emulator opens `codelists/*.json` relative to the working directory.
    # Scoped to the run and restored after it: a `python` code element in the
    # same figure shares this pyodide and must keep its own cwd.
    prev = os.getcwd()
    e = None
    try:
        os.chdir(_DIR)
        # A fresh interpreter per run, for the same reason pyodide.ts gives
        # every python script fresh globals: the result cache is keyed by the
        # SCRIPT, so a run that could see an earlier run's datasets would be
        # cached under a key that never mentions them — and would then replay
        # wrongly the moment the two figures are drawn in the other order.
        e = _M2PY.MicroInterpreter(catalog=_CATALOG)
        e.data_engine.default_rows = _ROWS
        out['output'] = e.run_script(code or '')
    except Exception:
        out['error'] = _format_exc()
    finally:
        os.chdir(prev)
    # The data bridge: every dataset by name, plus `df` for the active one.
    try:
        __g.clear()
        if e is not None:
            e.sync_datasets_to_globals(__g)
    except Exception:
        pass
    return json.dumps(out)
