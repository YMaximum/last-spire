#!/usr/bin/env python3
"""Prepare/apply a reviewed archive-validator upgrade under the existing scheduler lock."""
import argparse
import ast
import fcntl
import hashlib
import os
from pathlib import Path
import stat
import sys


def transform(source, expected):
    if hashlib.sha256(source.encode()).hexdigest() != expected:
        raise ValueError('Collector source differs from the reviewed baseline.')
    functions = [node for node in ast.parse(source).body if isinstance(node, ast.FunctionDef) and node.name == 'validate']
    if len(functions) != 1 or [arg.arg for arg in functions[0].args.args] != ['archive', 'checksum', 'lease'] or functions[0].decorator_list:
        raise ValueError('Unexpected collector validation interface.')
    node, lines = functions[0], source.splitlines(keepends=True)
    replacement = ('def validate(archive,checksum,lease):\n'
                   ' from last_spire_artifact_contract import validate as checked_contract\n'
                   ' return checked_contract(archive,checksum,lease)\n')
    result = ''.join(lines[:node.lineno - 1]) + replacement + ''.join(lines[node.end_lineno:])
    ast.parse(result)
    return result


def trusted(path, directory=False):
    info = path.lstat()
    sticky_lock = directory and path == Path('/run/lock') and info.st_mode & stat.S_ISVTX
    if path.is_symlink() or info.st_uid != 0 or (info.st_mode & 0o022 and not sticky_lock) or not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1):
        raise ValueError('Expected a root-owned trusted installation path.')


def atomic(path, data, mode=0o644):
    temporary = path.with_name('.' + path.name + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('collector', type=Path)
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--scheduler-lock', type=Path)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    source = args.collector.read_text()
    result = transform(source, args.expected_sha256)
    if not args.apply:
        print('Dry run passed: only the archive validation function will change. Nothing installed.')
        return
    if os.geteuid() != 0 or not args.scheduler_lock or not args.collector.is_absolute() or not args.scheduler_lock.is_absolute():
        raise ValueError('Apply requires root and the existing absolute scheduler-lock path.')
    for directory in [args.collector.parent, *args.collector.parent.parents, args.scheduler_lock.parent]:
        trusted(directory, True)
    trusted(args.collector)
    fd = os.open(args.scheduler_lock, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        trusted(args.scheduler_lock)
        if args.collector.read_text() != source:
            raise ValueError('Collector changed during upgrade; refusing replacement.')
        backup = args.collector.with_name(args.collector.name + '.before-' + args.expected_sha256[:12])
        if backup.exists():
            raise ValueError('Backup already exists; inspect the previous attempt first.')
        atomic(backup, source.encode(), 0o600)
        contract = Path(__file__).with_name('artifact_contract.py').read_bytes()
        atomic(args.collector.parent / 'last_spire_artifact_contract.py', contract)
        atomic(args.collector, result.encode())
    finally:
        os.close(fd)
    print('Reviewed validator installed. No workers, deployments, credentials, or collection gates changed.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.exit('Collector upgrade refused. Inspect the trusted baseline, scheduler state and private recovery copy.')
