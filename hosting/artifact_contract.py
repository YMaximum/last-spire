"""Bounded release validator shared by the host collector and release commands."""
import gzip
import hashlib
import io
import json
import re
import tarfile
import time

REPOSITORY = 'YMaximum/last-spire'
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
MAX_MANIFEST = 2 * 1024 * 1024
MAX_MEMBERS = 4096
API_FILES = {'api/main.cjs', 'api/backup.cjs', 'api/release.json', 'api/THIRD_PARTY_NOTICES.txt'}
PRIVATE = re.compile(r'(?:^|/)(?:\.private|\.release|\.account-build|account-data|reports|playlogs|qa-data|checkpoints|\.git|\.aws|\.codex|\.agents|\.serena)(?:/|$)|(?:^|/)(?:\.env(?:\.|$)|id_rsa(?:\.|$)|id_ed25519(?:\.|$)|google-client-secret(?:\.|$))|\.sqlite(?:[-.][^/]*)?$|\.(?:pem|key|p12|pfx)$', re.I)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def json_data(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, 'Duplicate JSON key.')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


class Expanded:
    def __init__(self, data):
        self.stream = gzip.GzipFile(fileobj=io.BytesIO(data))
        self.size = 0
        self.deadline = time.monotonic() + 30

    def read(self, count):
        require(0 <= count <= MAX_MANIFEST and time.monotonic() <= self.deadline, 'Archive read limit exceeded.')
        data = self.stream.read(count)
        self.size += len(data)
        require(self.size <= MAX_EXPANDED, 'Expanded archive is too large.')
        return data


class StrictTarInfo(tarfile.TarInfo):
    def _proc_member(self, tar):
        tar._release_count = getattr(tar, '_release_count', 0) + 1
        require(tar._release_count <= MAX_MEMBERS, 'Too many archive entries.')
        metadata = self.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK)
        require(not metadata or self.size <= MAX_MANIFEST, 'Oversized archive metadata.')
        depth = getattr(tar, '_release_depth', 0)
        require(depth < 16, 'Excessive archive metadata nesting.')
        tar._release_depth = depth + 1
        try:
            return super()._proc_member(tar)
        finally:
            tar._release_depth = depth


def api_identity(identity, database=2):
    return {'schema': 1, 'component': 'accounts', 'repository': REPOSITORY,
            'commit': identity['commit'], 'runId': identity['runId'], 'runAttempt': identity['runAttempt'],
            'protocol': 1, 'database': database, 'node': 22}


def same_identity(value, expected):
    return isinstance(value, dict) and set(value) == set(expected) and all(type(value[key]) is type(item) and value[key] == item for key, item in expected.items())


def inspect_archive(archive, sha, run_id, attempt, collect=False):
    require(isinstance(sha, str) and re.fullmatch('[a-f0-9]{40}', sha), 'Invalid commit SHA.')
    require(type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0, 'Invalid run identity.')
    require(0 < len(archive) <= MAX_ARCHIVE, 'Archive size limit exceeded.')
    seen, observed, captured, contents = set(), {}, {}, {}
    expanded = 0
    with tarfile.open(fileobj=Expanded(archive), mode='r|', tarinfo=StrictTarInfo) as bundle:
        for member in bundle:
            name = member.name.rstrip('/') if member.isdir() else member.name
            require(name and len(name) <= 512 and re.fullmatch('[a-zA-Z0-9_./-]+', name)
                    and all(part not in ('', '.', '..') for part in name.split('/')), 'Unsafe archive path.')
            require(name not in seen, 'Duplicate archive path.')
            require(name == 'manifest.json' or name in ('dist', 'api') or name.startswith('dist/') or name in API_FILES, 'Unexpected archive entry.')
            require(not PRIVATE.search(name), 'Private files must not be published.')
            require(not re.search(r'(?:^|/)qa[^/]*\.html$', name), 'QA pages must not be published.')
            require(not name.startswith(('dist/api/', 'dist/server/')), 'Server files must stay outside the public root.')
            seen.add(name)
            if member.isdir():
                require(name != 'manifest.json' and name not in API_FILES, 'Expected a regular file.')
                continue
            require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and name not in ('api', 'dist')
                    and 0 <= member.size <= MAX_ARCHIVE, 'Links and special files forbidden.')
            expanded += member.size
            require(expanded <= MAX_EXPANDED, 'Expanded archive is too large.')
            if name == 'manifest.json':
                require(member.size <= MAX_MANIFEST, 'Manifest is too large.')
            if name in ('dist/release.json', 'api/release.json'):
                require(member.size <= 65536, 'Release identity is too large.')
            stream, checksum, remaining, chunks = bundle.extractfile(member), hashlib.sha256(), member.size, []
            capture = collect or name in ('manifest.json', 'dist/release.json', 'api/release.json')
            while remaining:
                data = stream.read(min(remaining, 1024 * 1024))
                require(data, 'Truncated archive.')
                checksum.update(data)
                remaining -= len(data)
                if capture:
                    chunks.append(data)
            if name == 'manifest.json':
                captured[name] = json_data(b''.join(chunks))
            else:
                observed[name] = {'size': member.size, 'sha256': checksum.hexdigest()}
                if name in ('dist/release.json', 'api/release.json'):
                    captured[name] = json_data(b''.join(chunks))
                if collect:
                    contents[name] = b''.join(chunks)
        while True:
            trailing = bundle.fileobj.read(1024 * 1024)
            if not trailing:
                break
            require(not trailing.strip(b'\0'), 'Unexpected trailing archive payload.')
    manifest = captured.get('manifest.json')
    require(isinstance(manifest, dict) and type(manifest.get('schema')) is int and manifest['schema'] in (1, 2), 'Unsupported artifact schema.')
    identity = {'schema': manifest['schema'], 'repository': REPOSITORY, 'commit': sha, 'runId': run_id, 'runAttempt': attempt}
    require(set(manifest) == set(identity) | {'files'} and all(type(manifest.get(key)) is type(value) and manifest[key] == value for key, value in identity.items()), 'Release identity does not match checked build.')
    require(same_identity(captured.get('dist/release.json'), identity) and 'dist/index.html' in observed, 'Missing game entrypoint or release identity.')
    require(isinstance(manifest.get('files'), dict) and manifest['files'] == observed, 'Manifest file inventory differs.')
    for metadata in manifest['files'].values():
        require(isinstance(metadata, dict) and set(metadata) == {'size', 'sha256'} and type(metadata['size']) is int, 'Invalid file metadata.')
    api_files = {name for name in observed if name.startswith('api/')}
    if identity['schema'] == 1:
        require(not api_files, 'Legacy artifacts cannot contain an API.')
    else:
        api = captured.get('api/release.json')
        require(isinstance(api, dict) and type(api.get('database')) is int and api['database'] in (1, 2)
                and api_files == API_FILES and same_identity(api, api_identity(identity, api['database'])),
                'API component identity or inventory differs.')
    return contents


def validate(archive, checksum, lease):
    digest = hashlib.sha256(archive).hexdigest()
    expected = digest + '  last-spire-' + str(lease['sha']) + '.tar.gz\n'
    require(len(checksum) <= 256 and checksum.decode('ascii') == expected, 'Release archive checksum mismatch.')
    inspect_archive(archive, lease['sha'], lease['run_id'], lease['attempt'])
    return digest
