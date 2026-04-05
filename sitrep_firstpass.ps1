# ================================================
# Grok Project SitRep – FIRST-PASS RECON (Ultra-Light & Fast)
# Run this from the ROOT of your codebase in PowerShell
# This version skips the slow cloc entirely and starts with a quick recursive scan
# so we can see the real project shape first (file types, sizes, structure).
# You will see LIVE progress in the console + everything written to file.
# ================================================

$OutputFile = ".\project_sitrep_firstpass.md"
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
# Project SitRep – FIRST-PASS RECON
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Repository Root:** $RepoRoot
**Purpose:** Quick lightweight scan to understand real project shape before any heavy commands.

---

"@ | Out-File -FilePath $OutputFile -Encoding UTF8

Write-Both "`n✅ Starting FIRST-PASS reconnaissance (this should be fast even on huge repos)..." "Cyan"

# ================================================
# 1. Quick Recursive Project Structure Overview
# ================================================
Write-Both "`n## 1. Quick Recursive Project Structure Overview" "Yellow"
Write-Both "Scanning all files and folders (this is the fast native PowerShell equivalent of a recursive dir)..." "DarkGray"

$allFiles = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue
$allDirs  = Get-ChildItem -Recurse -Directory -ErrorAction SilentlyContinue

$totalFiles = $allFiles.Count
$totalDirs  = $allDirs.Count

Write-Both "Total files found  : $totalFiles" "White"
Write-Both "Total directories  : $totalDirs" "White"
Write-Both "" "White"

# Top 25 file extensions by count + total size
Write-Both "### Top 25 File Extensions (by count)" "DarkYellow"
$extensionSummary = $allFiles | Group-Object -Property Extension | 
    Sort-Object Count -Descending | 
    Select-Object -First 25 |
    ForEach-Object {
        $ext = if ($_.Name) { $_.Name } else { "(no extension)" }
        $count = $_.Count
        $sizeBytes = ($_.Group | Measure-Object -Property Length -Sum).Sum
        [PSCustomObject]@{
            Extension   = $ext
            Count       = $count
            TotalBytes  = $sizeBytes
            TotalKB     = [math]::Round($sizeBytes / 1KB, 2)
            TotalMB     = [math]::Round($sizeBytes / 1MB, 2)
        }
    }

$extensionSummary | Format-Table -AutoSize | Out-String | Tee-Object -FilePath $OutputFile -Append
Write-Both "" "White"

# Top-level folders summary (quick high-level view)
Write-Both "### Top-Level Folders (files + size inside each)" "DarkYellow"
Get-ChildItem -Directory | ForEach-Object {
    $dirName = $_.Name
    $filesInDir = Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue
    $fileCount = $filesInDir.Count
    $totalSize = ($filesInDir | Measure-Object -Property Length -Sum).Sum
    Write-Both "• $dirName → $fileCount files, $([math]::Round($totalSize/1MB,2)) MB" "White"
} 
Write-Both "" "White"

# ================================================
# 2. Markdown documentation (still useful & usually fast)
# ================================================
Write-Both "`n## 2. Markdown Documentation Size" "Yellow"
Write-Both "Scanning all .md files..." "DarkGray"

$mdFiles = $allFiles | Where-Object { $_.Extension -eq ".md" }
$totalMdFiles = $mdFiles.Count
$totalMdBytes = ($mdFiles | Measure-Object -Property Length -Sum).Sum

Write-Both "Total .md files          : $totalMdFiles" "White"
Write-Both "Total bytes in .md files : $totalMdBytes" "White"
Write-Both "Rough token estimate     : $($totalMdBytes / 4)" "White"
Write-Both "" "White"

# ================================================
# 3. GitHub Issues Summary + Full JSON Export
# ================================================
Write-Both "`n## 3. GitHub Issues" "Yellow"

Write-Both "Counting all issues (open + closed)..." "DarkGray"
$issueCount = (gh issue list --state all --limit 1000 | Measure-Object -Line).Lines
Write-Both "Total issues (open + closed): $issueCount" "White"

Write-Both "Exporting full issues JSON..." "DarkGray"
gh issue list --state all --limit 1000 --json number,title,state,comments,labels | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Out-File -FilePath ".\issues_full_export.json" -Encoding UTF8
Write-Both "✅ Full issues exported to: issues_full_export.json" "Green"
Write-Both "" "White"

# ================================================
# 4. Commit history quick view
# ================================================
Write-Both "`n## 4. Git Commit History Quick View" "Yellow"

Write-Both "Counting last 100 commits..." "DarkGray"
$commitCount = (git log --oneline -100 | Measure-Object -Line).Lines
Write-Both "Total commits in last 100: $commitCount" "White"

Write-Both "`n### Last 20 commits (most recent first)" "DarkYellow"
git log --pretty=format:"%h %ad %s" --date=short | Select-Object -First 20 | Tee-Object -FilePath $OutputFile -Append
Write-Both "" "White"

# Final footer
@"

---
**First-pass recon complete.**  
This was deliberately lightweight so it finishes quickly even on very large repos.

Next steps (tell me what you want):
1. Run full cloc now that we know the shape? (or only on specific folders)
2. Deeper scan on certain extensions (e.g. only .ts files)
3. Pull specific folder trees or sample files
4. Start the actual SitRep with this data

Just paste the entire content of **project_sitrep_firstpass.md** back to me (or attach the file).
"@ | Out-File -FilePath $OutputFile -Append -Encoding UTF8

Write-Both "`n✅ FIRST-PASS DONE!" "Green"
Write-Both "Files created:" "Cyan"
Write-Both "   • project_sitrep_firstpass.md     ← main lightweight summary (paste this back to me)" "Cyan"
Write-Both "   • issues_full_export.json          ← full GitHub issues" "Cyan"
Write-Both "`nDrop the markdown file content here and I’ll immediately analyze the real project shape and tell you exactly what data we should collect next." "Magenta"


gh issue list --state all --limit 1000 --json number,title,state,comments,labels | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Out-File -FilePath ".\issues_full_export.json" -Encoding UTF8
