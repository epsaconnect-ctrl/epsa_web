# Fix admin.js - remove orphaned duplicate voting code between line 773 and 919
$file = 'js\admin.js'
$lines = Get-Content $file -Encoding UTF8

# Keep lines 1-772, skip 773-919, keep 920 onwards
$newLines = @()
$newLines += $lines[0..771]      # lines 1-772 (index 0-771)
$newLines += $lines[919..($lines.Count - 1)]   # from line 920 onwards

Set-Content $file -Value $newLines -Encoding UTF8
Write-Host "Done. New total lines: $($newLines.Count)"
