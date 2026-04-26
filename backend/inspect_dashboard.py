"""Inspect dashboard.html structure."""
import sys
sys.stdout.reconfigure(encoding='utf-8')

path = r'c:\Users\dawit\Desktop\EPSA WEB\dashboard.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

print('Total length:', len(content))

keywords = ['data-section="exams"', 'section-exams', 'id="section-exams"',
            'Exam', 'Mock', '</body>', 'data-section="']
for kw in keywords:
    idx = content.find(kw)
    if idx >= 0:
        snippet = content[idx:idx+400].replace('\n', '\\n')
        print(f'\n=== [{kw}] at {idx} ===')
        print(snippet[:300])
