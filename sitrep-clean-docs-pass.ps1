# ================================================
# Grok SitRep – CLEAN DOCS MANIFEST GENERATOR
# Run this from project root. Creates clean-docs-manifest.md
# ================================================

$OutputFile = ".\clean-docs-manifest.md"
$RepoRoot = Get-Location

function Write-Both {
    param([string]$Message, [string]$Color = "White")
    Write-Host $Message -ForegroundColor $Color
    $Message | Out-File -FilePath $OutputFile -Append -Encoding UTF8
}

@"
# Clean Docs Manifest – Curated for Grok SitRep
**Generated:** $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
**Purpose:** ONLY these files are allowed in any SitRep prompt.
All other .md files in the repo are ignored.

Relevant folders scanned:
- docs/
- .github/
- src/
- skills/
- infra/

Junk patterns excluded: archive, old, backup, research, deprecated, draft, todo, ArchivalResearch, ResearchDocs, extensions, dist, node_modules, .mypy_cache, tests

---

"@ | Out-File -FilePath $OutputFile -Encoding UTF8

$relevantFolders = @("docs", ".github", "src", "skills", "infra")

foreach ($folder in $relevantFolders) {
    $path = Join-Path $RepoRoot $folder
    if (Test-Path $path) {
        Write-Both "`n## Folder: $folder/" "Yellow"
        
        Get-ChildItem -Path $path -Recurse -Filter "*.md" -File | 
            Where-Object { 
                $_.FullName -notmatch '(?i)(archive|old|backup|research|deprecated|draft|todo|archival|researchdocs)' 
            } | 
            ForEach-Object {
                $relPath = $_.FullName.Substring($RepoRoot.Path.Length + 1).Replace('\', '/')
                $sizeKB = [math]::Round($_.Length / 1KB, 2)
                $priority = if ($_.DirectoryName -like "*docs*") { "living" } else { "supporting" }
                
                Write-Both "- $relPath  ($sizeKB KB)  [priority: $priority]" "White"
            }
    }
}

Write-Both "`n---`n**Manifest complete.** Copy this entire file (or its content) back to me." "Cyan"
Write-Both "We will feed this manifest + only the listed files into the first multi-agent prompt." "Magenta"