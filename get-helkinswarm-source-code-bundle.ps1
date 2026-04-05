# ================================================
# HelkinSwarm SOURCE CODE Bundle Generator
# Run from project root. Creates helkinswarm-source-code-bundle.md
# ================================================

$OutputBundle = ".\helkinswarm-source-code-bundle.md"
$RepoRoot = Get-Location

function Write-Both {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
    $Message | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
}

# Header
@"
# HELKINSWARM SOURCE CODE BUNDLE FOR GROK SITREP
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Bundle purpose:** Complete source code package for Phase 1 SitRep in Grok web interface

Source directories included:
- src/
- skills/
- infra/

---

"@ | Out-File -FilePath $OutputBundle -Encoding UTF8

# Bundle all .ts files from src/
Write-Both "## SOURCE CODE FROM src/" "Yellow"
Get-ChildItem -Path "src" -Recurse -Filter "*.ts" -File | ForEach-Object {
    $relPath = $_.FullName.Substring($RepoRoot.Path.Length + 1).Replace('\', '/')
    Write-Both "`n=== FILE: $relPath ===" "Cyan"
    Get-Content $_.FullName -Raw | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
    Write-Both "`n=== END OF FILE: $relPath ===`n" "Cyan"
}

# Bundle all .ts files from skills/
Write-Both "## SOURCE CODE FROM skills/" "Yellow"
Get-ChildItem -Path "skills" -Recurse -Filter "*.ts" -File | ForEach-Object {
    $relPath = $_.FullName.Substring($RepoRoot.Path.Length + 1).Replace('\', '/')
    Write-Both "`n=== FILE: $relPath ===" "Cyan"
    Get-Content $_.FullName -Raw | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
    Write-Both "`n=== END OF FILE: $relPath ===`n" "Cyan"
}

# Bundle any .ts files in infra/ (if any)
Write-Both "## SOURCE CODE FROM infra/" "Yellow"
Get-ChildItem -Path "infra" -Recurse -Filter "*.ts" -File | ForEach-Object {
    $relPath = $_.FullName.Substring($RepoRoot.Path.Length + 1).Replace('\', '/')
    Write-Both "`n=== FILE: $relPath ===" "Cyan"
    Get-Content $_.FullName -Raw | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
    Write-Both "`n=== END OF FILE: $relPath ===`n" "Cyan"
}

Write-Both "`n---`n**Source code bundle complete.**" "Green"
Write-Both "Next steps:" "Magenta"
Write-Both "1. Attach or paste the entire helkinswarm-source-code-bundle.md here" "Magenta"
Write-Both "2. Also attach or paste the markdown bundle you already have (helkinswarm-full-dossier.md)" "Magenta"
Write-Both "3. I will immediately run the full Phase 1 SitRep (8 artifacts) using unlimited credits." "Magenta"