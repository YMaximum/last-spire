#!/usr/bin/env python3
"""Trusted host release command. Never run this inside an Actions worker."""
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

REPOSITORY = "YMaximum/last-spire"
WORKFLOW = ".github/workflows/checks.yml"
SHA = re.compile(r"^[a-f0-9]{40}$")
MAX_DOWNLOAD = 64 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
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
        require(suffix.startswith("/") and ".." not in suffix, "Invalid API path.")
        request = urllib.request.Request(
            "https://api.github.com/repos/" + REPOSITORY + suffix,
            headers={"Authorization": "Bearer " + self.token,
                     "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "last-spire-release"})
        return urllib.request.build_opener(NoRedirect).open(request, timeout=30)

    def get(self, suffix):
        with self.request(suffix) as response:
            return json.loads(bounded_read(response, 4 * 1024 * 1024))

    def download(self, artifact_id):
        try:
            with self.request(f"/actions/artifacts/{artifact_id}/zip") as response:
                return bounded_read(response)
        except urllib.error.HTTPError as error:
            require(error.code == 302, "Artifact download was rejected.")
            location = error.headers.get("Location", "")
            require(location.startswith("https://"), "Artifact redirect must use HTTPS.")
            # A fresh request intentionally omits Authorization on the storage host.
            with urllib.request.urlopen(location, timeout=60) as response:
                return bounded_read(response)


def checked_artifact(api, sha):
    sha = commit_sha(sha)
    comparison = api.get(f"/compare/{sha}...main")
    require(comparison.get("status") in ("ahead", "identical"), "Commit is not on merged main.")
    workflow = api.get("/actions/workflows/checks.yml")
    require(workflow.get("path") == WORKFLOW and workflow.get("state") == "active", "Unexpected checks workflow.")
    runs = api.get(f"/actions/workflows/{workflow['id']}/runs?head_sha={sha}&status=success&per_page=100")
    for run in runs.get("workflow_runs", []):
        if not (run.get("head_sha") == sha and run.get("head_branch") == "main"
                and run.get("event") in ("push", "workflow_dispatch")
                and run.get("status") == "completed" and run.get("conclusion") == "success"
                and run.get("head_repository", {}).get("full_name") == REPOSITORY
                and run.get("workflow_id") == workflow["id"]):
            continue
        artifacts = api.get(f"/actions/runs/{run['id']}/artifacts?per_page=100")
        for artifact in artifacts.get("artifacts", []):
            if artifact.get("name") == "last-spire-" + sha and not artifact.get("expired"):
                require(re.fullmatch(r"sha256:[a-f0-9]{64}", artifact.get("digest", "")), "Missing GitHub artifact digest.")
                require(0 < artifact.get("size_in_bytes", 0) <= MAX_DOWNLOAD, "Artifact size is invalid.")
                return run, artifact
    raise ValueError("No successful main build with an unexpired release artifact exists for this commit.")


def release_files(archive, sha, run_id):
    files = {}
    total = 0
    entries = set()
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r|gz") as bundle:
        for member in bundle:
            name = member.name.rstrip("/") if member.isdir() else member.name
            parts = name.split("/")
            require(name and all(part not in ("", ".", "..") for part in parts)
                    and not PurePosixPath(name).is_absolute()
                    and re.fullmatch(r"[a-zA-Z0-9_./-]+", name), "Unsafe archive path.")
            require(name not in entries, "Duplicate archive path.")
            entries.add(name)
            require(len(entries) <= 4096, "Too many archive entries.")
            require(name == "manifest.json" or name == "dist" or name.startswith("dist/"), "Unexpected archive entry.")
            if member.isdir():
                require(name != "manifest.json", "Manifest must be a file.")
                continue
            require(member.isfile() and name != "dist", "Links and special files are forbidden.")
            total += member.size
            require(0 <= member.size <= MAX_EXPANDED and total <= MAX_EXPANDED, "Expanded archive is too large.")
            files[name] = bundle.extractfile(member).read()
    require("manifest.json" in files, "Missing release manifest.")
    manifest = json.loads(files.pop("manifest.json"))
    expected = {"schema": 1, "repository": REPOSITORY, "commit": sha, "runId": run_id}
    require(all(manifest.get(key) == value for key, value in expected.items()), "Release identity does not match checked build.")
    require(isinstance(manifest.get("files"), dict) and set(manifest["files"]) == set(files), "Manifest file list differs.")
    require("dist/index.html" in files and "dist/release.json" in files, "Missing game entrypoint or release identity.")
    require(not any(re.search(r"(?:^|/)qa[^/]*\.html$", name) for name in files), "QA pages must not be published.")
    for name, data in files.items():
        metadata = manifest["files"][name]
        require(isinstance(metadata, dict) and type(metadata.get("size")) is int
                and metadata["size"] == len(data) and metadata.get("sha256") == digest(data), "File checksum mismatch.")
    require(json.loads(files["dist/release.json"]) == expected, "Served release identity differs.")
    return files


def unpack_artifact(data, artifact, sha, run_id):
    require("sha256:" + digest(data) == artifact["digest"], "GitHub artifact checksum mismatch.")
    archive_name = "last-spire-" + sha + ".tar.gz"
    with zipfile.ZipFile(io.BytesIO(data)) as bundle:
        require(set(bundle.namelist()) == {archive_name, archive_name + ".sha256"}
                and len(bundle.infolist()) == 2, "Unexpected artifact contents.")
        require(all(0 < info.file_size <= MAX_DOWNLOAD for info in bundle.infolist())
                and sum(info.file_size for info in bundle.infolist()) <= MAX_DOWNLOAD, "Artifact expansion is too large.")
        archive = bundle.read(archive_name)
        checksum = bundle.read(archive_name + ".sha256").decode("ascii").strip()
    require(checksum == digest(archive) + "  " + archive_name, "Release archive checksum mismatch.")
    return release_files(archive, sha, run_id)


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
        existing = {"dist/" + str(path.relative_to(target / "dist")): path.read_bytes()
                    for path in (target / "dist").rglob("*") if path.is_file()}
        require(existing == files, "Existing immutable release differs from artifact.")
        verify_installed(root, sha)
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
    for path in (target / "dist").rglob("*"):
        require(not path.is_symlink(), "Installed release contains a link.")
        if path.is_file():
            data = path.read_bytes()
            files["dist/" + path.relative_to(target / "dist").as_posix()] = {"size": len(data), "sha256": digest(data)}
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
            run, artifact = checked_artifact(api, sha)
            files = unpack_artifact(api.download(artifact["id"]), artifact, sha, run["id"])
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
