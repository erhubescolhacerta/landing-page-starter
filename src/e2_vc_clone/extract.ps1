$html = Get-Content -Raw index.html

$scripts = [regex]::Matches($html, '(?s)<script(?:[^>]*)>([\s\S]*?)</script>')
$customJs = ""
foreach ($match in $scripts) {
    if (-not $match.Value.Contains("src=")) {
        $customJs += $match.Groups[1].Value + "`n`n"
    }
}
Set-Content -Path "custom.js" -Value $customJs

$styles = [regex]::Matches($html, '(?s)<style(?:[^>]*)>([\s\S]*?)</style>')
$customCss = ""
foreach ($match in $styles) {
    $customCss += $match.Groups[1].Value + "`n`n"
}
Set-Content -Path "custom.css" -Value $customCss

$htmlClean = $html -replace '(?s)<script(?![^>]*src=)[^>]*>[\s\S]*?</script>', ''
$htmlClean = $htmlClean -replace '(?s)<style[^>]*>[\s\S]*?</style>', '<link rel="stylesheet" href="custom.css">'
$htmlClean = $htmlClean.Replace('https://cdn.prod.website-files.com/6a3186e3868fbff1e37a8325/css/e2vc-test-vasa.webflow.shared.1263f5b70.css', 'style.css')
$htmlClean = $htmlClean.Replace('</body>', '<script src="custom.js"></script></body>')
Set-Content -Path "index_clean.html" -Value $htmlClean
