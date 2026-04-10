# Icon Registry — visualAssets/rawIcons

This file tracks which raw icons have been assigned to which skill/component.
Before picking a new icon, check this list. After picking one, add a row here.

## Format

`skill/component` | `source file` | `cell`

---

## Assigned Icons

| Skill / Component  | Source File                                                     | Cell  | Deployed As             |
|--------------------|-----------------------------------------------------------------|-------|-------------------------|
| `research`         | `grok-image-bots07__r1c2__256x256.png`                         | r1c2  | `tabs/icons/research.png` |
| `web`              | `grok-image-bots05__r2c1__256x256.png`                         | r2c1  | `tabs/icons/web.png`      |
| `core`             | `Special_drones05__r2c1__256x256.png`                          | r2c1  | `tabs/icons/core.png`     |
| `weather`          | `grok-image-drones-metallic-hypercolor-01__r1c3__256x256.png`  | r1c3  | `tabs/icons/weather.png`  |
| `github`           | `grok-image-bots02__r1c3__256x256.png`                         | r1c3  | `tabs/icons/github.png`   |
| `teams`            | `grok-image-bots03__r1c3__256x256.png`                         | r1c3  | `tabs/icons/teams.png`    |

---

## How to Pick an Icon

1. Open a `*__contact-sheet.png` to browse the 3×3 grid of options.
2. Note the row/col of the image you want (e.g. r2c1 from `grok-image-bots05__contact-sheet.png`).
3. The corresponding individual file is `grok-image-bots05__r2c1__256x256.png` (or 192x192).
4. Copy that file to `tabs/icons/<skillname>.png` (create the folder if needed — deploy-tabs.yml will upload it to the storage static site).
5. Update the `iconUrl` in the skill's `manifest.json` to `https://helkinswarmtabsst.z20.web.core.windows.net/icons/<skillname>.png`.
6. Add a row to the Assigned Icons table above.

## Icon Sets Available

| Set                                     | Style                                | Best For                       |
|-----------------------------------------|--------------------------------------|-------------------------------|
| `drones01–04`                           | Metallic drone hardware              | Infrastructure / system skills |
| `grok-image-bots01–10`                  | Varied sci-fi orbs, cameras, probes  | General skill icons            |
| `grok-image-drones-hypercolor-01–02`    | Vibrant neon drones                  | High-energy / action skills    |
| `grok-image-drones-metallic-hypercolor-01–02` | Chrome + neon hybrid          | Premium / core skills          |
| `grok-image-ThisUniverse01`             | Cosmic / universe imagery            | Memory, research, abstract     |
| `Special_drones05–06`                   | Special heroic drone forms           | Hero / featured skills         |
