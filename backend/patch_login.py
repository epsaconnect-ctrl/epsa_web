"""Patch login.html to add teacher register link."""
import re

path = r'c:\Users\dawit\Desktop\EPSA WEB\login.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

old = 'Register as a Student</a>'
new = 'Register as a Student</a> &nbsp;·&nbsp; <a href="teacher-register.html" style="color:#f59e0b;font-weight:600">Join as a Teacher</a>'

if old in content:
    content = content.replace(old, new, 1)
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print('SUCCESS: Teacher link added to login.html')
else:
    # Search for similar
    idx = content.find('Register as a')
    print('NOT FOUND — closest at', idx, repr(content[max(0,idx-20):idx+80]))
