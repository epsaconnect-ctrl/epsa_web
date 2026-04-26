"""More detailed admin inspect."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\dawit\Desktop\EPSA WEB\admin\dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find nav items
for kw in ['onclick="showSection', 'showSection(', 'sidebar-nav', 'admin-nav', 'nav-link']:
    idx = content.find(kw)
    if idx >= 0:
        s = content[idx:idx+500].replace('\n','\\n')
        print(f'=== {kw} at {idx} ===\n{s[:400]}\n')

# Find sections
for kw in ['id="section-', "id='section-", 'class="section"', 'class="admin-section"']:
    idx = content.find(kw)
    if idx >= 0:
        s = content[idx:idx+200].replace('\n','\\n')
        print(f'=== {kw} at {idx} ===\n{s[:180]}\n')
