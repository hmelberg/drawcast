# Runs drawcast_runner.py + the vendored libraries under local CPython, the
# way the browser will (module registration, then _run). Not shipped; a
# developer check before the browser smoke:  python3 scripts/pylib-sanity.py
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'public', 'pylib', '2026-09-03')
src = open(os.path.join(ROOT, 'drawcast_runner.py')).read()
g = {'__name__': 'drawcast_runner'}
exec(compile(src, 'drawcast_runner.py', 'exec'), g)
LIBS = [('pandas_brython', ['pandas']), ('plotly_express_brython', ['plotly', 'plotly.express']),
        ('numpy_brython', ['numpy']), ('matplotlib_brython', ['matplotlib', 'matplotlib.pyplot']),
        ('scipy_stats_brython', ['scipy', 'scipy.stats']),
        ('statsmodels_brython', ['statsmodels', 'statsmodels.formula', 'statsmodels.formula.api']),
        ('seaborn_brython', ['seaborn'])]
for name, aliases in LIBS:
    err = g['_register_module'](name, open(os.path.join(ROOT, 'brython', name + '.py')).read())
    assert err == '', err
    for a in aliases:
        assert g['_alias_module'](a, name) == ''


def run(title, code, paths=()):
    env = json.loads(g['_run'](code, json.dumps(list(paths))))
    print('===', title, '===')
    print(json.dumps({k: (v[:70] + '…' if isinstance(v, str) and len(v) > 70 else v) for k, v in env.items() if k != 'figures'}, ensure_ascii=False))
    print('figures:', [f[:50] for f in env['figures']])


if __name__ == '__main__':
    run('console + table', 'import pandas as pd\nx = [1, 2, 3]\nprint("sum", sum(x))\ndf = pd.DataFrame({"a": [1.5, 2, None], "b": ["p", "q", "s"]})\ndf', ['x', 'df', 'df.b', 'nope', 'df.zz'])
    run('px figure in a variable', 'import pandas as pd\nimport plotly.express as px\ndf = pd.DataFrame({"c": ["a", "b"], "v": [3, 5]})\nfig = px.bar(df, x="c", y="v")')
    run('matplotlib two figures', 'import matplotlib.pyplot as plt\nplt.figure()\n_ = plt.plot([1, 2], [3, 4])\nplt.show()\nplt.figure()\n_ = plt.bar(["a", "b"], [1, 2])')
    run('error', 'y = 1\nz = y / 0\nprint("never")')
    run('suppressed + trailing expr', 'import numpy as np\na = np.array([1, 2, 3])\n_x = a.tolist()\na.tolist()', ['a', '_x'])
    run('statsmodels', 'import pandas as pd\nimport statsmodels.formula.api as smf\ndf = pd.DataFrame({"x": [1, 2, 3, 4], "y": [2.1, 3.9, 6.2, 7.8]})\nm = smf.ols("y ~ x", data=df).fit()\nprint(round(m.params["x"], 2))')
    run('groupby example', 'import pandas as pd\nimport plotly.express as px\ndf = pd.DataFrame({"group": ["a", "a", "b", "b", "c"], "x": [2, 4, 6, 8, 10]})\nmeans = df.groupby("group")["x"].mean().reset_index()\nprint(means)\nfig = px.bar(means, x="group", y="x", title="Mean x per group")')
    run('idioms', 'import statistics, itertools, random\nfrom collections import Counter\nfrom dataclasses import dataclass\nrandom.seed(7)\nxs = [random.gauss(0, 1) for _ in range(200)]\nprint(f"mean {statistics.mean(xs):.3f} sd {statistics.stdev(xs):.3f} n {len(xs):,}")\nprint(list(itertools.accumulate([1, 2, 3])))\nprint(Counter("abca").most_common(1))\n@dataclass\nclass P:\n    x: int\n    y: int\nprint(P(1, 2))\nd = {k: v for k, v in zip("abc", [3, 1, 2])}\nsorted(d.items(), key=lambda kv: kv[1])')
