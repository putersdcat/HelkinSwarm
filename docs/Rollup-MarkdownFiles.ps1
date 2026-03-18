#requires -Version 7

<#
.SYNOPSIS
    Markdown Rollup Script
    Combines ALL .md files in the current directory (and subfolders) into one clean archive.
    Drop this script in the folder and run it.
#>

param(
    [string]$Folder = $PSScriptRoot,
    [string]$ExcludedFolder = ".\Archive"
)

$OutputFile = Join-Path $Folder "FULL-MARKDOWN-ARCHIVE.md"
$FailedLog  = Join-Path $Folder "MarkdownRollup-Failed.log"

# Normalize excluded folder path so we can reliably filter it out
$excludedPath = if ($ExcludedFolder) {
    $p = [System.IO.Path]::GetFullPath((Join-Path $Folder $ExcludedFolder))
    if (-not $p.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $p += [System.IO.Path]::DirectorySeparatorChar }
    $p
} else {
    $null
}

# Get all markdown files (recursive - change to -Depth 0 if you want only top level)
$mdFiles = Get-ChildItem -Path $Folder -Recurse -Filter *.md -File |
           Where-Object {
               $_.Name -ne "FULL-MARKDOWN-ARCHIVE.md" -and
               ($null -eq $excludedPath -or -not $_.FullName.StartsWith($excludedPath, [System.StringComparison]::InvariantCultureIgnoreCase))
           } |
           Sort-Object FullName

$mdContent = [System.Collections.Generic.List[string]]::new()
$successCount = 0
$failCount = 0

# Header
$mdContent.Add("# Full Markdown Archive")
$mdContent.Add("**Generated:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$mdContent.Add("**Total files:** $($mdFiles.Count)")
$mdContent.Add("**Folder:** $Folder")
$mdContent.Add("")

# Table of Contents
$mdContent.Add("## Table of Contents")
foreach ($file in $mdFiles) {
    $relativePath = $file.FullName.Substring($Folder.Length + 1).Replace('\', '/')
    $mdContent.Add("- [$relativePath](#$(($relativePath -replace '[^a-zA-Z0-9]', '-').ToLower()))")
}
$mdContent.Add("")

# Process each file
foreach ($file in $mdFiles) {
    try {
        $relativePath = $file.FullName.Substring($Folder.Length + 1).Replace('\', '/')
        $content = Get-Content $file.FullName -Raw -Encoding UTF8

        $mdContent.Add("## $($relativePath)")
        $mdContent.Add("")
        $mdContent.Add($content.TrimEnd())
        $mdContent.Add("")
        $mdContent.Add("────────────────────────────────────────────────────────────")
        $mdContent.Add("")

        $successCount++
        Write-Host "✓ Added: $relativePath" -ForegroundColor Green
    }
    catch {
        "Failed: $($file.FullName) | $($_.Exception.Message)" | Add-Content $FailedLog
        Write-Host "⚠ Skipped: $($file.Name)" -ForegroundColor Yellow
        $failCount++
    }
}

# Write the final archive
$mdContent | Out-File -FilePath $OutputFile -Encoding UTF8

Write-Host "`n✅ Full markdown archive created!" -ForegroundColor Green
Write-Host "Output file: $OutputFile" -ForegroundColor Green
Write-Host "Successfully processed: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "Failed files (see MarkdownRollup-Failed.log): $failCount" -ForegroundColor Red
}