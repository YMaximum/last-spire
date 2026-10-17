import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).parents[1] / "release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = "a" * 40
OLD = "b" * 40
PREVIOUS = "c" * 40
RUN = 42


def fixture_files(sha=SHA):
    identity = {"schema": 1, "repository": release.REPOSITORY, "commit": sha, "runId": RUN, "runAttempt": 1}
    return {"dist/index.html": b'<script src="/assets/game.js"></script>',
            "dist/assets/game.js": b"console.log('Last Spire');",
            "dist/release.json": json.dumps(identity).encode()}


def tar_bytes(files=None, manifest_update=None, extra=None):
    files = fixture_files() if files is None else files
    manifest = {"schema": 1, "repository": release.REPOSITORY, "commit": SHA, "runId": RUN, "runAttempt": 1,
                "files": {name: {"size": len(data), "sha256": release.digest(data)} for name, data in files.items()}}
    if manifest_update:
        manifest_update(manifest)
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w:gz") as bundle:
        for name, contents in {"manifest.json": json.dumps(manifest).encode(), **files}.items():
            info = tarfile.TarInfo(name)
            info.size = len(contents)
            bundle.addfile(info, io.BytesIO(contents))
        if extra:
            bundle.addfile(extra, io.BytesIO(b"x" * extra.size) if extra.isfile() else None)
    return data.getvalue()


class FakeAPI:
    def __init__(self):
        self.comparison = {"status": "ahead"}
        self.workflow = {"id": 7, "path": release.WORKFLOW, "state": "active"}
        self.run = {"id": RUN, "run_attempt": 1, "path": release.WORKFLOW, "head_sha": SHA, "head_branch": "main", "event": "push", "status": "completed",
                    "conclusion": "success", "head_repository": {"full_name": release.REPOSITORY}, "workflow_id": 7}

    def get(self, path):
        if path.startswith("/compare/"):
            return self.comparison
        if path == "/actions/workflows/checks.yml":
            return self.workflow
        return self.run


class GitHubRequestTests(unittest.TestCase):
    def test_checked_run_uses_validated_real_request_paths(self):
        fixture = FakeAPI()
        expected = [
            (f"/compare/{SHA}...main", fixture.comparison),
            ("/actions/workflows/checks.yml", fixture.workflow),
            (f"/actions/runs/{RUN}/attempts/1", fixture.run),
        ]
        requests = []

        def respond(request, timeout):
            suffix, payload = expected[len(requests)]
            self.assertEqual(request.full_url, "https://api.github.com/repos/" + release.REPOSITORY + suffix)
            self.assertEqual(timeout, 30)
            requests.append(request)
            return io.BytesIO(json.dumps(payload).encode())

        with patch.object(release.urllib.request, "build_opener") as opener:
            opener.return_value.open.side_effect = respond
            result = release.checked_run(release.GitHub("test-only"), SHA, RUN, 1)
        self.assertEqual(result, fixture.run)
        self.assertEqual(len(requests), 3)

    def test_unexpected_request_paths_rejected_before_transport(self):
        paths = [
            None, 7, "", "https://example.com/", "//example.com/",
            "/../other", "/actions/../secrets", "/actions/%2e%2e/secrets",
            "/actions/workflows/checks.yml?redirect=elsewhere",
            "/actions/workflows/other.yml", "/actions/workflows/checks.yml/",
            "/actions/runs/0/attempts/1", "/actions/runs/42/attempts/0",
            "/actions/runs/42/attempts/1#fragment", "/actions/runs/42/attempts/1\n",
            f"/compare/{SHA}...other", f"/compare/{SHA}/../main",
        ]
        with patch.object(release.urllib.request, "build_opener") as opener:
            for path in paths:
                with self.subTest(path=path), self.assertRaisesRegex(ValueError, "Invalid API path"):
                    release.GitHub("test-only").request(path)
            opener.assert_not_called()


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.directory = self.root / SHA
        self.directory.mkdir(mode=0o700)
        self.name = "last-spire-" + SHA + ".tar.gz"
        self.archive_path = self.directory / self.name
        self.store()

    def store(self, receipt_update=None, checksum=None):
        archive = tar_bytes()
        receipt = {"schema": 1, "repository": release.REPOSITORY, "commit": SHA, "runId": RUN,
                   "runAttempt": 1, "workflowPath": release.WORKFLOW, "event": "push", "headBranch": "main",
                   "archive": self.name, "sha256": release.digest(archive), "size": len(archive)}
        if receipt_update:
            receipt.update(receipt_update)
        self.archive_path.write_bytes(archive)
        (self.directory / (self.name + ".sha256")).write_text(checksum or release.digest(archive) + "  " + self.name + "\n")
        (self.directory / "receipt.json").write_text(json.dumps(receipt))
        for path in self.directory.iterdir():
            path.chmod(0o600)

    def load(self):
        return release.stored_artifact(FakeAPI(), SHA, self.root, os.getuid())

    def test_valid_checked_artifact(self):
        self.assertEqual(self.load(), fixture_files())

    def test_missing_collection_receipt_is_explicit(self):
        (self.directory / "receipt.json").unlink()
        with self.assertRaisesRegex(ValueError, "receipt is missing"):
            self.load()

    def test_full_commit_only(self):
        for value in ("main", "abc", "A" * 40, SHA + ";id", "../" + SHA, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                release.commit_sha(value)

    def test_tampered_stored_archive(self):
        self.archive_path.write_bytes(b"tampered")
        with self.assertRaisesRegex(ValueError, "Stored archive checksum"):
            self.load()

    def test_tampered_archive_checksum(self):
        self.store(checksum="wrong")
        with self.assertRaisesRegex(ValueError, "archive checksum"):
            self.load()

    def test_invalid_receipt_identity_and_metadata(self):
        cases = {"commit": OLD, "repository": "fork/repo", "runAttempt": True, "runId": 0,
                 "workflowPath": "other.yml", "headBranch": "feature", "event": "pull_request",
                 "archive": "../other", "sha256": "bad", "size": release.MAX_DOWNLOAD + 1}
        for key, value in cases.items():
            self.store({key: value})
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.load()

    def test_linked_or_writable_host_files_are_rejected(self):
        outside = self.root / "archive"
        outside.write_bytes(self.archive_path.read_bytes())
        self.archive_path.unlink()
        self.archive_path.symlink_to(outside)
        with self.assertRaises((OSError, ValueError)):
            self.load()
        self.archive_path.unlink()
        os.link(outside, self.archive_path)
        with self.assertRaisesRegex(ValueError, "Unsafe host artifact"):
            self.load()
        self.archive_path.unlink()
        self.store()
        self.archive_path.chmod(0o666)
        with self.assertRaisesRegex(ValueError, "Unsafe host artifact"):
            self.load()

    def test_wrong_owner_and_directory_links_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unsafe host artifact"):
            release.trusted_regular(self.archive_path, release.MAX_DOWNLOAD, os.getuid() + 1)
        self.directory.rename(self.root / "actual")
        self.directory.symlink_to(self.root / "actual", target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "Artifact directory"):
            self.load()

    def test_path_traversal_and_special_files(self):
        for name in ("../escape", "/dist/escape", "dist/../escape", "dist//escape", "dist/./escape", "outside"):
            info = tarfile.TarInfo(name)
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.release_files(tar_bytes(extra=info), SHA, RUN, 1)
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE):
            info = tarfile.TarInfo("dist/link")
            info.type = kind
            info.linkname = "/etc/passwd"
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                release.release_files(tar_bytes(extra=info), SHA, RUN, 1)

    def test_duplicate_tar_member(self):
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            release.release_files(tar_bytes(extra=tarfile.TarInfo("dist/index.html")), SHA, RUN, 1)

    def test_wrong_identity_and_manifest(self):
        mutations = [lambda m: m.update(commit=OLD), lambda m: m.update(runId=RUN + 1), lambda m: m.update(runAttempt=2),
                     lambda m: m.update(repository="other/repo"), lambda m: m["files"].pop("dist/index.html"),
                     lambda m: m["files"]["dist/index.html"].update(sha256="bad"),
                     lambda m: m["files"]["dist/index.html"].update(size=True)]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                release.release_files(tar_bytes(manifest_update=mutate), SHA, RUN, 1)

    def test_qa_pages_rejected(self):
        files = fixture_files()
        files["dist/qa-v3.html"] = b"private QA"
        with self.assertRaisesRegex(ValueError, "QA pages"):
            release.release_files(tar_bytes(files), SHA, RUN, 1)

    def test_expansion_bound(self):
        with patch.object(release, "MAX_EXPANDED", 10), self.assertRaisesRegex(ValueError, "too large"):
            release.release_files(tar_bytes(), SHA, RUN, 1)

    def test_exact_main_successful_attempt_is_required(self):
        api = FakeAPI()
        self.assertEqual(release.checked_run(api, SHA, RUN, 1), api.run)
        cases = [("comparison", "status", "diverged"), ("comparison", "status", "behind"),
                 ("run", "head_branch", "feature"), ("run", "head_sha", OLD),
                 ("run", "event", "pull_request"), ("run", "conclusion", "failure"),
                 ("run", "head_repository", {"full_name": "fork/repo"}), ("run", "workflow_id", 99),
                 ("run", "run_attempt", 2), ("run", "id", RUN + 1), ("run", "path", "other.yml")]
        for target, key, value in cases:
            broken = FakeAPI()
            getattr(broken, target)[key] = value
            with self.subTest(target=target, key=key), self.assertRaises(ValueError):
                release.checked_run(broken, SHA, RUN, 1)


class ActivationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        for sha in (SHA, OLD, PREVIOUS):
            release.install_release(self.root, sha, fixture_files(sha))
        release.point(self.root, "current", OLD)
        release.point(self.root, "previous", PREVIOUS)

    def test_failed_candidate_leaves_pointers_unchanged(self):
        with patch.object(release, "validate_candidate", side_effect=ValueError("bad candidate")), self.assertRaises(ValueError):
            release.activate({}, self.root, SHA)
        self.assertEqual(release.linked_release(self.root, "current"), OLD)
        self.assertEqual(release.linked_release(self.root, "previous"), PREVIOUS)

    def test_failed_live_health_restores_previous_state(self):
        with patch.object(release, "validate_candidate"), patch.object(release, "ensure_runtime", return_value=False), \
                patch.object(release, "wait_healthy", side_effect=ValueError("bad live health")), self.assertRaises(ValueError):
            release.activate({}, self.root, SHA)
        self.assertEqual(release.linked_release(self.root, "current"), OLD)
        self.assertEqual(release.linked_release(self.root, "previous"), PREVIOUS)

    def test_promotion_and_rollback(self):
        with patch.object(release, "validate_candidate"), patch.object(release, "ensure_runtime", return_value=False), \
                patch.object(release, "wait_healthy"):
            release.activate({}, self.root, SHA)
            self.assertEqual(release.linked_release(self.root, "previous"), OLD)
            release.activate({}, self.root, OLD)
        self.assertEqual(release.linked_release(self.root, "current"), OLD)
        self.assertEqual(release.linked_release(self.root, "previous"), SHA)

    def test_same_release_does_not_replace_rollback_target(self):
        with patch.object(release, "wait_healthy"), patch.object(release, "validate_candidate") as candidate:
            release.activate({}, self.root, OLD)
        candidate.assert_not_called()
        self.assertEqual(release.linked_release(self.root, "previous"), PREVIOUS)

    def test_install_is_immutable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release.install_release(root, SHA, fixture_files())
            release.install_release(root, SHA, fixture_files())
            changed = fixture_files()
            changed["dist/index.html"] = b"changed"
            with self.assertRaisesRegex(ValueError, "immutable"):
                release.install_release(root, SHA, changed)

    def test_corrupted_retained_release_cannot_be_promoted(self):
        (self.root / PREVIOUS / "dist/index.html").write_text("corrupted")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            release.activate({}, self.root, PREVIOUS)
        self.assertEqual(release.linked_release(self.root, "current"), OLD)

    def test_first_release_failed_health_removes_pointer_and_own_container(self):
        (self.root / "current").unlink()
        (self.root / "previous").unlink()
        with patch.object(release, "validate_candidate"), patch.object(release, "ensure_runtime", return_value=True), \
                patch.object(release, "wait_healthy", side_effect=ValueError("bad health")), \
                patch.object(release, "docker") as docker, self.assertRaises(ValueError):
            release.activate({}, self.root, SHA)
        self.assertFalse((self.root / "current").is_symlink())
        self.assertFalse((self.root / "previous").is_symlink())
        docker.assert_called_once_with("rm", "-f", "last-spire")

    def test_docker_is_unprivileged_and_loopback_only(self):
        args = release.runtime_args({"image": "pinned-image"}, "last-spire", "/releases", "/config", "8091")
        for flag in ("--read-only", "--cap-drop", "--memory", "--cpus", "--pids-limit", "no-new-privileges:true"):
            self.assertIn(flag, args)
        self.assertIn("127.0.0.1:8091:8080", args)
        self.assertNotIn("/var/run/docker.sock", " ".join(args))
        self.assertIn("type=bind,src=/releases,dst=/srv/releases,readonly", args)

    def test_existing_runtime_is_reused_and_unowned_name_is_rejected(self):
        info = {"Config": {"Image": "pinned", "Labels": {"io.last-spire.managed": "true"}}, "State": {"Running": True}}
        with patch.object(release, "docker", side_effect=["last-spire-candidate\nlast-spire", json.dumps([info])]) as docker:
            self.assertFalse(release.ensure_runtime({"image": "pinned"}, self.root))
            self.assertEqual(docker.call_count, 2)
        info["Config"]["Labels"] = {}
        with patch.object(release, "docker", side_effect=["last-spire", json.dumps([info])]), self.assertRaisesRegex(ValueError, "administrative review"):
            release.ensure_runtime({"image": "pinned"}, self.root)

    def test_candidate_name_does_not_hide_missing_main_runtime(self):
        with patch.object(release, "docker", side_effect=["last-spire-candidate", "created"]) as docker:
            self.assertTrue(release.ensure_runtime({"image": "pinned"}, self.root))
            self.assertIn("--restart", docker.call_args.args)


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.script = Path(__file__).parents[2] / "scripts/package-release.mjs"
        for args in (["init", "-q"], ["-c", "user.name=Release test", "-c", "user.email=test@example.invalid",
                                    "commit", "--allow-empty", "-qm", "fixture"]):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        self.sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.root, text=True).strip()
        (self.root / "dist/assets").mkdir(parents=True)
        (self.root / "dist/index.html").write_text('<script src="/assets/game.js"></script>')
        (self.root / "dist/assets/game.js").write_text("console.log('game');")
        self.env = {**os.environ, "GITHUB_SHA": self.sha, "GITHUB_REF": "refs/heads/main", "GITHUB_RUN_ID": str(RUN), "GITHUB_RUN_ATTEMPT": "1"}

    def package(self):
        return subprocess.run(["node", str(self.script.resolve())], cwd=self.root, env=self.env, capture_output=True)

    def test_packager_matches_host_contract_and_is_repeatable(self):
        result = self.package()
        self.assertEqual(result.returncode, 0, result.stderr)
        path = self.root / ".release" / ("last-spire-" + self.sha + ".tar.gz")
        first = path.read_bytes()
        files = release.release_files(first, self.sha, RUN, 1)
        self.assertIn("dist/assets/game.js", files)
        self.assertEqual(self.package().returncode, 0)
        self.assertEqual(path.read_bytes(), first)

    def test_packager_rejects_non_main_and_qa_pages(self):
        self.env["GITHUB_REF"] = "refs/heads/feature"
        self.assertNotEqual(self.package().returncode, 0)
        self.env["GITHUB_REF"] = "refs/heads/main"
        (self.root / "dist/qa-v3.html").write_text("do not publish")
        self.assertNotEqual(self.package().returncode, 0)
        self.assertFalse((self.root / ".release").exists())

    def test_packager_refuses_private_files_in_build_output(self):
        (self.root / "dist/.private").mkdir()
        (self.root / "dist/.private/probe.txt").write_text("not-a-real-secret")
        self.assertNotEqual(self.package().returncode, 0)
        self.assertFalse((self.root / ".release").exists())


if __name__ == "__main__":
    unittest.main()
