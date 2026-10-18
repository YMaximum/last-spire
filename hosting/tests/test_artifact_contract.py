import hashlib
import io
import os
import stat
import json
from pathlib import Path
import sys
import tarfile
import unittest
import tempfile
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).parents[1]))
import artifact_contract as contract
import release
SHA = 'a' * 40
IDENTITY = {'schema': 2, 'repository': contract.REPOSITORY, 'commit': SHA, 'runId': 42, 'runAttempt': 1}
LEASE = {'sha': SHA, 'run_id': 42, 'attempt': 1}


def files():
    result = {'dist/index.html': b'game', 'dist/release.json': json.dumps(IDENTITY).encode(),
              'api/main.cjs': b'// synthetic bundle', 'api/backup.cjs': b'// synthetic recovery',
              'api/THIRD_PARTY_NOTICES.txt': b'synthetic notices', 'api/release.json': json.dumps(contract.api_identity(IDENTITY)).encode()}
    return result


def archive(entries):
    manifest = {**IDENTITY, 'files': {name: {'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()} for name, data in entries.items()}}
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as tar:
        for name, data in {**entries, 'manifest.json': json.dumps(manifest).encode()}.items():
            member = tarfile.TarInfo(name)
            member.size = len(data)
            tar.addfile(member, io.BytesIO(data))
    return output.getvalue()


def checksum(data):
    return (hashlib.sha256(data).hexdigest() + '  last-spire-' + SHA + '.tar.gz\n').encode()


class ContractTests(unittest.TestCase):
    def test_collector_and_deployer_validate_the_same_backend_artifact(self):
        entries = files()
        data = archive(entries)
        self.assertEqual(contract.validate(data, checksum(data), LEASE), hashlib.sha256(data).hexdigest())
        self.assertEqual(contract.inspect_archive(data, SHA, 42, 1, collect=True), entries)

    def test_api_and_static_commands_can_reuse_one_immutable_install(self):
        entries = files()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release.install_release(root, SHA, entries)
            release.install_release(root, SHA, entries)
            release.verify_installed(root, SHA)
            self.assertEqual((root / SHA / 'api/main.cjs').read_bytes(), entries['api/main.cjs'])
            self.assertEqual((root / SHA / 'dist/index.html').read_bytes(), entries['dist/index.html'])
            changed = {**entries, 'api/main.cjs': b'changed bundle'}
            with self.assertRaisesRegex(ValueError, 'immutable release differs'):
                release.install_release(root, SHA, changed)

    def test_private_umask_does_not_hide_public_code_or_relax_private_defaults(self):
        previous = os.umask(0o077)
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                entries = {**files(), 'dist/assets/app.js': b'synthetic asset'}
                release.install_release(root, SHA, entries)
                for relative in ('', 'api', 'dist', 'dist/assets'):
                    self.assertEqual(stat.S_IMODE((root / SHA / relative).stat().st_mode), 0o755)
                for relative in entries:
                    self.assertEqual(stat.S_IMODE((root / SHA / relative).stat().st_mode), 0o644)
                private = root / 'private-data'
                private.mkdir()
                (private / 'credential').write_text('synthetic private fixture')
                self.assertEqual(stat.S_IMODE(private.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE((private / 'credential').stat().st_mode), 0o600)
        finally:
            os.umask(previous)

    def test_matching_existing_release_repairs_directories_after_integrity_checks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            entries = files()
            release.install_release(root, SHA, entries)
            (root / SHA / 'api').chmod(0o700)
            changed = {**entries, 'api/main.cjs': b'different code'}
            with self.assertRaisesRegex(ValueError, 'immutable release differs'):
                release.install_release(root, SHA, changed)
            self.assertEqual(stat.S_IMODE((root / SHA / 'api').stat().st_mode), 0o700)
            release.install_release(root, SHA, entries)
            self.assertEqual(stat.S_IMODE((root / SHA / 'api').stat().st_mode), 0o755)
            release.verify_installed(root, SHA)
            for relative, expected in entries.items():
                self.assertEqual((root / SHA / relative).read_bytes(), expected)

    def test_partial_or_unexpected_api_inventory_is_rejected(self):
        for name in contract.API_FILES:
            entries = files()
            entries.pop(name)
            with self.subTest(name=name), self.assertRaises(ValueError):
                contract.inspect_archive(archive(entries), SHA, 42, 1)
        entries = files()
        entries['api/extra.js'] = b'not-approved'
        with self.assertRaises(ValueError):
            contract.inspect_archive(archive(entries), SHA, 42, 1)

    def test_backend_database_protocol_runtime_and_identity_must_match(self):
        for key, value in [('database', 2), ('protocol', True), ('node', 24), ('commit', 'b' * 40), ('runAttempt', 2)]:
            entries = files()
            identity = contract.api_identity(IDENTITY)
            identity[key] = value
            entries['api/release.json'] = json.dumps(identity).encode()
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'API component'):
                contract.inspect_archive(archive(entries), SHA, 42, 1)

    def test_credential_database_and_server_paths_cannot_be_placed_in_public_root(self):
        for name in ('dist/.private/key', 'dist/server/main.cjs', 'dist/api/main.cjs', 'dist/account-data/db', 'dist/accounts.sqlite', 'dist/backup.sqlite.sha256', 'dist/.env.production', 'dist/id_rsa', 'dist/id_ed25519.pub', 'dist/google-client-secret'):
            entries = files()
            entries[name] = b'synthetic-private-content'
            with self.subTest(name=name), self.assertRaises(ValueError):
                contract.inspect_archive(archive(entries), SHA, 42, 1)

    def test_served_identity_types_are_strict_and_checksum_is_mandatory(self):
        entries = files()
        entries['dist/release.json'] = json.dumps({**IDENTITY, 'runAttempt': True}).encode()
        with self.assertRaises(ValueError):
            contract.inspect_archive(archive(entries), SHA, 42, 1)
        data = archive(files())
        with self.assertRaises(ValueError):
            contract.validate(data, b'wrong', LEASE)

    def test_bounded_metadata_expansion_and_trailing_payload_are_preserved(self):
        data = archive(files())
        with patch.object(contract, 'MAX_EXPANDED', 10), self.assertRaises(ValueError):
            contract.inspect_archive(data, SHA, 42, 1)
        import gzip
        malicious = data + gzip.compress(b'not-an-archive')
        with self.assertRaises(ValueError):
            contract.inspect_archive(malicious, SHA, 42, 1)
