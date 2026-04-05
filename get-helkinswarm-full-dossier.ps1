# ================================================
# HelkinSwarm SitRep Salvage Bundle Generator
# Run from project root. Creates helkinswarm-full-dossier.md
# ================================================

$ManifestFile = ".\clean-docs-manifest_ultra.md"
$OutputBundle = ".\helkinswarm-full-dossier.md"
$RepoRoot = Get-Location

function Write-Both {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
    $Message | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
}

# Header
@"
# HELKINSWARM FULL DOSSIER FOR GROK SITREP
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Bundle purpose:** Complete curated data package for Phase 1 SitRep in Grok web interface

Source manifest used: $ManifestFile
Issues file (attach separately): issues_full_export.json

---

"@ | Out-File -FilePath $OutputBundle -Encoding UTF8

# Codebase structure overview
Write-Both "## CODEBASE STRUCTURE OVERVIEW" "Yellow"
Get-ChildItem -Directory | Where-Object { $_.Name -in @("src","skills","infra","docs",".github") } | ForEach-Object {
    $dirName = $_.Name
    $filesInDir = (Get-ChildItem -Path $_.FullName -Recurse -File).Count
    $sizeMB = [math]::Round(((Get-ChildItem -Path $_.FullName -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB), 2)
    Write-Both "• $dirName/ → $filesInDir files, $sizeMB MB" "White"
}
Write-Both "`n---`n" "White"

# Parse manifest and bundle every listed file
Get-Content $ManifestFile | Where-Object { $_ -match '^- .*?\.md\s+\(\d' } | ForEach-Object {
    if ($_ -match '^- (.*?\.md)') {
        $relPath = $matches[1]
        $fullPath = Join-Path $RepoRoot $relPath
        
        if (Test-Path $fullPath) {
            Write-Both "`n=== FILE: $relPath ===" "Cyan"
            Get-Content $fullPath -Raw | Out-File -FilePath $OutputBundle -Append -Encoding UTF8
            Write-Both "`n=== END OF FILE: $relPath ===`n" "Cyan"
        }
    }
}

Write-Both "`n---`n**Bundle complete.**" "Green"
Write-Both "Next steps:" "Magenta"
Write-Both "1. Attach or paste the entire helkinswarm-full-dossier.md here" "Magenta"
Write-Both "2. Also attach issues_full_export.json (or say 'issues already provided')" "Magenta"
Write-Both "3. I will immediately run the full Phase 1 SitRep (8 artifacts) using unlimited credits." "Magenta"