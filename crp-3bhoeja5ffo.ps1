$result = @{ hello = 'world' }
$result | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path 'crp-3bhoeja5ffo.json' -Encoding UTF8
