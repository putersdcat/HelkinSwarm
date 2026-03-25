import { readFileSync, writeFileSync } from 'fs';
const key = readFileSync('.hostkey.tmp', 'utf8').trim();
const base = 'https://helkinswarm-func-a7f2.purplepebble-508e1162.eastus2.azurecontainerapps.io';
const id = 'overseer-40f5c975-3aa2-47d8-b32d-a9d7a392f6dc';
const url = `${base}/runtime/webhooks/durabletask/instances/${id}/terminate?reason=fix280-dedup&code=${key}`;
const r = await fetch(url, { method: 'POST' });
const result = `terminate: ${r.status} ${r.statusText}`;
console.log(result);
writeFileSync('.terminate-result.tmp', result);
