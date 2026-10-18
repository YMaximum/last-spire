"""Exercise the narrow compiled-dependency exception using non-credential canaries."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

scanner = str(Path(sys.argv[1]).resolve())
config = Path(__file__).resolve().parents[1] / '.gitleaks.toml'
with tempfile.TemporaryDirectory(prefix='last-spire-scanner-fixture-') as directory:
    root = Path(directory)
    (root / '.account-build').mkdir()
    reference = 'const {name} = {value};\n'.format(name='privateKey', value='body2.private_key')
    canary = hashlib.sha256(b'non-credential scanner regression fixture').hexdigest()
    (root / '.account-build/main.cjs').write_text(reference + f'const privateKey = "{canary}";\n')
    (root / '.account-build/other.cjs').write_text(reference)
    for arguments, expected in (([], 3), (['--config', str(config)], 2)):
        report = root / 'findings.json'
        result = subprocess.run([scanner, 'dir', '.account-build', '--redact=100', '--no-banner',
                                 '--report-format=json', '--report-path=' + str(report), *arguments],
                                cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        if result.returncode != 1 or not report.is_file():
            raise SystemExit('Scanner fixture failed to detect its expected canaries.')
        findings = json.loads(report.read_text())
        if len(findings) != expected or any(item['RuleID'] != 'generic-api-key' for item in findings):
            raise SystemExit('Scanner exception changed coverage; publication refused.')
        if arguments and sorted((item['File'], item['StartLine']) for item in findings) != [
            ('.account-build/main.cjs', 2), ('.account-build/other.cjs', 1)
        ]:
            raise SystemExit('Scanner exception escaped its exact path/expression scope.')
print('Secret-scanner canaries passed: actual key-like values and other paths remain detected.')
