import os, sys, json, requests
load_dotenv = __import__('dotenv').load_dotenv
load_dotenv('.env')
SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

s = requests.Session()
s.post(f'{SITE_URL}/api/method/login', data={'usr': USERNAME, 'pwd': USER_PWD})

# Fetch all profiles for Qifu
profiles = s.get(f'{SITE_URL}/api/resource/Ashan Employee Salary Profile?filters=[["company","=","天津祺富机械加工有限公司"]]&fields=["name","employee_no","employee_name","salary_mode","fixed_salary","employee_type"]&limit_page_length=100').json().get('data', [])

print(f'Migrating {len(profiles)} employee profiles...')
for p in profiles:
    name = p['name']
    fixed = float(p.get('fixed_salary') or 0.0)
    current_mode = str(p.get('salary_mode') or '').strip()

    if fixed > 0:
        new_mode = '税后固定工资'
    else:
        new_mode = '税后动态工资'

    if current_mode != new_mode:
        up_res = s.post(f'{SITE_URL}/api/method/frappe.client.set_value', json={
            'doctype': 'Ashan Employee Salary Profile',
            'name': name,
            'fieldname': 'salary_mode',
            'value': new_mode
        })
        print(f"  {p['employee_no']} {p['employee_name']}: {current_mode} -> {new_mode} (status: {up_res.status_code})")

print('Done migrating employee profiles!')
