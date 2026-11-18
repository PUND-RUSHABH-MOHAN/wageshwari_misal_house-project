"""Fails if backend/terraform/lambda_sources.tf doesn't match backend/src/*.py,
i.e. someone edited a handler and forgot to re-run the generator."""

import pathlib
import subprocess
import sys

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "gen_lambda_sources.py"


def test_lambda_sources_tf_is_up_to_date():
    result = subprocess.run([sys.executable, str(SCRIPT), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_escape_roundtrip():
    sys.path.insert(0, str(SCRIPT.parent))
    import gen_lambda_sources as g

    text = 'x = f"{a}" + "${b}" + "%{c}" + "$${d}"\n'
    assert g.unescape(g.escape(text)) == text
