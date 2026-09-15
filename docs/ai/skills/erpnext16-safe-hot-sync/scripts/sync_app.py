"""Synchronize the canonical custom-app package to the ERPNext 16 container."""

from __future__ import annotations

import argparse
import os
import tarfile
import tempfile
from datetime import datetime
from pathlib import Path

import paramiko

APP = "ashan_cn_procurement"
BENCH = "/home/frappe/frappe-bench"
APP_ROOT = f"{BENCH}/apps/{APP}"
PACKAGE = f"{APP_ROOT}/{APP}"
MODULE = f"{PACKAGE}/{APP}"
SITE = "site1.local"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def exclude_cache(item: tarfile.TarInfo) -> tarfile.TarInfo | None:
    return None if "__pycache__" in item.name or item.name.endswith(".pyc") else item


def run(client: paramiko.SSHClient, command: str, timeout: int = 300) -> str:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    output, error = stdout.read().decode("utf-8", "replace"), stderr.read().decode("utf-8", "replace")
    if stdout.channel.recv_exit_status():
        raise RuntimeError(error or output)
    return output


def print_safe(value: str) -> None:
    print(value.encode("ascii", "backslashreplace").decode("ascii"), end="")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--migrate", action="store_true")
    args = parser.parse_args()
    source = Path(APP)
    package_source = source / APP
    required = (source / "pyproject.toml", package_source / "hooks.py", package_source / APP / "doctype", package_source / "reimbursement")
    if not all(path.exists() for path in required):
        raise RuntimeError("Local app layout is not canonical; refuse to sync.")

    env = load_env(Path(".env"))
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(env["UNRAID_SSH_HOST"], port=int(env["UNRAID_SSH_PORT"]), username=env["UNRAID_SSH_USER"], password=env["UNRAID_SSH_PASSWORD"], timeout=20)
    try:
        check = "docker exec -u frappe -w " + BENCH + " erpnext16 env/bin/python -c 'import os, ashan_cn_procurement; root=os.path.dirname(ashan_cn_procurement.__file__); print(ashan_cn_procurement.__file__); print(os.path.join(root, \"ashan_cn_procurement\", \"doctype\")); print(os.path.isdir(os.path.join(root, \"ashan_cn_procurement\", \"doctype\"))); print(os.path.isfile(os.path.join(root, \"public\", \"js\", \"reimbursement_request.js\")))'"
        print_safe(run(client, check, 90))
        if args.check:
            return

        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = f"/tmp/{APP}-{stamp}.tar.gz"
        run(client, "docker exec erpnext16 sh -c 'set -eu; test -f " + APP_ROOT + "/pyproject.toml; tar -czf " + backup + " -C " + BENCH + "/apps " + APP + "'", 120)
        Path("backups").mkdir(exist_ok=True)
        run(client, "docker cp erpnext16:" + backup + " /tmp/" + APP + "-backup.tar.gz", 120)
        sftp = client.open_sftp()
        sftp.get(f"/tmp/{APP}-backup.tar.gz", str(Path("backups") / f"{APP}-{stamp}.tar.gz"))
        sftp.close()

        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as file:
            archive_name = file.name
        try:
            with tarfile.open(archive_name, "w:gz") as archive:
                archive.add(source, arcname=APP, filter=exclude_cache)
            with tarfile.open(archive_name, "r:gz") as archive:
                if f"{APP}/{APP}/public/js/reimbursement_request.js" not in archive.getnames():
                    raise RuntimeError("Local archive is missing the reimbursement form script.")
            sftp = client.open_sftp()
            sftp.put(archive_name, f"/tmp/{APP}-sync.tar.gz")
            sftp.close()
            run(client, "docker exec erpnext16 rm -f /tmp/" + APP + "-sync.tar.gz", 120)
            run(client, "docker cp /tmp/" + APP + "-sync.tar.gz erpnext16:/tmp/" + APP + "-sync.tar.gz", 120)
            archive_check = "docker exec erpnext16 sh -c 'set -eu; tar -tzf /tmp/" + APP + "-sync.tar.gz | grep -qx \"" + APP + "/" + APP + "/" + APP + "/doctype/reimbursement_request/reimbursement_request.json\"; tar -tzf /tmp/" + APP + "-sync.tar.gz | grep -qx \"" + APP + "/" + APP + "/public/js/reimbursement_request.js\"'"
            run(client, archive_check, 120)
            run(client, "docker exec erpnext16 tar -xzf /tmp/" + APP + "-sync.tar.gz -C " + BENCH + "/apps", 120)
            extracted_check = "docker exec erpnext16 sh -c 'test -d " + MODULE + "/doctype; if ! test -f " + PACKAGE + "/public/js/reimbursement_request.js; then find " + APP_ROOT + " -name reimbursement_request.js -print; exit 1; fi'"
            run(client, extracted_check, 120)
            # The archive deliberately excludes __pycache__. Remove the old bytecode from
            # this app so Python cannot keep serving a pre-sync module after a restart.
            purge_python_cache = "docker exec erpnext16 sh -c 'find " + APP_ROOT + " -type d -name __pycache__ -prune -exec rm -rf {} +'"
            run(client, purge_python_cache, 120)
            legacy = "docker exec erpnext16 sh -c 'set -eu; for name in doctype report workspace workspace_sidebar; do if test -d " + PACKAGE + "/$name; then mv " + PACKAGE + "/$name " + PACKAGE + "/.legacy_misplaced_${name}_" + stamp + "; fi; done'"
            run(client, legacy, 120)
        finally:
            os.unlink(archive_name)

        command = "bench build --app " + APP
        if args.migrate:
            command += " && bench --site " + SITE + " migrate"
        command += " && bench --site " + SITE + " clear-cache"
        print_safe(run(client, "docker exec -u frappe -w " + BENCH + " erpnext16 sh -c '" + command + "'", 300))
        print_safe(run(client, "docker restart erpnext16", 120))
    finally:
        client.close()


if __name__ == "__main__":
    main()
