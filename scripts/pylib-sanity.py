# Runs drawcast_runner.py + the vendored libraries under local CPython, the
# way the browser will (module registration, then _run). Not shipped; a
# developer check before the browser smoke:
#   python3 scripts/pylib-sanity.py          # the Brython set
#   python3 scripts/pylib-sanity.py --mpy    # the MicroPython set
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public', 'pylib', '2026-09-03')
MPY = '--mpy' in sys.argv
SUB = 'micropython' if MPY else 'brython'
LIBS = ([('pandas_mpy', ['pandas']), ('plotly_express_mpy', ['plotly', 'plotly.express'])] if MPY else
        [('pandas_brython', ['pandas']), ('plotly_express_brython', ['plotly', 'plotly.express']),
         ('numpy_brython', ['numpy']), ('matplotlib_brython', ['matplotlib', 'matplotlib.pyplot']),
         ('scipy_stats_brython', ['scipy', 'scipy.stats']),
         ('statsmodels_brython', ['statsmodels', 'statsmodels.formula', 'statsmodels.formula.api']),
         ('seaborn_brython', ['seaborn'])])
src = open(os.path.join(ROOT, 'drawcast_runner.py')).read()
g = {'__name__': 'drawcast_runner'}
exec(compile(src, 'drawcast_runner.py', 'exec'), g)
for name, aliases in LIBS:
    err = g['_register_module'](name, open(os.path.join(ROOT, SUB, name + '.py')).read())
    assert err == '', err
    for a in aliases:
        assert g['_alias_module'](a, name) == ''


def run(title, code, paths=()):
    env = json.loads(g['_run'](code, json.dumps(list(paths))))
    print('===', title, '===')
    print(json.dumps({k: (v[:70] + '…' if isinstance(v, str) and len(v) > 70 else v) for k, v in env.items() if k != 'figures'}, ensure_ascii=False))
    print('figures:', [f[:50] for f in env['figures']])
    return env


COMMON = [
    ('console + table', 'import pandas as pd\nx = [1, 2, 3]\nprint("sum", sum(x))\ndf = pd.DataFrame({"a": [1.5, 2, None], "b": ["p", "q", "s"]})\ndf', ['x', 'df', 'df.b', 'nope', 'df.zz']),
    ('px figure in a variable', 'import pandas as pd\nimport plotly.express as px\ndf = pd.DataFrame({"c": ["a", "b"], "v": [3, 5]})\nfig = px.bar(df, x="c", y="v")', []),
    ('df.plot token', 'import pandas as pd\ndf = pd.DataFrame({"c": ["a", "b"], "v": [3, 5]})\ndf.plot(kind="bar", x="c", y="v")', []),
    ('error', 'y = 1\nz = y / 0\nprint("never")', []),
    ('suppressed + trailing expr', 'a = [1, 2, 3]\n_x = [v * 2 for v in a]\nsorted(a, reverse=True)', ['a', '_x']),
    ('idioms', 'import random\nrandom.seed(7)\nxs = [random.gauss(0, 1) for _ in range(200)]\nm = sum(xs) / len(xs)\nprint(f"mean {m:.3f} n {len(xs):,}")\nd = {k: v for k, v in zip("abc", [3, 1, 2])}\nsorted(d.items(), key=lambda kv: kv[1])', []),
]
BRYTHON_ONLY = [
    ('matplotlib two figures', 'import matplotlib.pyplot as plt\nplt.figure()\n_ = plt.plot([1, 2], [3, 4])\nplt.show()\nplt.figure()\n_ = plt.bar(["a", "b"], [1, 2])', []),
    ('numpy trailing', 'import numpy as np\na = np.array([1, 2, 3])\na.tolist()', ['a']),
    ('statsmodels', 'import pandas as pd\nimport statsmodels.formula.api as smf\ndf = pd.DataFrame({"x": [1, 2, 3, 4], "y": [2.1, 3.9, 6.2, 7.8]})\nm = smf.ols("y ~ x", data=df).fit()\nprint(round(m.params["x"], 2))', []),
]

if __name__ == '__main__':
    failed = 0
    for title, code, paths in COMMON + ([] if MPY else BRYTHON_ONLY):
        env = run(title, code, paths)
        if env['error'] and title != 'error':
            failed += 1
    print('FAILED' if failed else 'OK', failed)
    raise SystemExit(1 if failed else 0)
