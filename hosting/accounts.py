#!/usr/bin/env python3
"""Trusted account-runtime commands. Never run in an Actions worker."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import socket
import stat
import sys
import tempfile
import time
import urllib.error
import urllib.request
from uuid import uuid4
sys.path.insert(0, str(Path(__file__).resolve().parent))
import release

CONFIG = Path('/etc/last-spire/accounts.json')
SECRET = Path('/etc/last-spire/accounts/google-client-secret')
STATE = Path('/var/lib/last-spire/accounts')
RELEASES = Path('/var/lib/last-spire/releases')
NAME = 'last-spire-accounts'
HOLD = NAME + '-hold'
NETWORK = NAME
LABEL = 'io.last-spire.accounts'


class Refused(ValueError):
    pass


def require(value, message):
    if not value:
        raise Refused(message)


def private_directory(path, uid):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and not path.is_symlink() and info.st_uid == uid and not info.st_mode & 0o077, 'Unsafe private account directory.')


def private_file(path, uid, cap):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == uid and not info.st_mode & 0o077 and info.st_size <= cap, 'Unsafe private account file.')
    finally:
        os.close(fd)


def configuration(credentials=True):
    cfg = json.loads(release.trusted_file(CONFIG, secret=True))
    require(set(cfg) == {'schema', 'image', 'uid', 'gid', 'origin', 'clientId', 'dataDir', 'schedulerLock'} and cfg['schema'] == 1, 'Invalid account configuration.')
    require(re.fullmatch(r'node@sha256:[a-f0-9]{64}', cfg['image']), 'Pin an official Node 22 image digest.')
    require(type(cfg['uid']) is int and 100 <= cfg['uid'] < 2**31 and type(cfg['gid']) is int and 100 <= cfg['gid'] < 2**31, 'Use the dedicated unprivileged service identity.')
    require(re.fullmatch(r'https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', cfg['origin']) and 'localhost' not in cfg['origin'], 'Use the exact production HTTPS origin.')
    require(re.fullmatch(r'\d+-[\w-]+\.apps\.googleusercontent\.com', cfg['clientId']), 'Invalid production Google client ID.')
    data = Path(cfg['dataDir'])
    require(data == STATE / 'data' or (data.parent == STATE / 'restores' and re.fullmatch('[a-f0-9-]{36}', data.name)), 'Unrecognized account-data location.')
    private_directory(STATE, 0)
    private_directory(data, cfg['uid'])
    private_directory(STATE / 'deletions', cfg['uid'])
    private_file(STATE / 'deletions/deletions.jsonl', cfg['uid'], 1024 * 1024)
    lock = Path(cfg['schedulerLock'])
    require(lock.is_absolute() and len(str(lock)) <= 512, 'Configure the existing host-wide scheduler lock.')
    for parent in [lock.parent, *lock.parent.parents]:
        if parent == Path('/run/lock'):
            info = parent.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not parent.is_symlink() and bool(info.st_mode & stat.S_ISVTX), 'Unsafe shared lock directory.')
        else:
            release.trusted_directory(parent)
    if credentials:
        private_file(SECRET, cfg['uid'], 512)
    return cfg


def atomic_json(path, value):
    temp = path.with_name('.' + path.name + '.next')
    fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, sort_keys=True)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        parent = os.open(path.parent, os.O_DIRECTORY | os.O_RDONLY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        temp.unlink(missing_ok=True)


def validate_state(value):
    require(isinstance(value, dict) and set(value) == {'current', 'previous'} and all(item is None or (isinstance(item, str) and re.fullmatch('[a-f0-9]{40}', item)) for item in value.values()), 'Invalid account release state.')
    require(value['current'] is not None or value['previous'] is None, 'Invalid account release state.')
    return value


def read_state():
    path = STATE / 'runtime.json'
    if not path.exists():
        return {'current': None, 'previous': None}
    value = json.loads(release.trusted_file(path, secret=True))
    return validate_state(value)


def inspect(name):
    names = release.docker('container', 'ls', '-a', '--filter', 'name=' + name, '--format', '{{.Names}}').splitlines()
    if name not in names:
        return None
    value = json.loads(release.docker('inspect', name))[0]
    require(value['Config'].get('Labels', {}).get(LABEL) == 'true', 'Refusing to touch an unrelated container.')
    return value


def container_commit(info):
    return release.commit_sha(info['Config']['Labels']['io.last-spire.commit'])


def network():
    names = release.docker('network', 'ls', '--format', '{{.Name}}').splitlines()
    if NETWORK not in names:
        release.docker('network', 'create', '--label', LABEL + '=true', NETWORK)
    info = json.loads(release.docker('network', 'inspect', NETWORK))[0]
    require(info.get('Labels', {}).get(LABEL) == 'true' and info['Driver'] == 'bridge', 'Account network needs administrative review.')
    gateways = info['IPAM']['Config']
    require(len(gateways) == 1 and gateways[0].get('Gateway'), 'Unexpected account network gateway.')
    import ipaddress
    return str(ipaddress.ip_address(gateways[0]['Gateway']))


def runtime_args(cfg, sha, name, port, gateway, data=None, journal=None, secret=None):
    return ['run', '-d', '--name', name, '--label', LABEL + '=true', '--label', 'io.last-spire.commit=' + sha,
            '--read-only', '--user', f"{cfg['uid']}:{cfg['gid']}", '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges:true', '--memory', '384m', '--memory-swap', '384m',
            '--cpus', '0.5', '--pids-limit', '96', '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
            '--network', NETWORK, '-p', f'127.0.0.1:{port}:8080',
            '--mount', f'type=bind,src={RELEASES / sha / "api"},dst=/app,readonly',
            '--mount', f'type=bind,src={data or cfg["dataDir"]},dst=/data',
            '--mount', f'type=bind,src={journal or STATE / "deletions"},dst=/deletions',
            '--mount', f'type=bind,src={secret or SECRET},dst=/run/credentials/google,readonly',
            '-e', 'NODE_ENV=production', '-e', 'NODE_OPTIONS=--max-old-space-size=192',
            '-e', 'GOOGLE_CLIENT_ID=' + cfg['clientId'], '-e', 'GOOGLE_CLIENT_SECRET_FILE=/run/credentials/google',
            '-e', 'LAST_SPIRE_ORIGIN=' + cfg['origin'], '-e', 'LAST_SPIRE_API_PORT=8080', '-e', 'LAST_SPIRE_API_BIND=0.0.0.0',
            '-e', 'LAST_SPIRE_TRUST_PROXY=1', '-e', 'LAST_SPIRE_PROXY_ADDRESS=' + gateway,
            '-e', 'LAST_SPIRE_RELEASE_COMMIT=' + sha, '-e', 'LAST_SPIRE_DATA_DIR=/data',
            '-e', 'LAST_SPIRE_DELETION_JOURNAL=/deletions/deletions.jsonl', '--entrypoint', 'node', cfg['image'], '/app/main.cjs']


def bundle(sha):
    release.verify_installed(RELEASES, sha)
    value = json.loads((RELEASES / sha / 'api/release.json').read_text())
    require(value.get('schema') == 1 and value.get('component') == 'accounts' and value.get('commit') == sha
            and value.get('protocol') == 1 and value.get('database') == 1 and value.get('node') == 22, 'API/database compatibility needs review before this release.')


def health(port, sha):
    base = f'http://127.0.0.1:{port}'
    with urllib.request.urlopen(base + '/api/healthz', timeout=3) as response:
        value = json.loads(response.read(65537))
        require(value == {'ok': True, 'schema': 1, 'commit': sha, 'database': 1, 'runtime': 22}, 'API release health check failed.')
    with urllib.request.urlopen(base + '/api/session', timeout=3) as response:
        value = json.loads(response.read(65537))
        cookie = response.headers.get('Set-Cookie', '')
        require(value.get('codeSignIn') is True and value.get('player') is None
                and cookie.startswith('__Host-last-spire=') and '; HttpOnly;' in cookie and '; Secure' in cookie
                and '; SameSite=Strict;' in cookie and '; Path=/;' in cookie and '; Domain=' not in cookie
                and response.headers.get('Cache-Control') == 'no-store'
                and response.headers.get('Access-Control-Allow-Origin') is None, 'API session protections failed.')
    try:
        urllib.request.urlopen(base + '/api/save', timeout=3)
    except urllib.error.HTTPError as error:
        require(error.code == 401, 'API authentication protection failed.')
    else:
        raise Refused('API authentication protection failed.')


def wait_healthy(port, sha):
    for attempt in range(20):
        try:
            health(port, sha)
            return
        except (OSError, ValueError):
            if attempt == 19:
                raise Refused('API did not pass its bounded health checks.')
            time.sleep(.5)


def owned_directory(path, cfg):
    path.mkdir(mode=0o700)
    os.chown(path, cfg['uid'], cfg['gid'])


def candidate(cfg, sha, gateway):
    name = NAME + '-candidate-' + sha[:12]
    require(inspect(name) is None, 'A previous candidate needs inspection.')
    with tempfile.TemporaryDirectory(prefix='.candidate-', dir=STATE) as root:
        root = Path(root)
        for child in ('data', 'deletions'):
            owned_directory(root / child, cfg)
        for path, value in [(root / 'google', b'candidate-value-not-a-real-credential'), (root / 'deletions/deletions.jsonl', b'')]:
            path.write_bytes(value)
            path.chmod(0o600)
            os.chown(path, cfg['uid'], cfg['gid'])
        try:
            release.docker(*runtime_args(cfg, sha, name, '', gateway, root / 'data', root / 'deletions', root / 'google'))
            info = inspect(name)
            port = int(info['NetworkSettings']['Ports']['8080/tcp'][0]['HostPort'])
            wait_healthy(port, sha)
        finally:
            if inspect(name) is not None:
                release.docker('rm', '-f', name)


def helper(cfg, sha, args, mounts):
    bundle(sha)
    command = ['run', '--rm', '--network', 'none', '--read-only', '--user', f"{cfg['uid']}:{cfg['gid']}",
               '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--memory', '256m', '--memory-swap', '256m',
               '--cpus', '0.5', '--pids-limit', '64', '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m,mode=1777',
               '--mount', f'type=bind,src={RELEASES / sha / "api"},dst=/app,readonly',
               '--mount', f'type=bind,src={STATE / "deletions"},dst=/deletions,readonly',
               '-e', 'NODE_ENV=production', '-e', 'LAST_SPIRE_DELETION_JOURNAL=/deletions/deletions.jsonl']
    for mount in mounts:
        command += ['--mount', mount]
    release.docker(*command, '--entrypoint', 'node', cfg['image'], '/app/backup.cjs', *args)


def backup(cfg, sha):
    info = inspect(NAME)
    if info and info['State']['Running']:
        release.docker('exec', NAME, 'node', '/app/backup.cjs', 'backup', '/data')
    else:
        directory = cfg['dataDir']
        if info:
            mounts = [mount for mount in info['Mounts'] if mount.get('Destination') == '/data' and mount.get('Type') == 'bind']
            require(len(mounts) == 1, 'Stopped runtime data mount differs; inspect before backing up.')
            directory = mounts[0]['Source']
            private_directory(Path(directory), cfg['uid'])
        helper(cfg, sha, ['backup', '/data'], [f'type=bind,src={directory},dst=/data'])


def finish(sha, previous_state):
    previous = previous_state['previous'] if sha == previous_state['current'] else previous_state['current']
    atomic_json(STATE / 'runtime.json', {'current': sha, 'previous': previous})
    if inspect(HOLD):
        release.docker('rm', HOLD)
    (STATE / 'pending.json').unlink(missing_ok=True)


def recover_pending(rollback=False):
    path = STATE / 'pending.json'
    if not path.exists():
        return
    pending = json.loads(release.trusted_file(path, secret=True))
    require(isinstance(pending, dict) and set(pending) == {'target', 'before'}, 'Invalid pending deployment state.')
    target, before = release.commit_sha(pending['target']), validate_state(pending['before'])
    active, hold = inspect(NAME), inspect(HOLD)
    if not rollback and active and container_commit(active) == target and active['State']['Running']:
        bundle(target)
        try:
            wait_healthy(8092, target)
        except Refused:
            pass
        else:
            finish(target, before)
            return
    if active and container_commit(active) == before['current'] and not hold:
        if not active['State']['Running']:
            release.docker('start', NAME)
        wait_healthy(8092, before['current'])
        path.unlink()
        return
    if active:
        require(container_commit(active) == target, 'Interrupted deployment runtime differs; inspect privately.')
        release.docker('rm', '-f', NAME)
    if hold:
        require(container_commit(hold) == before['current'], 'Rollback runtime identity differs; inspect privately.')
        release.docker('rename', HOLD, NAME)
        release.docker('start', NAME)
        wait_healthy(8092, before['current'])
    else:
        require(before['current'] is None, 'Previous API runtime is missing; manual recovery required.')
    atomic_json(STATE / 'runtime.json', before)
    path.unlink()


def activate(cfg, sha):
    bundle(sha)
    recover_pending()
    before = read_state()
    current = inspect(NAME)
    require(inspect(HOLD) is None, 'Previous interrupted runtime needs recovery.')
    require((current is None and before['current'] is None) or (current and container_commit(current) == before['current']), 'Runtime and release state differ; inspect before deployment.')
    gateway = network()
    candidate(cfg, sha, gateway)
    if before['current']:
        backup(cfg, before['current'])
    atomic_json(STATE / 'pending.json', {'target': sha, 'before': before})
    try:
        if current:
            release.docker('stop', '-t', '20', NAME)
            release.docker('rename', NAME, HOLD)
        args = runtime_args(cfg, sha, NAME, '8092', gateway)
        args[2:2] = ['--restart', 'unless-stopped']
        release.docker(*args)
        wait_healthy(8092, sha)
        finish(sha, before)
    except Exception:
        try:
            recover_pending(rollback=True)
        except Exception:
            raise Refused('API switch failed and needs manual recovery. Keep the private pending state and previous runtime.') from None
        raise Refused('API switch failed; the prior runtime/state was retained or recovered.') from None
    print('Serving checked account API ' + sha)


def prepare_restore(cfg, sha, name):
    require(re.fullmatch(r'snapshot-[0-9]+-[a-f0-9-]{36}\.sqlite', name), 'Expected a backup basename, not a path.')
    source = Path(cfg['dataDir']) / 'backups'
    private_directory(source, cfg['uid'])
    private_file(source / name, cfg['uid'], 256 * 1024 * 1024)
    private_file(source / (name + '.sha256'), cfg['uid'], 65)
    root = STATE / 'restores'
    root.mkdir(mode=0o700, exist_ok=True)
    release.trusted_directory(root)
    identifier = str(uuid4())
    destination = root / identifier
    owned_directory(destination, cfg)
    helper(cfg, sha, ['restore', '/source/' + name, '/restore'],
           [f'type=bind,src={source},dst=/source,readonly', f'type=bind,src={destination},dst=/restore'])
    print('Prepared private recovery ' + identifier + '. Production data/configuration unchanged.')


def main():
    require(os.geteuid() == 0, 'Run the restricted account command through sudo.')
    os.umask(0o077)
    action, *args = sys.argv[1:]
    require(action in ('deploy', 'rollback', 'backup', 'prepare-restore', 'status'), 'Unknown account command.')
    require(len(args) == (1 if action in ('deploy', 'prepare-restore') else 0), 'Unexpected account command arguments.')
    cfg = configuration(action in ('deploy', 'rollback'))
    if action == 'status':
        info = inspect(NAME)
        print(json.dumps({**read_state(), 'running': bool(info and info['State']['Running']), 'pending': (STATE / 'pending.json').exists()}))
        return
    lock_fd = os.open(cfg['schedulerLock'], os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        lock_info = os.fstat(lock_fd)
        require(stat.S_ISREG(lock_info.st_mode) and lock_info.st_nlink == 1 and lock_info.st_uid == 0 and not lock_info.st_mode & 0o022, 'Unsafe scheduler lock.')
        try:
            fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Refused('Shared CI dispatcher holds its lifetime lock. Use the reviewed maintenance procedure; no deployment started.') from error
        with open('/run/lock/last-spire-release.lock', 'a') as release_lock:
            fcntl.flock(release_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            available = next(int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
            require(available >= 640 * 1024 * 1024, 'Not enough memory headroom; retry after shared workloads finish.')
            recover_pending()
            state = read_state()
            if action == 'deploy':
                sha = release.commit_sha(args[0])
                token = release.trusted_file(Path('/etc/last-spire/github-token'), secret=True).strip()
                files = release.stored_artifact(release.GitHub(token), sha)
                release.install_release(RELEASES, sha, files)
                activate(cfg, sha)
            elif action == 'rollback':
                require(state['previous'], 'No prior compatible API release.')
                activate(cfg, state['previous'])
            else:
                require(state['current'], 'An installed API release is required for recovery tools.')
                if action == 'backup':
                    backup(cfg, state['current'])
                    print('Private account backup completed.')
                else:
                    prepare_restore(cfg, state['current'], args[0])
    finally:
        os.close(lock_fd)


if __name__ == '__main__':
    try:
        main()
    except Refused as error:
        sys.exit(str(error))
    except Exception as error:
        sys.exit('Account command refused (' + type(error).__name__ + '). Inspect private configuration and recovery state; no credentials logged.')
