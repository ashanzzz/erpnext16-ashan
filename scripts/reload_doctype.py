import os, sys, requests, paramiko
load_dotenv = __import__('dotenv').load_dotenv
load_dotenv('.env')

USER = os.getenv("UNRAID_SSH_USER", "root")
PASSWORD = os.getenv("UNRAID_SSH_PASSWORD", "")
LAN_HOST = os.getenv("UNRAID_HOST", "192.168.8.11")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(LAN_HOST, port=22, username=USER, password=PASSWORD, timeout=8)

# Reload doctype
cmd = "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 bench --site site1.local reload-doctype 'Ashan Employee Salary Profile'"
print('Running:', cmd)
stdin, stdout, stderr = client.exec_command(cmd)
out = stdout.read().decode('utf-8')
err = stderr.read().decode('utf-8')
print('OUT:', out)
print('ERR:', err)

# Clear cache
cmd2 = "docker exec -u frappe -w /home/frappe/frappe-bench erpnext16 bench --site site1.local clear-cache"
stdin, stdout, stderr = client.exec_command(cmd2)
print('Cache cleared:', stdout.read().decode('utf-8'))

client.close()
