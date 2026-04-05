# Project SitRep – FIRST-PASS RECON
**Generated:** 2026-04-02 12:34:11
**Repository Root:** C:\GitRoots\HelkinSwarm
**Purpose:** Quick lightweight scan to understand real project shape before any heavy commands.

---


✅ Starting FIRST-PASS reconnaissance (this should be fast even on huge repos)...

## 1. Quick Recursive Project Structure Overview
Scanning all files and folders (this is the fast native PowerShell equivalent of a recursive dir)...
Total files found  : 63830
Total directories  : 9105

### Top 25 File Extensions (by count)

Extension      Count   TotalBytes   TotalKB TotalMB
---------      -----   ----------   ------- -------
.ts            18709  69196765,00  67574,97   65,99
.map           18352 118776717,00 115992,89  113,27
.js            18241 135678229,00 132498,27  129,39
.json           2950  68202751,00  66604,25   65,04
.md             1460  11737155,00  11462,07   11,19
.mjs            1414   8605506,00   8403,81    8,21
(no extension)   989   2062306,00   2013,97    1,97
.png             229  23263810,00  22718,56   22,19
.cjs             199   8491413,00   8292,40    8,10
.yml             155    173709,00    169,64    0,17
.mdx             152    484570,00    473,21    0,46
.ps1             141    486441,00    475,04    0,46
.cts             135    708899,00    692,28    0,68
.cmd             127    115127,00    112,43    0,11
.jst              75    150129,00    146,61    0,14
.mts              72    447210,00    436,73    0,43
.eslintrc         54     15528,00     15,16    0,01
.txt              42   1121042,00   1094,77    1,07
.nycrc            37      6813,00      6,65    0,01
.tsbuildinfo      25    869663,00    849,28    0,83
.gitkeep          23         0,00      0,00    0,00
.npmignore        20      1173,00      1,15    0,00
.xml              16    114077,00    111,40    0,11
.def              15     50286,00     49,11    0,05
.zip              14    824598,00    805,27    0,79



### Top-Level Folders (files + size inside each)
• .github → 26 files, 0.21 MB
• .local → 1 files, 0.01 MB
• .mypy_cache → 1431 files, 51.99 MB
• .playwright-mcp → 0 files, 0 MB
• .vscode → 3 files, 0 MB
• appPackage → 18 files, 0.86 MB
• ArchivalResearch → 21 files, 0.34 MB
• config → 1 files, 0 MB
• dist → 608 files, 2.1 MB
• dist-mcp → 12 files, 0.11 MB
• docs → 144 files, 7.38 MB
• extensions → 18274 files, 111.13 MB
• infra → 11 files, 0.18 MB
• memories → 1 files, 0 MB
• model-profiles → 4 files, 0 MB
• node_modules → 42676 files, 394.75 MB
• ResearchDocs → 4 files, 0.02 MB
• scripts → 14 files, 0.25 MB
• skills → 25 files, 0.2 MB
• src → 159 files, 0.99 MB
• tabs → 5 files, 0.3 MB
• tests → 132 files, 0.37 MB
• visualAssets → 236 files, 23.96 MB


## 2. Markdown Documentation Size
Scanning all .md files...
Total .md files          : 1460
Total bytes in .md files : 11737155
Rough token estimate     : 2934288.75


## 3. GitHub Issues
Counting all issues (open + closed)...
Total issues (open + closed): 483
Exporting full issues JSON...
✅ Full issues exported to: issues_full_export.json


## 4. Git Commit History Quick View
Counting last 100 commits...
Total commits in last 100: 100

### Last 20 commits (most recent first)
5728c55 2026-04-02 fix(#439): normalize inline image mime metadata
f4beb4e 2026-04-02 fix(#439): ingest teams hosted inline images
f144b8c 2026-04-02 fix(#480): prefer reliable default lane
4f82543 2026-04-02 fix(#480): restore verbose failover telemetry
5241d7d 2026-04-02 fix(#479): stop compact-json discovery short-circuit
0a0e50c 2026-04-02 feat(#464): add azure mcp skill
a844dbf 2026-04-02 fix(#479): force outlook follow-up execution
4e8de6b 2026-04-02 feat(#465): add graph enterprise mcp skill
8c8152e 2026-04-02 fix(#477): synthesize exact-tool json replies
3836c9c 2026-04-02 fix(#477): bypass llm for exact core tool calls
fac66c8 2026-04-02 fix(#478): honor exact core-tool requests
66afdf0 2026-04-02 feat(#466): add microsoft learn mcp skill
c60a226 2026-04-01 feat(#452): add mcp onboarding safety gates
ab6fe68 2026-04-01 fix(#451): expose mcpforge bundle approval
bdbb587 2026-04-01 feat(#451): add mcp registry tab onboarding
b943931 2026-04-01 feat(#451): draft mcpforge review bundles
d3bc06c 2026-04-01 feat(#449): add mcp registry discovery cache
14f4bc6 2026-04-01 fix(#450): sync lockfile for mcp runtime sdk
a2bef5a 2026-04-01 feat(#450): add stdio mcp connector
684c68a 2026-04-01 feat(#463): add capability-group discovery slices


---
**First-pass recon complete.**  
This was deliberately lightweight so it finishes quickly even on very large repos.

Next steps (tell me what you want):
1. Run full cloc now that we know the shape? (or only on specific folders)
2. Deeper scan on certain extensions (e.g. only .ts files)
3. Pull specific folder trees or sample files
4. Start the actual SitRep with this data

Just paste the entire content of **project_sitrep_firstpass.md** back to me (or attach the file).

✅ FIRST-PASS DONE!
Files created:
   • project_sitrep_firstpass.md     ← main lightweight summary (paste this back to me)
   • issues_full_export.json          ← full GitHub issues

Drop the markdown file content here and I’ll immediately analyze the real project shape and tell you exactly what data we should collect next.
