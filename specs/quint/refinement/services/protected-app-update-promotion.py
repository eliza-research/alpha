"""Drive the current release admission and private media helpers through closed ports."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path.cwd()
spec = importlib.util.spec_from_file_location("qualified_fixture", ROOT / "test/qualified-app-update.test.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
bridge = fixtures.BRIDGE
storage = bridge.STORAGE

# Every gh invocation is constrained to one synthetic endpoint table.
GH = """#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
assert len(sys.argv) == 3 and sys.argv[1] == 'api'
response = json.loads(Path(os.environ['GH_FIXTURE']).read_bytes())[sys.argv[2]]
if isinstance(response, str):
    sys.stdout.buffer.write(Path(response).read_bytes())
else:
    print(json.dumps(response))
"""


class Response(io.BytesIO):
    def __init__(self, content, status=200):
        super().__init__(content)
        self.status = status


class MediaPort:
    def __init__(self, metadata, content, failure="ok"):
        self.metadata = metadata
        self.content = content
        self.failure = failure
        self.committed = None
        self.received = 0

    def request(self, method, route, headers, body=None):
        query = parse_qs(urlsplit(route).query)
        if method == "GET":
            assert query["generation"] == [self.metadata["requestedGeneration"]]
            if query.get("alt") == ["media"]:
                self.response = Response(self.content)
            else:
                self.response = Response(json.dumps(self.metadata).encode())
            return
        assert method == "POST" and query["ifGenerationMatch"] == ["0"]
        assert query["name"] == [self.metadata["name"]]
        assert int(headers["Content-Length"]) == int(self.metadata["size"])
        if self.committed is not None:
            self.response = Response(b"{}", 412)
        elif self.failure == "before":
            raise OSError("closed port failed before upload")
        elif self.failure == "partial":
            self.received = len(body.read(1024))
            assert 0 < self.received < int(self.metadata["size"])
            raise OSError("closed port dropped the partial body")
        else:
            self.committed = body.read()
            self.received = len(self.committed)
            assert self.committed == self.content
            if self.failure == "after":
                raise OSError("closed port lost response after commit")
            self.response = Response(json.dumps(self.metadata).encode())

    def getresponse(self):
        return self.response

    def close(self):
        pass


def media_port(name, generation, data, **metadata):
    return MediaPort({"bucket": storage.BUCKET, "name": name, "generation": generation,
                      "requestedGeneration": generation, "size": str(len(data)), **metadata}, data)


def actions(label, *args):
    return {"name": label, "args": args}


def blank():
    return {"lane": "none", "plan": False, "unsigned": False, "object": False,
            "privateReceipt": False, "review": False, "restored": False}


def campaign(scratch, signing_commit, name, schedule):
    fixture = fixtures.QualifiedUpdateTest()
    fixture.setUp()
    state = blank()
    trace = {"name": name, "expect": {"s": blank()}, "steps": []}
    plan = copy.deepcopy(fixture.plan)
    repo = bridge.REPOSITORY
    prefix = f"repos/{repo}"
    number, artifact = "171", "202"
    stage = fixture.directory / "unsigned"
    unsigned = fixture.producer.archive.read_bytes()
    signed = fixture.signed_tar.read_bytes()
    delivered = None
    restored_product = None
    private_port = media_port(plan["privateStorage"]["outputObject"], "456", signed)
    source_summaries = []

    def signing_command(lane, fault, output, stage_path=None):
        dispatch_plan = copy.deepcopy(plan)
        if lane != "private":
            dispatch_plan.pop("privateStorage")
            dispatch_plan.update(producerRunId=number, artifactId=artifact)
        endpoints = {
            f"{prefix}/compare/{plan['alphaCommit']}...{signing_commit}": {
                "status": "ahead" if fault != "source" else "diverged",
                "merge_base_commit": {"sha": plan["alphaCommit"]},
            },
            f"{prefix}/actions/runs/{number}": {
                "status": "completed", "conclusion": "cancelled" if fault == "cancelled" else "success",
                "id": int(number), "head_sha": plan["alphaCommit"], "head_branch": "main",
                "repository": {"id": 1396333361, "full_name": repo},
                "head_repository": {"id": 1396333361, "full_name": repo},
                "path": ".github/workflows/resident-android.yml",
                "event": "push" if lane == "push" else "workflow_dispatch",
                "run_attempt": 2 if fault == "attempt" else 1,
            },
            f"{prefix}/actions/artifacts/{artifact}": {
                "id": int(artifact), "expired": fault == "expired", "workflow_run": {
                    "id": int(number), "head_sha": plan["alphaCommit"], "head_branch": "main",
                    "repository_id": 1396333361, "head_repository_id": 1396333361},
                "digest": "sha256:" + plan["archiveSHA256"], "size_in_bytes": len(unsigned),
                "name": f"resident-distribution-archive-{plan['alphaCommit']}-{number}",
            },
            f"{prefix}/actions/artifacts/{artifact}/zip": str(fixture.producer.archive),
        }
        if fault == "plan":
            dispatch_plan["privateStorage"]["inputGeneration"] = "latest"
        endpoints_path = fixture.directory / "github.json"
        endpoints_path.write_text(json.dumps(endpoints))
        plan_bytes = json.dumps(dispatch_plan).encode()
        args = ["bash", "scripts/ci/verify-cloud-signing-input.sh"]
        if stage_path:
            args.extend(["--stage", str(stage_path)])
        result = subprocess.run(args, cwd=scratch, capture_output=True, timeout=30, env={
            "PATH": str(scratch / "closed-bin") + os.pathsep + os.environ["PATH"],
            "GITHUB_SHA": signing_commit, "GITHUB_REPOSITORY": repo, "GITHUB_REF": "refs/heads/main",
            "RUNNER_TEMP": str(fixture.directory), "GITHUB_OUTPUT": str(output),
            "SIGNING_PLAN": plan_bytes.decode(), "GH_FIXTURE": str(endpoints_path),
        })
        exact_plan = "plan_sha256=" + hashlib.sha256(plan_bytes).hexdigest() + "\n"
        if result.returncode:
            assert not output.exists()
            if stage_path:
                assert not stage_path.exists()
        else:
            assert output.read_text() == exact_plan
        return result.returncode == 0

    try:
        for index, (action, args, fault) in enumerate(schedule):
            observation = {}
            if action == "admit":
                lane, _ = args
                state["lane"] = lane
                state["plan"] = signing_command(lane, fault, fixture.directory / "preflight-output")
                if fault == "attempt":
                    observation["producerRunAttempt"] = 2
            elif action == "restoreUnsigned":
                if state["lane"] == "dispatch":
                    state["unsigned"] = signing_command("dispatch", fault, fixture.directory / "stage-output", stage)
                else:
                    transport = plan["privateStorage"]
                    port = media_port(transport["inputObject"], transport["inputGeneration"],
                                      unsigned if fault != "bytes" else unsigned[:-1] + bytes([unsigned[-1] ^ 1]))
                    archive = fixture.directory / f"unsigned-{index}.zip"
                    try:
                        with patch.object(storage, "connection", return_value=(port, {})):
                            storage.download(plan, archive)
                        bridge.PRODUCER.admit(archive, plan, stage)
                    except ValueError as error:
                        observation["refusal"] = str(error)
                staged = {variant: bridge.file_sha(stage / f"{variant}-release-unsigned.apk")
                          for variant in bridge.VARIANTS if (stage / f"{variant}-release-unsigned.apk").is_file()}
                state["unsigned"] = staged == plan["unsignedApkSHA256"]
                observation["stagedUnsignedSHA256"] = staged
            elif action == "uploadPrivate":
                assert state["unsigned"]
                private_port.failure = fault
                try:
                    with patch.object(storage, "connection", return_value=(private_port, {})):
                        delivered = storage.upload(plan, fixture.signed_tar)
                    assert delivered == fixture.record["signedBundle"]
                except (OSError, ValueError) as error:
                    observation["refusal"] = str(error)
                state["object"] = private_port.committed is not None
                state["privateReceipt"] = delivered is not None
                observation["receivedPrivateBytes"] = private_port.received
            elif action == "readReview":
                assert delivered == fixture.record["signedBundle"]
                record = copy.deepcopy(fixture.record)
                if fault == "voice":
                    record["cloudVoiceEvidenceSHA256"] = "0" * 64
                def api(endpoint):
                    response = fixture.api(endpoint)
                    if fault == "attempt" and endpoint.endswith("/actions/runs/100/attempts/1"):
                        response["run_attempt"] = 2
                    if fault == "artifact" and endpoint.endswith("/actions/artifacts/200"):
                        response["expired"] = True
                    return response
                work = fixture.directory / f"review-{index}"
                try:
                    reviewed_plan = bridge.preflight(record, signing_commit, work, api, fixture.download)
                    assert reviewed_plan == plan
                except ValueError as error:
                    observation["refusal"] = str(error)
                state["review"] = (work / "signing-plan.json").is_file() and (work / "cloud-voice.json").is_file()
            elif action == "restoreSigned":
                product = fixture.directory / f"product-{index}"
                product.mkdir()
                def fetch_signed(pins, receipt, target):
                    port = media_port(receipt["object"], receipt["generation"], signed)
                    if fault == "generation":
                        port.metadata["generation"] = "999"
                    elif fault == "signed-bytes":
                        port.content = signed[:-1] + bytes([signed[-1] ^ 1])
                    with patch.object(storage, "connection", return_value=(port, {})):
                        bridge.signed_download(pins, receipt, target)
                try:
                    bridge.stage(record, reviewed_plan, work, product,
                                 lambda _plan, target: shutil.copyfile(fixture.producer.archive, target), fetch_signed)
                except ValueError as error:
                    observation["refusal"] = str(error)
                staged = {variant: bridge.file_sha(product / f"artifacts/{variant}-release.apk")
                          for variant in bridge.VARIANTS if (product / f"artifacts/{variant}-release.apk").is_file()}
                state["restored"] = staged == record["signedApkSHA256"]
                observation["stagedSignedSHA256"] = staged
                if state["restored"]:
                    restored_product = (product / "artifacts/launcher-release.apk").read_text()
            else:
                raise AssertionError(action)
            source_summaries.append(observation)
            trace["steps"].append({"label": f"{action}: {fault}", "action": actions(action, *args),
                                   "expect": {"s": dict(state)}})
        trace["concreteSourceObservations"] = source_summaries
        return trace, restored_product
    finally:
        fixture.doCleanups()


def main():
    with tempfile.TemporaryDirectory(prefix="alpha-promotion-refinement-") as directory:
        scratch = Path(directory)
        (scratch / "closed-bin").mkdir()
        gh = scratch / "closed-bin/gh"
        gh.write_text(GH)
        gh.chmod(0o700)
        (scratch / "scripts").symlink_to(ROOT / "scripts", target_is_directory=True)
        def git(*args):
            return subprocess.check_output(["git", "-C", directory, *args], text=True).strip()
        git("init", "-q")
        git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false",
            "commit", "--allow-empty", "-qm", "reviewed workflow checkout")
        commit = git("rev-parse", "HEAD")
        plan = ("admit", ["private", True], "ok")
        stage = ("restoreUnsigned", [True], "ok")
        upload = ("uploadPrivate", ["ok"], "ok")
        review = ("readReview", [True], "ok")
        restore = ("restoreSigned", [True], "ok")
        schedules = [
            ("protected private plan, exact receipt and restored pair", [plan, stage, upload, review, restore]),
            ("main-push candidate has no signer route", [("admit", ["push", True], "ok")]),
            ("dispatch archive stages exact native APKs", [("admit", ["dispatch", True], "ok"), stage]),
            ("dispatch archive admission currently has no attempt pin", [("admit", ["dispatch", True], "attempt")]),
            ("private plan never stages changed downloaded bytes", [plan, ("restoreUnsigned", [False], "bytes")]),
            ("partial upload and lost response leave no exact receipt", [plan, stage,
                ("uploadPrivate", ["before"], "before"), ("uploadPrivate", ["partial"], "partial"),
                ("uploadPrivate", ["after"], "after"), upload]),
        ]
        for failure in ("source", "cancelled", "expired", "plan"):
            lane = "private" if failure == "plan" else "dispatch"
            schedules.append((f"{failure} refuses signing admission", [("admit", [lane, False], failure)]))
        for failure in ("attempt", "artifact", "voice"):
            schedules.append((f"{failure} refuses protected publication review",
                              [plan, stage, upload, ("readReview", [False], failure)]))
        for failure in ("generation", "signed-bytes"):
            schedules.append((f"{failure} refuses exact signed restore",
                              [plan, stage, upload, review, ("restoreSigned", [False], failure)]))
        results = [campaign(scratch, commit, name, schedule) for name, schedule in schedules]
        print(json.dumps({"traces": [trace for trace, _ in results], "launcherBytes": results[0][1],
                          "versionCode": 44}))


if __name__ == "__main__":
    main()
