"""Run project Python code with trusted bundled native dependencies on Windows.

Usage: bundled-python scripts/python-project.py -m unittest discover ...
Uses installed project pure-Python packages after preloading trusted native ones.
No security settings or dependency files are modified.
"""
import os
import runpy
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
site = root / '.runtime' / 'cv-pipeline-venv' / 'Lib' / 'site-packages'
if os.name == 'nt' and site.is_dir():
    # The bundled interpreter supplies trusted native packages. Its pypdf is
    # older, so use the project's remaining packages after these preloads.
    import pydantic, pydantic_core, numpy, PIL, cryptography
    sys.path.insert(0, str(site))
sys.path.insert(0, str(root / 'extractor_cv'))
args = sys.argv[1:]
if not args:
    raise SystemExit('Provide -m MODULE or SCRIPT and arguments.')
if args[0] == '-m':
    sys.argv = args[1:]
    runpy.run_module(args[1], run_name='__main__')
else:
    sys.argv = args
    runpy.run_path(args[0], run_name='__main__')
