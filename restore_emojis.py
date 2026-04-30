import os

replacements = [
    ('<span class="sidebar-link-icon"></span> Overview', '<span class="sidebar-link-icon">📊</span> Overview'),
    ('<span class="sidebar-link-icon"></span> My Profile', '<span class="sidebar-link-icon">👤</span> My Profile'),
    ('<span class="sidebar-link-icon"></span> Voting', '<span class="sidebar-link-icon">🗳️</span> Voting'),
    ('<span class="sidebar-link-icon"></span> Clubs', '<span class="sidebar-link-icon">👥</span> Clubs'),
    ('<span class="sidebar-link-icon"></span> Networking', '<span class="sidebar-link-icon">🤝</span> Networking'),
    ('<span class="sidebar-link-icon"></span> Messages', '<span class="sidebar-link-icon">💬</span> Messages'),
    ('<span class="sidebar-link-icon"></span> Sign Out', '<span class="sidebar-link-icon">🚪</span> Sign Out'),
    ('<span class="sidebar-link-icon"></span> Applications', '<span class="sidebar-link-icon">📥</span> Applications'),
    ('<span class="sidebar-link-icon"></span> Add Content', '<span class="sidebar-link-icon">✏️</span> Add Content'),
    ('<span class="sidebar-link-icon"></span> Students', '<span class="sidebar-link-icon">👥</span> Students'),
    ('<span class="sidebar-link-icon"></span> Analytics', '<span class="sidebar-link-icon">📈</span> Analytics'),
    ('<span class="sidebar-link-icon"></span> Admin Actions', '<span class="sidebar-link-icon">⚙️</span> Admin Actions')
]

for root, _, files in os.walk('frontend'):
    for file in files:
        if file.endswith('.html'):
            filepath = os.path.join(root, file)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            
            original_content = content
            for old, new in replacements:
                content = content.replace(old, new)
            
            if content != original_content:
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f'Fixed emojis in {filepath}')
