import base64
import os
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

import paramiko


def load_local_env() -> None:
    """Load simple KEY=VALUE pairs from the workspace .env without a dependency."""
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
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

load_local_env()

LAN_HOST = os.getenv('UNRAID_SSH_HOST', '192.168.8.11')
TAILSCALE_HOST = os.getenv('UNRAID_TAILSCALE_HOST', '100.80.0.4')
PORT = int(os.getenv('UNRAID_SSH_PORT', '22'))
USER = os.getenv('UNRAID_SSH_USER', 'root')
PASSWORD = os.getenv('UNRAID_SSH_PASSWORD', '')
PROJECT_ROOT = Path(__file__).resolve().parents[1]
LOCAL_APP_DIR = PROJECT_ROOT / "ashan_cn_procurement"
SENSITIVE_APP_SOURCE_PATHS = frozenset({
    "ashan_cn_procurement/ashan_cn_procurement/services/jizhong_history_records.json",
    "ashan_cn_procurement/ashan_cn_procurement/services/qifu_employee_seed.json",
    "ashan_cn_procurement/ashan_cn_procurement/services/qifu_full_40_historical_data.json",
})

def run_cmd(client, cmd, *, check=True):
    """Run a remote command and fail on a non-zero exit status by default."""
    print(f">> {cmd}")
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    exit_status = stdout.channel.recv_exit_status()
    if out:
        try:
            print(out)
        except Exception:
            print(out.encode('ascii', errors='replace').decode('ascii'))
    if err:
        try:
            print("ERR:", err)
        except Exception:
            print("ERR:", err.encode('ascii', errors='replace').decode('ascii'))
    if check and exit_status != 0:
        raise RuntimeError(f"远程命令执行失败（退出码 {exit_status}）：{cmd}")
    return out, err, exit_status


def clear_confirmed_orphan_migrate_lock(client):
    """Remove only a confirmed orphan migration lock from the target site."""
    lock_path = "sites/site1.local/locks/bench_migrate.lock"
    workdir = "/home/frappe/frappe-bench"
    lock_out, _, _ = run_cmd(
        client,
        f"docker exec -u frappe -w {workdir} erpnext16 sh -lc \"test -e {lock_path} && echo lock-present || true\"",
    )
    if "lock-present" not in lock_out:
        return

    process_out, _, _ = run_cmd(
        client,
        f"docker exec -u frappe -w {workdir} erpnext16 sh -lc \"ps -ef | grep 'bench --site site1.local migrate' | grep -v grep || true\"",
    )
    if process_out.strip():
        raise RuntimeError("检测到仍在运行的 bench migrate，拒绝移除迁移锁。")

    run_cmd(
        client,
        f"docker exec -u frappe -w {workdir} erpnext16 rm -f {lock_path}",
    )


def ensure_socketio_origin_header(client):
    """Keep Socket.IO's forwarded origin and host aligned with the browser URL."""
    remote_script = """set -eu
config=/etc/nginx/conf.d/frappe.conf
backup=/etc/nginx/conf.d/frappe.conf.bak-20260828-socket-origin
origin_header='proxy_set_header Origin $scheme://$http_host;'
host_header='proxy_set_header Host $http_host;'
if grep -Fq "$origin_header" "$config" && grep -Fq "$host_header" "$config"; then
    nginx -t
    exit 0
fi
if ! grep -Fq 'location /socket.io' "$config"; then
    echo "Socket.IO proxy block was not found."
    exit 1
fi
cp "$config" "$backup"
sed -i -E 's#^[[:space:]]*proxy_set_header Origin .*;#        proxy_set_header Origin $scheme://$http_host;#' "$config"
sed -i -E 's#^[[:space:]]*proxy_set_header Host .*;#        proxy_set_header Host $http_host;#' "$config"
if nginx -t; then
    for i in 1 2 3 4 5; do
        if [ -s /run/nginx.pid ] && kill -0 "$(cat /run/nginx.pid 2>/dev/null)" 2>/dev/null; then
            nginx -s reload && break || true
        fi
        sleep 1
    done
else
    cp "$backup" "$config"
    nginx -t || true
    exit 1
fi
"""
    encoded_script = base64.b64encode(remote_script.encode("utf-8")).decode("ascii")
    run_cmd(client, f"echo {encoded_script} | base64 -d | docker exec -i erpnext16 sh")


def connect_ssh():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    # 尝试 1: 局域网地址
    print(f"Connecting to Unraid LAN ({LAN_HOST}:{PORT})...")
    try:
        client.connect(LAN_HOST, port=PORT, username=USER, password=PASSWORD, timeout=5)
        print(f"[OK] Connected via LAN ({LAN_HOST})")
        return client
    except Exception as e:
        print(f"[WARN] LAN connection to {LAN_HOST} failed ({e}). Trying Tailscale remote ({TAILSCALE_HOST})...")

    # 尝试 2: Tailscale 远程地址
    try:
        client.connect(TAILSCALE_HOST, port=PORT, username=USER, password=PASSWORD, timeout=10)
        print(f"[OK] Connected via Tailscale ({TAILSCALE_HOST})")
        return client
    except Exception as e:
        raise ConnectionError(f"Failed to connect to both LAN ({LAN_HOST}) and Tailscale ({TAILSCALE_HOST}): {e}")


def add_tracked_app_sources(tar: tarfile.TarFile) -> None:
    """Archive only version-controlled App sources, never local payroll evidence."""
    proc = subprocess.run(
        ["git", "-C", str(PROJECT_ROOT), "ls-files", "-z", "--", "ashan_cn_procurement"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if proc.returncode:
        message = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"无法读取 Git 源文件清单：{message or proc.returncode}")

    source_paths = [Path(path) for path in proc.stdout.decode("utf-8").split("\0") if path]
    if not source_paths:
        raise RuntimeError("Git 源文件清单为空，拒绝同步。")

    for relative_path in source_paths:
        if relative_path.as_posix() in SENSITIVE_APP_SOURCE_PATHS:
            continue
        source_path = PROJECT_ROOT / relative_path
        if not source_path.is_file():
            raise RuntimeError(f"Git 源文件不存在：{relative_path}")
        tar.add(source_path, arcname=relative_path.as_posix())

def sync_and_migrate():
    client = connect_ssh()

    # 1. 压缩本地 ashan_cn_procurement app
    if not LOCAL_APP_DIR.is_dir():
        raise RuntimeError(f"本地 App 目录不存在：{LOCAL_APP_DIR}")

    temp_tar = os.path.join(tempfile.gettempdir(), "ashan_cn_procurement.tar.gz")
    print("Archiving local app...")
    with tarfile.open(temp_tar, "w:gz") as tar:
        add_tracked_app_sources(tar)

    # 2. 上传到服务器 /tmp
    sftp = client.open_sftp()
    remote_tar = "/tmp/ashan_cn_procurement.tar.gz"
    print(f"Uploading to {remote_tar}...")
    sftp.put(temp_tar, remote_tar)
    sftp.close()
    os.remove(temp_tar)

    # 3. 解压到容器内
    print("Extracting into erpnext16 container...")
    run_cmd(client, "docker cp /tmp/ashan_cn_procurement.tar.gz erpnext16:/tmp/ashan_cn_procurement.tar.gz")
    run_cmd(client, "docker exec erpnext16 tar -xzf /tmp/ashan_cn_procurement.tar.gz -C /home/frappe/frappe-bench/apps/")
    run_cmd(client, "docker exec erpnext16 chown -R frappe:frappe /home/frappe/frappe-bench/apps/ashan_cn_procurement")

    # 4. 执行 bench migrate
    print("Running bench migrate...")
    for attempt in range(1, 4):
        clear_confirmed_orphan_migrate_lock(client)
        out, err, exit_status = run_cmd(
            client,
            "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 bench --site site1.local migrate",
            check=False,
        )
        combined = (out or "") + (err or "")
        if exit_status == 0 and "Traceback" not in combined:
            break
        if attempt == 3:
            raise RuntimeError(
                f"bench migrate 连续 {attempt} 次失败（最后退出码 {exit_status}）。"
            )
        print(f"[WARN] Migrate attempt {attempt} failed, retrying in 3s...")
        import time
        time.sleep(3)

    # 5. 构建前端静态资源
    print("Building frontend assets...")
    run_cmd(client, "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 bench build --app ashan_cn_procurement")

    # 6. 对已部署的采购工作台服务做只读健康检查
    print("Validating procurement workbench services...")
    run_cmd(
        client,
        "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 "
        "bench --site site1.local execute "
        "ashan_cn_procurement.services.procurement_picker_service.get_procurement_workbench_context "
        "--kwargs '{\"workbench\":\"overview\"}'",
    )
    run_cmd(
        client,
        "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 "
        "bench --site site1.local execute "
        "ashan_cn_procurement.services.procurement_picker_service.get_procurement_picker_overview_kpis "
        "--kwargs '{\"workbench\":\"request\"}'",
    )

    # 7. 清理缓存并重启容器重载 Python 模块
    print("Clearing cache & restarting container...")
    run_cmd(client, "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 bench --site site1.local clear-cache")
    run_cmd(client, "docker restart erpnext16")
    ensure_socketio_origin_header(client)

    client.close()
    print("\n[OK] Sync & Migrate completed successfully!")

if __name__ == '__main__':
    sync_and_migrate()
