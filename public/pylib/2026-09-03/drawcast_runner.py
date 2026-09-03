# drawcast's Python-dialect runner, shared by Brython and MicroPython. Runs a
# script in fresh globals with stdout captured, echoes a trailing expression
# the notebook way, and harvests what the envelope needs: a trailing
# DataFrame as a ruled table, plotly figures (plotly.express, and the
# plotly-backed matplotlib/seaborn emulations), and the {id.path} data
# bridge under the same rules and caps as src/code/harvest.ts.
#
# Dialect-neutral on purpose: no `ast` (MicroPython lacks it), the stdout
# swap is attempted and reported (MicroPython forbids it — the engine reads
# its own buffer instead), tracebacks via `traceback` or
# `sys.print_exception`. Valid CPython too: scripts/pylib-sanity.py runs it
# against the vendored libraries locally.
#
# JS-facing functions (every argument and return is a str):
#   _register_module(name, source) -> '' or a traceback
#   _alias_module(alias, canonical) -> '' or a message
#   _run(code, paths_json) -> json {stdout, stderr, error, table, figures, data, errors}
import sys, json
from io import StringIO

_CAP_N = 5000
_CAP_ROWS = 200
_TABLE_CAP = 30


def _format_exc(e):
    if hasattr(sys, 'print_exception'):        # MicroPython
        buf = StringIO()
        sys.print_exception(e, buf)
        return buf.getvalue()
    import traceback                            # CPython / Brython
    return traceback.format_exc()


class _Mod:
    """MicroPython has no types.ModuleType: a bare namespace object stands in."""
    def __init__(self, name, g):
        self.__name__ = name
        for k in g:
            setattr(self, k, g[k])


def _register_module(name, source):
    """Make `source` importable as `name`; idempotent; '' or a traceback."""
    if name in sys.modules:
        return ''
    try:
        import types
        mod = types.ModuleType(name)
        g = mod.__dict__
    except Exception:
        mod = None
        g = {'__name__': name}
    try:
        exec(compile(source, name + '.py', 'exec'), g)
    except Exception as e:
        return _format_exc(e)
    sys.modules[name] = mod if mod is not None else _Mod(name, g)
    return ''


def _alias_module(alias, canonical):
    """`import alias` -> the registered `canonical`. A dotted alias needs
    its parent registered first; the child is set as the parent's attribute
    so `import a.b as x` binds x."""
    if canonical not in sys.modules:
        return 'unknown module: ' + canonical
    if '.' in alias:
        parent, _, child = alias.rpartition('.')
        if parent not in sys.modules:
            return 'unknown parent module: ' + parent
        setattr(sys.modules[parent], child, sys.modules[canonical])
    sys.modules[alias] = sys.modules[canonical]
    return ''


# -- trailing expression (ported from openstat's runners: no `ast`) ---------

def _split_tail(code):
    """(head_src, tail_src) with tail the final top-level expression, or
    (code, None). Column-0 lines scanned from the end; the first candidate
    whose tail compiles as an expression AND whose head compiles as a
    module wins (a lone ')' or an unindented continuation is skipped)."""
    lines = code.split('\n')
    while lines and lines[-1].strip() == '':
        lines.pop()
    if not lines:
        return code, None
    candidates = []
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if line and line[:1] not in (' ', '\t'):
            candidates.append(i)
            if len(candidates) >= 1000:
                break
    if 0 not in candidates:
        candidates.append(0)
    for i in candidates:
        tail = '\n'.join(lines[i:])
        stripped = tail.strip()
        if not stripped or stripped.startswith('#'):
            continue
        try:
            compile(tail, '<code>', 'eval')
        except SyntaxError:
            continue
        head = '\n'.join(lines[:i]) or 'pass'
        try:
            compile(head, '<code>', 'exec')
        except SyntaxError:
            continue
        return head, tail
    return code, None


def _suppressed(tail):
    """A bare `_name` (matplotlib's `_ = plt.hist(...)` idiom) or a trailing
    ';' asks for silence; the expression still runs."""
    t = tail.split('#', 1)[0].strip() if '#' in tail else tail.strip()
    if t.endswith(';'):
        return True
    if not t.startswith('_'):
        return False
    for ch in t:
        if not (ch == '_' or ch.isalpha() or ch.isdigit()):
            return False
    return True


# -- harvest helpers (the harvest.ts rules) --------------------------------

def _is_df(v):
    return type(v).__name__ == 'DataFrame'


def _is_series(v):
    return type(v).__name__ == 'Series'


def _isna(v):
    if type(v).__name__ in ('NaN', 'NAType', 'NaTType'):
        return True
    return isinstance(v, float) and v != v


def _cell(v):
    return '' if (v is None or _isna(v)) else str(v)


def _table(df):
    cols = [str(c) for c in df.columns]
    rows = [list(r) for r in df.values]
    return {
        'columns': cols,
        'rows': [[_cell(x) for x in r] for r in rows[:_TABLE_CAP]],
        'truncated': max(0, len(rows) - _TABLE_CAP),
    }


def _scalar(v):
    if v is None or _isna(v):
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return None if (f != f or f in (float('inf'), float('-inf'))) else v
    if isinstance(v, str):
        return v
    if hasattr(v, 'item'):
        try:
            return _scalar(v.item())
        except Exception:
            pass
    return str(v)


def _count(v):
    if isinstance(v, (list, tuple)):
        return sum(_count(x) for x in v)
    if isinstance(v, dict):
        if 'rows' in v and 'columns' in v and isinstance(v['rows'], list):
            return len(v['rows']) * max(1, len(v['columns']))
        return sum(_count(x) for x in v.values())
    return 1


def _convert(v):
    if _is_df(v):
        rows = [list(r) for r in v.values]
        if len(rows) > _CAP_ROWS:
            raise ValueError('%d rows, the cap is %d — aggregate or sample in the script' % (len(rows), _CAP_ROWS))
        return {'columns': [str(c) for c in v.columns], 'rows': [[_scalar(x) for x in r] for r in rows]}
    if _is_series(v) or (hasattr(v, 'tolist') and not isinstance(v, (str, bytes))):
        v = v.tolist()
    if isinstance(v, range):
        v = list(v)
    if isinstance(v, (list, tuple)):
        if len(v) > _CAP_N:
            raise ValueError('%d values, the cap is %d — downsample or aggregate in the script' % (len(v), _CAP_N))
        return [_convert(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _convert(x) for k, x in v.items()}
    if v is None or _isna(v) or isinstance(v, (bool, int, float, str)):
        return _scalar(v)
    if hasattr(v, 'item'):
        return _scalar(v)
    raise TypeError('%s is not data (a number, string, list, dict, Series or DataFrame)' % type(v).__name__)


def _harvest_data(g, paths):
    out = {'data': {}, 'errors': {}}
    for p in paths:
        try:
            segs = p.split('.')
            if segs[0] not in g:
                raise NameError('no variable %s' % segs[0])
            obj = g[segs[0]]
            for s in segs[1:]:
                if _is_df(obj) and s in [str(c) for c in obj.columns]:
                    obj = obj[s]
                elif isinstance(obj, dict) and s in obj:
                    obj = obj[s]
                elif hasattr(obj, s):
                    obj = getattr(obj, s)
                else:
                    raise ValueError('no column, key or attribute %s' % s)
            val = _convert(obj)
            n = _count(val)
            if n > _CAP_N:
                raise ValueError('%d values, the cap is %d — downsample or aggregate in the script' % (n, _CAP_N))
            out['data'][p] = val
        except Exception as e:
            out['errors'][p] = '%s' % e
    return out


def _is_figure(v):
    return hasattr(v, 'to_plotly_json_str') and callable(getattr(v, 'to_plotly_json_str', None))


# -- the run ----------------------------------------------------------------

def _run(code, paths_json):
    paths = json.loads(paths_json) if paths_json else []
    g = {'__name__': '__main__'}
    figures = []
    mpl = sys.modules.get('matplotlib_brython')
    if mpl is not None:
        # plt.show() (and savefig) hand the current figure to us instead of
        # printing openstat's embed marker; plt.figure() resets, so several
        # shows are several figures — the `figures: K` beats.
        def _show():
            if mpl._state['traces'] or mpl._state['layout']:
                figures.append(mpl.gcf().to_plotly_json_str())
            mpl._reset()
        mpl.show = _show
        mpl._show = _show
        mpl._reset()
    buf = StringIO()
    ebuf = StringIO()
    old = sys.stdout
    olde = sys.stderr
    captured = True
    try:
        sys.stdout = buf
        sys.stderr = ebuf
    except Exception:
        captured = False                          # MicroPython: engine buffers
    error = ''
    table = None
    tail_value = None
    try:
        head, tail = _split_tail(code)
        if tail is None:
            exec(compile(code, '<code>', 'exec'), g)
        else:
            exec(compile(head, '<code>', 'exec'), g)
            tail_value = eval(compile(tail, '<code>', 'eval'), g)
            if tail_value is not None and not _suppressed(tail):
                if _is_df(tail_value):
                    table = _table(tail_value)
                elif _is_figure(tail_value):
                    pass                          # harvested below
                else:
                    print(tail_value)
    except BaseException as e:
        if not isinstance(e, Exception):
            raise
        error = _format_exc(e)
    finally:
        if captured:
            try:
                sys.stdout = old
                sys.stderr = olde
            except Exception:
                pass
        else:
            # MicroPython flushes a stdout line only on its newline: a partial
            # last line (print(x, end="")) would otherwise surface as the
            # NEXT run's first line — and be cached under the wrong script.
            print()
    if not error:
        if mpl is not None and (mpl._state['traces'] or mpl._state['layout']):
            figures.append(mpl.gcf().to_plotly_json_str())
            mpl._reset()
        seen = []
        for v in list(g.values()) + ([tail_value] if tail_value is not None else []):
            if _is_figure(v) and id(v) not in seen:
                seen.append(id(v))
                try:
                    figures.append(v.to_plotly_json_str())
                except Exception:
                    pass
    env = {'stdout': buf.getvalue() if captured else '', 'stderr': ebuf.getvalue() if captured else '',
           'error': error, 'table': table, 'figures': figures}
    if not error and paths:
        h = _harvest_data(g, paths)
        env['data'] = h['data']
        env['errors'] = h['errors']
    return json.dumps(env)
