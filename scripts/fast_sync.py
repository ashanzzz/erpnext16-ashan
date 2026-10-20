import argparse
import io
import os
import subprocess
import sys
import tarfile
import time
from pathlib import Path

import paramiko

def load_local_env() -> None:
    """Load simple KEY=VALUE pairs from the workspace .env."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

load_local_env()

LAN_HOST = os.getenv("UNRAID_SSH_HOST", "192.168.8.11")
TAILSCALE_HOST = os.getenv("UNRAID_TAILSCALE_HOST", "100.80.0.4")
PORT = int(os.getenv("UNRAID_SSH_PORT", "22"))
USER = os.getenv("UNRAID_SSH_USER", "root")
PASSWORD = os.getenv("UNRAID_SSH_PASSWORD", "")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
APP_NAME = "ashan_cn_procurement"
LOCAL_APP_DIR = PROJECT_ROOT / APP_NAME

SENSITIVE_APP_SOURCE_PATHS = frozenset({
    f"{APP_NAME}/{APP_NAME}/services/jizhong_history_records.json",
    f"{APP_NAME}/{APP_NAME}/services/qifu_employee_seed.json",
    f"{APP_NAME}/{APP_NAME}/services/qifu_full_40_historical_data.json",
})

def connect_ssh():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(LAN_HOST, port=PORT, username=USER, password=PASSWORD, timeout=4)
        return client
    except Exception:
        pass

    try:
        client.connect(TAILSCALE_HOST, port=PORT, username=USER, password=PASSWORD, timeout=8)
        return client
    except Exception as e:
        raise ConnectionError(f"SSH 连接失败 (LAN: {LAN_HOST}, Tailscale: {TAILSCALE_HOST}): {e}")

def get_changed_files():
    """Detect modified, staged, or untracked files in ashan_cn_procurement via git."""
    proc = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "status", "--porcelain", "--", APP_NAME],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        return []
    
    files = []
    for line in proc.stdout.decode("utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        # Format is like " M path/to/file" or "?? path/to/file"
        parts = line.split(maxsplit=1)
        if len(parts) == 2:
            rel_path = parts[1].strip().strip('"')
            p = PROJECT_ROOT / rel_path
            if p.is_file() and not rel_path.endswith(".pyc") and "__pycache__" not in rel_path:
                files.append(Path(rel_path))
    return files

def get_all_tracked_files():
    """Get all git tracked files in ashan_cn_procurement."""
    proc = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "ls-files", "-z", "--", APP_NAME],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode != 0:
        return []
    paths = [Path(p) for p in proc.stdout.decode("utf-8", errors="replace").split("\0") if p]
    return [p for p in paths if (PROJECT_ROOT / p).is_file() and p.as_posix() not in SENSITIVE_APP_SOURCE_PATHS]

def reload_gunicorn_workers(client):
    """Gracefully reload Gunicorn workers if Python code changed (takes ~0.5s)."""
    reload_cmd = (
        "docker exec erpnext16 python3 -c \""
        "import os, signal; "
        "pids = [int(p) for p in os.listdir('/proc') if p.isdigit() and 'gunicorn' in open(f'/proc/{p}/cmdline', errors='ignore').read() and 'master' in open(f'/proc/{p}/cmdline', errors='ignore').read() or 'gunicorn: master' in open(f'/proc/{p}/cmdline', errors='ignore').read()]; "
        "pids and [os.kill(p, signal.SIGHUP) for p in pids]\""
    )
    client.exec_command(reload_cmd)

def fast_sync(targets=None, sync_all=False):
    t0 = time.time()
    
    # 1. 确定需要同步的文件
    files_to_sync = []
    if targets:
        for t in targets:
            tp = Path(t)
            if not tp.is_absolute():
                tp = PROJECT_ROOT / tp
            try:
                rel = tp.resolve().relative_to(PROJECT_ROOT.resolve())
            except ValueError:
                rel = tp
            if tp.is_file():
                files_to_sync.append(rel)
    elif sync_all:
        files_to_sync = get_all_tracked_files()
    else:
        files_to_sync = get_changed_files()

    if not files_to_sync:
        print("[FAST-SYNC] 未检测到任何变更文件，无需同步。")
        return

    # 检查是否有 DocType JSON 变更
    doctype_changed = any(
        "doctype" in f.as_posix().lower() and f.suffix == ".json"
        for f in files_to_sync
    )
    python_changed = any(f.suffix == ".py" for f in files_to_sync)

    print(f"[FAST-SYNC] 待同步文件数: {len(files_to_sync)}")
    for f in files_to_sync[:10]:
        print(f"  -> {f.as_posix()}")
    if len(files_to_sync) > 10:
        print(f"  ... 以及其他 {len(files_to_sync) - 10} 个文件")

    # 2. 内存流式打包
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in files_to_sync:
            if f.as_posix() in SENSITIVE_APP_SOURCE_PATHS:
                continue
            local_path = PROJECT_ROOT / f
            if local_path.is_file():
                tar.add(local_path, arcname=f.as_posix())
    buf.seek(0)
    tar_bytes = buf.getvalue()

    # 3. SSH 连接并流式直写
    client = connect_ssh()
    cmd = "docker exec -i erpnext16 tar -xzf - -C /home/frappe/frappe-bench/apps/"
    stdin, stdout, stderr = client.exec_command(cmd)
    stdin.write(tar_bytes)
    stdin.close()
    stdout.read()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if err and "warning" not in err.lower():
        print(f"[FAST-SYNC WARN] 远程解压警告: {err}")

    # 4. 若涉及 Python 后端代码变更，秒级热重载 Gunicorn
    if python_changed:
        print("[FAST-SYNC] 检测到 Python 代码变更，正在热重载 Gunicorn worker...")
        reload_gunicorn_workers(client)

    client.close()
    elapsed = time.time() - t0
    print(f"[FAST-SYNC OK] 增量流式直推完成！共推送 {len(tar_bytes)} 字节，耗时 {elapsed:.2f} 秒。")
    print("[FAST-SYNC OK] 容器保持热机 (Warm)，会话/Cookie 保持有效，浏览器直接按 F5 刷新即刻生效！")

    if doctype_changed:
        print("\n[WARNING] 检测到 DocType JSON 结构或数据库变更！")
        print("          若涉及新增/修改数据库字段，请在最后执行一次 python scripts/sync_and_migrate.py 以同步数据库表结构。")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ERPNext 16 Ashan 增量流式直推 (Fast Hot-Sync)")
    parser.add_argument("files", nargs="*", help="指定要同步的文件路径（留空则自动检测 git 变更）")
    parser.add_argument("--all", action="store_true", help="全量同步所有 tracked 文件（依然免重启，1~2秒完成）")
    args = parser.parse_args()
    fast_sync(targets=args.files, sync_all=args.all)
