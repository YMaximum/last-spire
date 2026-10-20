import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
import accounts
import artifact_contract
spec = importlib.util.spec_from_file_location('collector_upgrade', ROOT / 'upgrade-collector.py')
upgrade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upgrade)

SHA, OLD, EARLIER = 'a' * 40, 'b' * 40, 'c' * 40

def info(sha, running=True):
    return {'Config': {'Labels': {accounts.LABEL: 'true', 'io.last-spire.commit': sha}}, 'State': {'Running': running}}


class RuntimeTests(unittest.TestCase):
    def test_database_downgrade_is_refused_before_runtime_changes(self):
        accounts.bundle.side_effect = lambda sha: 1 if sha == SHA else 2
        with self.assertRaisesRegex(accounts.Refused, 'Database downgrade'):
            accounts.activate(self.cfg, SHA)
        self.assertFalse(self.calls)
        self.assertEqual(accounts.read_state()['current'], OLD)
        self.assertTrue(self.containers[accounts.NAME]['State']['Running'])

    def test_interrupted_database_upgrade_keeps_data_and_runtimes_for_forward_recovery(self):
        before = accounts.read_state()
        accounts.atomic_json(self.root / 'pending.json', {'target': SHA, 'before': before})
        self.containers[accounts.HOLD] = self.containers.pop(accounts.NAME)
        self.containers[accounts.NAME] = info(SHA)
        accounts.bundle.side_effect = lambda sha: 2 if sha == SHA else 1
        with self.assertRaisesRegex(accounts.Refused, 'migration may have committed'):
            accounts.recover_pending(rollback=True)
        self.assertFalse(self.calls)
        self.assertTrue((self.root / 'pending.json').exists())
        self.assertEqual(accounts.container_commit(self.containers[accounts.NAME]), SHA)
        self.assertEqual(accounts.container_commit(self.containers[accounts.HOLD]), OLD)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cfg = {'uid': 123, 'gid': 124, 'image': 'node@sha256:' + 'd' * 64,
                    'clientId': '123-fixture.apps.googleusercontent.com', 'origin': 'https://game.example.test', 'dataDir': str(self.root / 'data')}
        self.containers = {accounts.NAME: info(OLD)}
        self.calls = []
        for patcher in [patch.object(accounts, 'STATE', self.root), patch.object(accounts, 'RELEASES', self.root / 'releases'),
                        patch.object(accounts.release, 'trusted_file', side_effect=lambda path, secret=False: Path(path).read_text()),
                        patch.object(accounts, 'bundle', return_value=2), patch.object(accounts, 'network', return_value='192.0.2.1'),
                        patch.object(accounts, 'candidate'), patch.object(accounts, 'wait_healthy'),
                        patch.object(accounts, 'inspect', side_effect=lambda name: self.containers.get(name)),
                        patch.object(accounts.release, 'docker', side_effect=self.docker)]:
            patcher.start()
            self.addCleanup(patcher.stop)
        accounts.atomic_json(self.root / 'runtime.json', {'current': OLD, 'previous': EARLIER})

    def docker(self, *args):
        self.calls.append(args)
        if args[0] == 'stop':
            self.containers[args[-1]]['State']['Running'] = False
        elif args[0] == 'rename':
            self.containers[args[2]] = self.containers.pop(args[1])
        elif args[0] == 'start':
            self.containers[args[1]]['State']['Running'] = True
        elif args[0] == 'rm':
            self.containers.pop(args[-1], None)
        elif args[0] == 'run':
            if '--name' not in args:
                return ''
            name = args[args.index('--name') + 1]
            sha = next(value.split('=', 1)[1] for value in args if value.startswith('io.last-spire.commit='))
            self.containers[name] = info(sha)
        return ''

    def test_success_backs_up_before_stop_and_preserves_prior_release(self):
        accounts.activate(self.cfg, SHA)
        self.assertEqual(accounts.read_state(), {'current': SHA, 'previous': OLD})
        self.assertNotIn(accounts.HOLD, self.containers)
        self.assertFalse((self.root / 'pending.json').exists())
        backup = next(i for i, call in enumerate(self.calls) if call[0] == 'exec')
        stop = next(i for i, call in enumerate(self.calls) if call[0] == 'stop')
        self.assertLess(backup, stop)

    def test_candidate_failure_leaves_current_runtime_and_state_untouched(self):
        accounts.candidate.side_effect = accounts.Refused('candidate failed')
        with self.assertRaises(accounts.Refused):
            accounts.activate(self.cfg, SHA)
        self.assertEqual(accounts.read_state(), {'current': OLD, 'previous': EARLIER})
        self.assertTrue(self.containers[accounts.NAME]['State']['Running'])
        self.assertFalse(self.calls)

    def test_failed_live_health_rolls_back_even_if_a_second_probe_would_succeed(self):
        accounts.wait_healthy.side_effect = [accounts.Refused('new API unhealthy'), None]
        with self.assertRaisesRegex(accounts.Refused, 'prior runtime/state'):
            accounts.activate(self.cfg, SHA)
        self.assertEqual(accounts.container_commit(self.containers[accounts.NAME]), OLD)
        self.assertTrue(self.containers[accounts.NAME]['State']['Running'])
        self.assertEqual(accounts.read_state(), {'current': OLD, 'previous': EARLIER})

    def test_interruption_after_start_can_finish_healthy_checked_target(self):
        before = accounts.read_state()
        accounts.atomic_json(self.root / 'pending.json', {'target': SHA, 'before': before})
        self.containers[accounts.HOLD] = info(OLD, False)
        self.containers[accounts.NAME] = info(SHA)
        accounts.recover_pending()
        self.assertEqual(accounts.read_state(), {'current': SHA, 'previous': OLD})
        self.assertNotIn(accounts.HOLD, self.containers)

    def test_interruption_before_start_restores_the_stopped_previous_runtime(self):
        before = accounts.read_state()
        accounts.atomic_json(self.root / 'pending.json', {'target': SHA, 'before': before})
        self.containers[accounts.HOLD] = self.containers.pop(accounts.NAME)
        self.containers[accounts.HOLD]['State']['Running'] = False
        accounts.recover_pending()
        self.assertEqual(accounts.read_state(), before)
        self.assertTrue(self.containers[accounts.NAME]['State']['Running'])

    def test_same_commit_restart_does_not_replace_rollback_target(self):
        accounts.activate(self.cfg, OLD)
        self.assertEqual(accounts.read_state(), {'current': OLD, 'previous': EARLIER})

    def test_backup_failure_happens_before_any_service_stop(self):
        original = self.docker
        def fail_backup(*args):
            if args[0] == 'exec':
                raise RuntimeError('backup refused')
            return original(*args)
        accounts.release.docker.side_effect = fail_backup
        with self.assertRaises(RuntimeError):
            accounts.activate(self.cfg, SHA)
        self.assertTrue(self.containers[accounts.NAME]['State']['Running'])
        self.assertFalse((self.root / 'pending.json').exists())

    def test_different_runtime_commit_is_refused_without_touching_it(self):
        self.containers[accounts.NAME] = info(SHA)
        with self.assertRaisesRegex(accounts.Refused, 'Runtime and release state differ'):
            accounts.activate(self.cfg, SHA)
        self.assertFalse(self.calls)

    def test_invalid_pending_state_is_refused_before_docker_changes(self):
        for before in ({'current': None, 'previous': OLD}, {'current': 12, 'previous': None}, {'current': OLD}):
            accounts.atomic_json(self.root / 'pending.json', {'target': SHA, 'before': before})
            with self.subTest(before=before), self.assertRaises(accounts.Refused):
                accounts.recover_pending()
            self.assertFalse(self.calls)

    def test_runtime_is_loopback_bounded_unprivileged_and_credentials_are_not_env_values(self):
        args = accounts.runtime_args(self.cfg, SHA, accounts.NAME, '8092', '192.0.2.1')
        self.assertIn('127.0.0.1:8092:8080', args)
        self.assertEqual(args[args.index('--user') + 1], '123:124')
        self.assertIn('--read-only', args)
        self.assertIn('no-new-privileges:true', args)
        self.assertIn('384m', args)
        self.assertIn('--cap-drop', args)
        self.assertNotIn('host', args)
        self.assertNotIn('/var/run/docker.sock', ' '.join(args))
        self.assertIn('GOOGLE_CLIENT_SECRET_FILE=/run/credentials/google', args)
        self.assertNotIn('GOOGLE_CLIENT_SECRET=', ' '.join(args))
        self.assertIn(f'type=bind,src={accounts.SECRET},dst=/run/credentials/google,readonly', args)

    def test_recovery_tools_have_no_network_or_google_credential_mount(self):
        accounts.helper(self.cfg, SHA, ['verify', '/source/snapshot.sqlite'], [])
        args = self.calls[-1]
        self.assertEqual(args[args.index('--network') + 1], 'none')
        self.assertNotIn(str(accounts.SECRET), ' '.join(args))
        self.assertNotIn('GOOGLE_CLIENT_ID', ' '.join(args))


class SchedulerLockTests(unittest.TestCase):
    def test_live_dispatcher_lock_refuses_before_deployment(self):
        import fcntl
        import stat
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            lock_path = Path(directory) / 'build.lock'
            lock_path.touch(mode=0o600)
            with lock_path.open('r+') as held:
                fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with patch.object(accounts.os, 'geteuid', return_value=0), \
                     patch.object(accounts, 'configuration', return_value={'schedulerLock': str(lock_path)}), \
                     patch.object(accounts.os, 'fstat', return_value=SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_nlink=1, st_uid=0)), \
                     patch.object(accounts.sys, 'argv', ['accounts.py', 'deploy', SHA]), \
                     patch.object(accounts, 'recover_pending') as recover, \
                     patch.object(accounts.release, 'docker') as docker:
                    with self.assertRaisesRegex(accounts.Refused, 'lifetime lock'):
                        accounts.main()
                    recover.assert_not_called()
                    docker.assert_not_called()


class HealthTests(unittest.TestCase):
    def test_database_and_runtime_mismatch_are_not_healthy(self):
        class Response:
            def __init__(self, value): self.value = value
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return json.dumps(self.value).encode()
        for field, value in [('database', 3), ('runtime', 24), ('commit', OLD)]:
            health = {'ok': True, 'schema': 1, 'commit': SHA, 'database': 2, 'runtime': 22, field: value}
            with self.subTest(field=field), patch.object(accounts.urllib.request, 'urlopen', return_value=Response(health)):
                with self.assertRaises(accounts.Refused): accounts.health(8092, SHA)

    def test_unrelated_container_is_never_managed(self):
        unrelated = info(SHA)
        unrelated['Config']['Labels'] = {}
        with patch.object(accounts.release, 'docker', side_effect=[accounts.NAME, json.dumps([unrelated])]):
            with self.assertRaisesRegex(accounts.Refused, 'unrelated'):
                accounts.inspect(accounts.NAME)


class PrivatePathTests(unittest.TestCase):
    def test_private_file_refuses_symlinks_and_group_read(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'secret'
            path.write_text('synthetic-value')
            path.chmod(0o600)
            accounts.private_file(path, os.getuid(), 100)
            path.chmod(0o640)
            with self.assertRaises(accounts.Refused):
                accounts.private_file(path, os.getuid(), 100)
            path.chmod(0o600)
            link = Path(root) / 'link'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                accounts.private_file(link, os.getuid(), 100)

    def test_collector_upgrade_is_baseline_guarded_and_changes_only_validate(self):
        import hashlib
        source = 'VALUE = 1\ndef validate(archive,checksum,lease):\n return "legacy"\ndef unchanged():\n return VALUE\n'
        changed = upgrade.transform(source, hashlib.sha256(source.encode()).hexdigest())
        self.assertIn('from last_spire_artifact_contract import validate', changed)
        self.assertTrue(changed.endswith('def unchanged():\n return VALUE\n'))
        with self.assertRaises(ValueError):
            upgrade.transform(source + '\n', hashlib.sha256(source.encode()).hexdigest())
