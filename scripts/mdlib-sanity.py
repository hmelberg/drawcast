# Runs drawcast_microdata_runner.py against the vendored emulator under local
# CPython, the way pyodide will. This is the Python half's test: the TS half
# is covered by tests/microdata-output.test.ts, but nothing in vitest can
# execute m2py, so the contract between drawcast and the emulator is checked
# here instead.
#
#   python3 scripts/mdlib-sanity.py
#
# Needs pandas, numpy and scipy locally (pyodide ships all three).
import json, os, re, sys

# The snapshot is copied verbatim into dist/ — importing the emulator must not
# leave a __pycache__ behind in it.
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
# The snapshot version lives in one place (src/code/languages.ts).
_LANG = open(os.path.join(ROOT, 'src', 'code', 'languages.ts')).read()
MDLIB_VERSION = re.search(r'MDLIB_VERSION = "([^"]+)"', _LANG).group(1)
MDLIB = os.path.abspath(os.path.join(ROOT, 'public', 'mdlib', MDLIB_VERSION))

failures = []


def check(name, cond, detail=''):
    print(('  ok  ' if cond else '  FAIL') + '  ' + name + (('  — ' + str(detail)) if detail and not cond else ''))
    if not cond:
        failures.append(name)


src = open(os.path.join(MDLIB, 'drawcast_microdata_runner.py')).read()
g = {'__name__': 'drawcast_microdata_runner'}
exec(compile(src, 'drawcast_microdata_runner.py', 'exec'), g)

print('setup')
check('_md_setup finds the vendored snapshot', g['_md_setup'](MDLIB) == '')

catalog = json.load(open(os.path.join(MDLIB, 'variable_metadata.json')))
catalog = catalog.get('variables', catalog)
err = g['_md_boot'](json.dumps(catalog), 200)
check('_md_boot builds a MicroInterpreter', err == '', err)
if failures:
    sys.exit(1)

print('\ndisclosure control')
import m2py  # importable now: _md_setup put the snapshot on sys.path

check('OFF by default — the tutorial teaches the language, not the guardrails', m2py._is_disclosure_control() is False)

SCRIPT = """require no.ssb.fdb:54 as fd
create-dataset demo
import fd/BEFOLKNING_KJOENN as kjonn
import fd/INNTEKT_WLONN 2022-01-01 as inntekt
tabulate kjonn
"""

out = json.loads(g['_md_run'](SCRIPT))
check('a script directive can still turn it on', json.loads(g['_md_run']('// m2py: dc=on\n' + SCRIPT))['output'] is not None)
check('and the directive does not leak into the next run', m2py._is_disclosure_control() is False)

print('\nrunning')
check('_md_run answers with output and no runner error', out.get('error') == '', out.get('error'))
check('the command echo is there', 'create-dataset demo' in out['output'])
check('tabulate emits a tablehtml embed', '__micro_transform_start_tablehtml__' in out['output'])
check('no command failed', 'FEIL' not in out['output'], out['output'][:400])

print('\nthe data bridge')
gl = g['__g']
check('the dataset is bound by name', hasattr(gl.get('demo'), 'columns'))
check('and `df` is the active one', gl.get('df') is gl.get('demo'))
check('the imported variables are columns', {'kjonn', 'inntekt'} <= set(map(str, gl['df'].columns)), list(gl['df'].columns))

print('\nruns are isolated')
# The result cache is keyed by the SCRIPT's hash, so a run that could see an
# earlier run's datasets would be cached under a key that does not mention
# them — and replay wrongly the moment the two arrive in the other order.
# Same reason pyodide.ts gives every python run a fresh namespace.
again = json.loads(g['_md_run']('tabulate kjonn'))
check('a second run cannot see the first run\'s datasets',
      re.search(r'^\s*FEIL', again['output'], re.M) is not None, again['output'][:200])

print('\nfailure is reported, not raised')
bad = json.loads(g['_md_run']('summarize nope'))
check('a bad command comes back in the output for the parser to see', re.search(r'^\s*FEIL', bad['output'], re.M) is not None, bad['output'][:200])
check('and is not a runner-level error', bad['error'] == '')

print('\nthe working directory is restored')
check('cwd is untouched after a run', os.getcwd() != MDLIB)

print()
if failures:
    print('%d failed: %s' % (len(failures), ', '.join(failures)))
    sys.exit(1)
print('mdlib %s: all good.' % MDLIB_VERSION)
