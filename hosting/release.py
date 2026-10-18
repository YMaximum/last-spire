#!/usr/bin/env python3
"""Trusted host release command. Never run this inside an Actions worker."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parent))
from artifact_contract import inspect_archive

REPOSITORY = "YMaximum/last-spire"
WORKFLOW = ".github/workflows/checks.yml"
SHA = re.compile(r"^[a-f0-9]{40}$")
MAX_DOWNLOAD = 64 * 1024 * 1024
DOCKER = "/usr/bin/docker"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def commit_sha(value):
    require(isinstance(value, str) and SHA.fullmatch(value), "Expected a full lowercase commit SHA.")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def bounded_read(response, limit=MAX_DOWNLOAD):
    data = response.read(limit + 1)
    require(len(data) <= limit, "Download exceeds release size limit.")
    return data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token):
        self.token = token

    def request(self, suffix):
        # GitHub compare URLs require three dots. Allow only the exact endpoints
        # used for release verification rather than rejecting that separator.
        allowed = r"/(?:compare/[a-f0-9]{40}\.\.\.main|actions/workflows/checks\.yml|actions/runs/[1-9][0-9]*/attempts/[1-9][0-9]*)"
        require(isinstance(suffix, str) and re.fullmatch(allowed, suffix), "Invalid API path.")
        request = urllib.request.Request(
            "https://api.github.com/repos/" + REPOSITORY + suffix,
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "last-spire-release"})
        return urllib.request.build_opener(NoRedirect).open(request, timeout=30)

    def get(self, suffix):
        with self.request(suffix) as response:
            return json.loads(bounded_read(response, 4 * 1024 * 1024))


def checked_run(api, sha, run_id, attempt):
    sha = commit_sha(sha)
    comparison = api.get(f"/compare/{sha}...main")
    require(comparison.get("status") in ("ahead", "identical"), "Commit is not on merged main.")
    workflow = api.get("/actions/workflows/checks.yml")
    require(workflow.get("path") == WORKFLOW and workflow.get("state") == "active", "Unexpected checks workflow.")
    run = api.get(f"/actions/runs/{run_id}/attempts/{attempt}")
    require(run.get("id") == run_id and run.get("run_attempt") == attempt
            and run.get("head_sha") == sha and run.get("head_branch") == "main"
            and run.get("event") in ("push", "workflow_dispatch")
            and run.get("status") == "completed" and run.get("conclusion") == "success"
            and run.get("head_repository", {}).get("full_name") == REPOSITORY
            and run.get("workflow_id") == workflow["id"] and run.get("path") == WORKFLOW,
            "Stored artifact does not belong to a successful checked main run attempt.")
    return run


def release_files(archive, sha, run_id, attempt):
    return inspect_archive(archive, sha, run_id, attempt, collect=True)


def trusted_directory(path, owner_uid=0):
    try:
        info = path.lstat()
    except FileNotFoundError:
        raise ValueError("Checked artifact has not been collected on this host.") from None
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == owner_uid and not info.st_mode & 0o022,
            "Artifact directory must be host-owned and not writable by others.")


def trusted_regular(path, limit, owner_uid=0):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        raise ValueError("Host artifact or receipt is missing; verify collection.") from None
    with os.fdopen(descriptor, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == owner_uid and not info.st_mode & 0o022
                and info.st_nlink == 1 and 0 < info.st_size <= limit, "Unsafe host artifact file.")
        return bounded_read(source, limit)


def stored_artifact(api, sha, root=Path("/var/lib/last-spire/artifacts"), owner_uid=0):
    sha = commit_sha(sha)
    trusted_directory(root, owner_uid)
    directory = root / sha
    trusted_directory(directory, owner_uid)
    receipt = json.loads(trusted_regular(directory / "receipt.json", 65536, owner_uid))
    archive_name = "last-spire-" + sha + ".tar.gz"
    require(receipt.get("schema") == 1 and receipt.get("repository") == REPOSITORY
            and receipt.get("commit") == sha and receipt.get("workflowPath") == WORKFLOW
            and receipt.get("headBranch") == "main" and receipt.get("event") in ("push", "workflow_dispatch")
            and receipt.get("archive") == archive_name, "Host receipt identity differs.")
    require(type(receipt.get("runId")) is int and receipt["runId"] > 0
            and type(receipt.get("runAttempt")) is int and receipt["runAttempt"] > 0
            and type(receipt.get("size")) is int and 0 < receipt["size"] <= MAX_DOWNLOAD
            and isinstance(receipt.get("sha256"), str)
            and re.fullmatch(r"[a-f0-9]{64}", receipt["sha256"]), "Invalid host receipt metadata.")
    run = checked_run(api, sha, receipt["runId"], receipt["runAttempt"])
    require(receipt["event"] == run["event"], "Host receipt event differs from GitHub.")
    archive = trusted_regular(directory / archive_name, MAX_DOWNLOAD, owner_uid)
    require(len(archive) == receipt["size"] and digest(archive) == receipt["sha256"], "Stored archive checksum mismatch.")
    checksum = trusted_regular(directory / (archive_name + ".sha256"), 256, owner_uid).decode("ascii").strip()
    require(checksum == digest(archive) + "  " + archive_name, "Release archive checksum mismatch.")
    return release_files(archive, sha, receipt["runId"], receipt["runAttempt"])


def trusted_file(path, secret=False):
    info = path.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o022, "Host configuration must be root-owned and not writable by others.")
    if secret:
        require(not info.st_mode & 0o077, "Credential permissions must be 0600.")
    return path.read_text()


def load_config():
    config = json.loads(trusted_file(Path("/etc/last-spire/release.json")))
    require(re.fullmatch(r"nginxinc/nginx-unprivileged@sha256:[a-f0-9]{64}", config.get("image", "")), "Runtime image must be pinned by digest.")
    return config


def docker(*args):
    return subprocess.check_output([DOCKER, *args], text=True, stderr=subprocess.PIPE).strip()


def linked_release(root, name):
    path = root / name
    if not path.is_symlink():
        require(not path.exists(), "Release pointer must be a symlink.")
        return None
    sha = commit_sha(os.readlink(path))
    require((root / sha / "dist/release.json").is_file(), "Release pointer is missing its target.")
    return sha


def point(root, name, sha):
    temporary = root / ("." + name + ".next")
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(commit_sha(sha))
    os.replace(temporary, root / name)


def health(port, sha):
    base = f"http://127.0.0.1:{port}"
    with urllib.request.urlopen(base + "/healthz", timeout=3) as response:
        require(response.read() == b"ok\n", "Health endpoint failed.")
    with urllib.request.urlopen(base + "/release.json", timeout=3) as response:
        require(json.load(response).get("commit") == sha, "Served commit differs.")
    with urllib.request.urlopen(base + "/", timeout=3) as response:
        require(response.headers.get("X-Content-Type-Options") == "nosniff"
                and response.headers.get("Referrer-Policy") == "no-referrer"
                and "default-src 'self'" in response.headers.get("Content-Security-Policy", ""), "Missing security headers.")
        html = response.read(1024 * 1024).decode("utf-8")
    assets = re.findall(r'(?:src|href)="(/assets/[^"<>]+)"', html)
    require(assets, "Game assets missing from entrypoint.")
    for asset in assets:
        with urllib.request.urlopen(base + asset, timeout=3) as response:
            require(response.status == 200 and len(response.read(1)) == 1, "Game asset could not be loaded.")


def wait_healthy(port, sha):
    for attempt in range(20):
        try:
            health(port, sha)
            return
        except (OSError, ValueError):
            if attempt == 19:
                raise
            time.sleep(0.5)


def runtime_args(config, name, root, nginx, port):
    return ["run", "-d", "--name", name, "--label", "io.last-spire.managed=true",
            "--read-only", "--user", "101:101", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true", "--memory", "128m", "--memory-swap", "128m",
            "--cpus", "0.25", "--pids-limit", "64", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m,mode=1777",
            "--mount", f"type=bind,src={root},dst=/srv/releases,readonly",
            "--mount", f"type=bind,src={nginx},dst=/etc/nginx/nginx.conf,readonly",
            "-p", f"127.0.0.1:{port}:8080", "--entrypoint", "nginx", config["image"], "-g", "daemon off;"]


def ensure_runtime(config, root):
    names = docker("container", "ls", "-a", "--filter", "name=last-spire", "--format", "{{.Names}}").splitlines()
    if "last-spire" in names:
        info = json.loads(docker("inspect", "last-spire"))[0]
        require(info["Config"].get("Labels", {}).get("io.last-spire.managed") == "true"
                and info["Config"]["Image"] == config["image"] and info["State"]["Running"], "Existing runtime needs administrative review.")
        return False
    args = runtime_args(config, "last-spire", root, "/etc/last-spire/nginx.conf", "8091")
    args[2:2] = ["--restart", "unless-stopped"]
    docker(*args)
    return True


def validate_candidate(config, root, sha):
    name = "last-spire-candidate-" + sha[:12]
    nginx = root.parent / "candidate-nginx.conf"
    source = trusted_file(Path("/etc/last-spire/nginx.conf"))
    require("/srv/releases/current/dist" in source, "Unexpected production nginx config.")
    nginx.write_text(source.replace("/srv/releases/current/dist", f"/srv/releases/{sha}/dist"))
    nginx.chmod(0o644)
    started = False
    try:
        docker(*runtime_args(config, name, root, nginx, ""))
        started = True
        info = json.loads(docker("inspect", name))[0]
        port = int(info["NetworkSettings"]["Ports"]["8080/tcp"][0]["HostPort"])
        wait_healthy(port, sha)
    finally:
        if started:
            docker("rm", "-f", name)
        nginx.unlink(missing_ok=True)


def install_release(root, sha, files):
    target = root / sha
    if target.exists():
        verify_installed(root, sha)
        receipt = json.loads((target / "receipt.json").read_text())
        expected = {name: {"size": len(data), "sha256": digest(data)} for name, data in files.items()}
        require(receipt["files"] == expected, "Existing immutable release differs from artifact.")
        return
    stage = Path(tempfile.mkdtemp(prefix=".incoming-", dir=root))
    try:
        stage.chmod(0o755)
        for name, data in files.items():
            output = stage / name
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)
            output.chmod(0o644)
        receipt = {"commit": sha, "files": {name: {"sha256": digest(data), "size": len(data)} for name, data in files.items()}}
        (stage / "receipt.json").write_text(json.dumps(receipt))
        (stage / "receipt.json").chmod(0o644)
        os.rename(stage, target)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def verify_installed(root, sha):
    target = root / commit_sha(sha)
    receipt = json.loads((target / "receipt.json").read_text())
    require(receipt.get("commit") == sha and isinstance(receipt.get("files"), dict), "Invalid installed release receipt.")
    files = {}
    for path in target.rglob("*"):
        require(not path.is_symlink(), "Installed release contains a link.")
        if path.is_file():
            data = path.read_bytes()
            if path.relative_to(target).as_posix() != "receipt.json":
                files[path.relative_to(target).as_posix()] = {"size": len(data), "sha256": digest(data)}
    require(files == receipt["files"], "Installed release checksum mismatch.")


def activate(config, root, sha):
    current = linked_release(root, "current")
    previous = linked_release(root, "previous")
    verify_installed(root, sha)
    if current == sha:
        wait_healthy(8091, sha)
        print("Already serving " + sha)
        return
    validate_candidate(config, root, sha)
    created_runtime = False
    try:
        # Persist the rollback target before switching, including interrupted SSH sessions.
        if current:
            point(root, "previous", current)
        point(root, "current", sha)
        created_runtime = ensure_runtime(config, root)
        wait_healthy(8091, sha)
    except Exception:
        if current:
            point(root, "current", current)
        else:
            (root / "current").unlink(missing_ok=True)
            if created_runtime:
                docker("rm", "-f", "last-spire")
        if previous:
            point(root, "previous", previous)
        else:
            (root / "previous").unlink(missing_ok=True)
        raise
    print("Serving checked release " + sha)


def main():
    require(os.geteuid() == 0, "Run the restricted command through sudo.")
    os.umask(0o022)
    require(len(sys.argv) in (2, 3) and sys.argv[1] in ("deploy", "rollback"), "Expected deploy <sha> or rollback.")
    config = load_config()
    root = Path("/var/lib/last-spire/releases")
    root.mkdir(parents=True, exist_ok=True)
    with open("/run/lock/last-spire-release.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == "rollback":
            require(len(sys.argv) == 2, "Rollback accepts no arguments.")
            sha = linked_release(root, "previous")
            require(sha is not None, "No previous release exists.")
        else:
            require(len(sys.argv) == 3, "Deploy requires exactly one SHA.")
            sha = commit_sha(sys.argv[2])
            token = trusted_file(Path("/etc/last-spire/github-token"), secret=True).strip()
            require(token and not any(char.isspace() for char in token), "Missing deployment API credential.")
            api = GitHub(token)
            files = stored_artifact(api, sha)
            install_release(root, sha, files)
        activate(config, root, sha)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Avoid printing API responses, tokens, signed download URLs, or command output.
        safe = str(error) if isinstance(error, ValueError) else type(error).__name__
        print("Release refused: " + safe, file=sys.stderr)
        sys.exit(1)
