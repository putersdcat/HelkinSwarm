# ================================================
# Grok Project SitRep Data Collector (Windows/PowerShell) – TEE VERSION
# Run this from the ROOT of your codebase in PowerShell
# It will create: project_sitrep_data.md
# You will see LIVE progress in the console while everything is also written to the file.
# ================================================

$OutputFile = ".\project_sitrep_data.md"
$RepoRoot = Get-Location

# Helper function to write to BOTH console (live) AND the file
function Write-Both {
    param(
        [string]$Message,
        [string]$Color = "White"
    )
    Write-Host $Message -ForegroundColor $Color
    $Message | Out-File -FilePath $OutputFile -Append -Encoding UTF8
}

# Clear/create the output file with header
@"
# Project SitRep Data Export
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Repository Root:** $RepoRoot

---

"@ | Out-File -FilePath $OutputFile -Encoding UTF8

Write-Both "`n✅ Starting data collection..." "Cyan"

# ================================================
# 1. Codebase size & language breakdown (cloc)
# ================================================
Write-Both "`n## 1. Codebase Size & Language Breakdown (cloc)" "Yellow"
Write-Both "Running cloc (this may take a few seconds)..." "DarkGray"
cloc . --include-lang=TypeScript,Markdown | Tee-Object -FilePath $OutputFile -Append
Write-Both "" "White"

# ================================================
# 2. GitHub Issues Summary + Full JSON Export
# ================================================
Write-Both "`n## 2. GitHub Issues" "Yellow"

# Quick count
Write-Both "### Issue Count Summary" "DarkYellow"
Write-Both "Counting all issues (open + closed)..." "DarkGray"
$issueCount = (gh issue list --state all --limit 1000 | Measure-Object -Line).Lines
Write-Both "Total issues (open + closed): $issueCount" "White"

# Export full JSON
Write-Both "Exporting full issues JSON..." "DarkGray"
gh issue list --state all --limit 1000 --json number,title,state,comments,labels | Out-File -FilePath ".\issues_full_export.json" -Encoding UTF8
Write-Both "✅ Full issues exported to: issues_full_export.json" "Green"
Write-Both "" "White"

# ================================================
# 3. Markdown documentation token rough estimate
# ================================================
Write-Both "`n## 3. Markdown Documentation Size (rough token estimate)" "Yellow"
Write-Both "Scanning all .md files..." "DarkGray"

$mdFiles = Get-ChildItem -Recurse -Filter "*.md" -File
$totalBytes = ($mdFiles | Measure-Object -Property Length -Sum).Sum
$totalFiles = $mdFiles.Count

Write-Both "Total .md files: $totalFiles" "White"
Write-Both "Total bytes in all .md files: $totalBytes" "White"
Write-Both "Rough token estimate (~bytes/4): $($totalBytes / 4)" "White"
Write-Both "" "White"

# ================================================
# 4. Commit history quick view
# ================================================
Write-Both "`n## 4. Git Commit History Quick View" "Yellow"

# Total commits in last 100
Write-Both "Counting last 100 commits..." "DarkGray"
$commitCount = (git log --oneline -100 | Measure-Object -Line).Lines
Write-Both "Total commits in last 100: $commitCount" "White"

# Last 20 commits
Write-Both "`n### Last 20 commits (most recent first)" "DarkYellow"
git log --pretty=format:"%h %ad %s" --date=short | Select-Object -First 20 | Tee-Object -FilePath $OutputFile -Append
Write-Both "" "White"

# Final footer
@"

---
**End of export** – You can now copy everything from project_sitrep_data.md (or just drag-and-drop the file) back to me.
"@ | Out-File -FilePath $OutputFile -Append -Encoding UTF8

Write-Both "`n✅ DONE! Collection complete." "Green"
Write-Both "Files created:" "Cyan"
Write-Both "   • project_sitrep_data.md     ← main file (copy-paste this back to me)" "Cyan"
Write-Both "   • issues_full_export.json   ← full GitHub issues (attach if needed)" "Cyan"
Write-Both "`nJust open project_sitrep_data.md and paste its entire content (or attach the file) back here." "Magenta"