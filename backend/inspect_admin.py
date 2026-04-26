"""Inspect admin dashboard structure."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\dawit\Desktop\EPSA WEB\admin\dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

print('Total length:', len(content))

for kw in ['</body>', 'data-section="', 'section-exams', 'section-students', 'nav-tab']:
    idx = content.find(kw)
    if idx >= 0:
        snippet = content[idx:idx+400].replace('\n','\\n')
        print(f'\n=== [{kw}] at {idx} ===\n{snippet[:300]}')
