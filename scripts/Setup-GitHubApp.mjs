#!/usr/bin/env node
/**
 * Setup-GitHubApp.mjs — One-time GitHub App creation via App Manifest flow.
 *
 * Usage: node scripts/Setup-GitHubApp.mjs
 *
 * What it does:
 *  1. Starts a local HTTP server on port 3127
 *  2. Opens your browser → auto-submits the App Manifest to GitHub
 *  3. You click "Create GitHub App" once on GitHub's page
 *  4. GitHub redirects back to localhost with a code
 *  5. Script exchanges code for credentials (app_id + private key)
 *  6. Fetches the installation ID (GitHub auto-installs on your account)
 *  7. Stores private key in Azure Key Vault (helkinswarm-kv-a7f2)
 *  8. Sets GITHUB_APP_ID and GITHUB_INSTALLATION_ID as GitHub repo variables
 *
 * Prerequisites:
 *  - az CLI logged in (az login)
 *  - gh CLI logged in (gh auth login)
 *  - Key Vault exists (run deploy-stamp workflow first)
 */

import http from 'http';
import crypto from 'crypto';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

const exec = promisify(execCb);

const PORT = 3127;
const STATE = crypto.randomBytes(16).toString('hex');
const OWNER = 'putersdcat';
const REPO = 'HelkinSwarm';
const KV_NAME = 'helkinswarm-kv-a7f2';

const manifest = {
  name: 'HelkinSwarm Bot',
  description: 'HelkinSwarm self-repo backlog management — issues and milestones',
  url: `https://github.com/${OWNER}/${REPO}`,
  redirect_url: `http://localhost:${PORT}/callback`,
  public: false,
  default_permissions: {
    issues: 'write',
    metadata: 'read',
  },
  default_events: [],
};

// Auto-submitting landing page — user just clicks "Create GitHub App" on GitHub
const manifestJson = JSON.stringify(manifest).replace(/"/g, '&quot;');
function buildLandingHtml() {
  const scriptTag = '<' + 'script>setTimeout(()=>document.getElementById("manifest-form").submit(),500)</' + 'script>';
  return [
    '<!DOCTYPE html><html><head>',
    '<title>Creating HelkinSwarm GitHub App...</title>',
    '<style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#0d1117;color:#e6edf3}</style>',
    '</head><body>',
    '<h1>🤖 Creating HelkinSwarm GitHub App</h1>',
    '<p>Redirecting you to GitHub now...<br>You will need to click <strong>"Create GitHub App"</strong> once.</p>',
    `<form id="manifest-form" method="post" action="https://github.com/settings/apps/new">`,
    `  <input type="hidden" name="manifest" value="${manifestJson}" />`,
    `  <input type="hidden" name="state" value="${STATE}" />`,
    '  <button type="submit" style="padding:12px 24px;font-size:16px;cursor:pointer">Go to GitHub →</button>',
    '</form>',
    scriptTag,
    '</body></html>',
  ].join('\n');
}
const landingHtml = buildLandingHtml();

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

async function exchangeCode(code) {
  const resp = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HelkinSwarm-Setup/1.0',
    },
  });
  if (!resp.ok) {
    throw new Error(`Code exchange failed ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

function generateAppJwt(appId, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 600,
    iss: String(appId),
  })).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(privateKeyPem, 'base64url');
  return `${signingInput}.${signature}`;
}

async function getInstallations(appId, pem) {
  const jwt = generateAppJwt(appId, pem);
  const resp = await fetch('https://api.github.com/app/installations', {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'HelkinSwarm-Setup/1.0',
    },
  });
  if (!resp.ok) throw new Error(`Get installations failed ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// ---------------------------------------------------------------------------
// Credential storage
// ---------------------------------------------------------------------------

async function storeCredentials(appId, installationId, pem) {
  // The PEM key has real newlines — escape them for CLI argument
  const pemEscaped = pem.replace(/\r?\n/g, '\\n');

  console.log('\n📦 Storing private key in Azure Key Vault...');
  try {
    await exec(`az keyvault secret set --vault-name "${KV_NAME}" --name "GitHubAppPrivateKey" --value "${pemEscaped}" --output none`);
    console.log(`  ✅ GitHubAppPrivateKey → kv://${KV_NAME}/GitHubAppPrivateKey`);
  } catch (e) {
    // Try with --file approach (safer for large keys)
    const { writeFileSync, unlinkSync } = await import('fs');
    const tmpFile = '/tmp/gh-app-key.pem';
    writeFileSync(tmpFile, pem, { encoding: 'utf8', mode: 0o600 });
    try {
      await exec(`az keyvault secret set --vault-name "${KV_NAME}" --name "GitHubAppPrivateKey" --file "${tmpFile}" --output none`);
      console.log(`  ✅ GitHubAppPrivateKey → kv://${KV_NAME}/GitHubAppPrivateKey`);
    } finally {
      unlinkSync(tmpFile);
    }
  }

  console.log('\n🔧 Setting GitHub repo variables...');
  await exec(`gh variable set GITHUB_APP_ID --body "${appId}" --repo ${OWNER}/${REPO}`);
  await exec(`gh variable set GITHUB_INSTALLATION_ID --body "${installationId}" --repo ${OWNER}/${REPO}`);
  console.log(`  ✅ GITHUB_APP_ID = ${appId}`);
  console.log(`  ✅ GITHUB_INSTALLATION_ID = ${installationId}`);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(landingHtml);
    return;
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code || state !== STATE) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid callback — state mismatch or missing code');
      return;
    }

    try {
      console.log('\n🔑 Exchanging code for GitHub App credentials...');
      const appData = await exchangeCode(code);
      const { id: appId, slug, pem } = appData;
      console.log(`  ✅ App created — ID: ${appId} | Slug: ${slug}`);

      // Wait briefly for GitHub to finish auto-installing
      await new Promise(r => setTimeout(r, 2000));

      console.log('\n📋 Fetching installation ID...');
      const installations = await getInstallations(appId, pem);
      const installation = installations.find(i => i.account?.login === OWNER);
      if (!installation) {
        throw new Error(`No installation found for ${OWNER}. GitHub may not have auto-installed the app. Visit: https://github.com/apps/${slug}/installations/new`);
      }
      const installationId = installation.id;
      console.log(`  ✅ Installation ID: ${installationId} (account: ${installation.account.login})`);

      await storeCredentials(appId, installationId, pem);

      const successHtml = `<!DOCTYPE html><html>
<head><style>body{font-family:-apple-system,sans-serif;text-align:center;padding:60px;background:#0d1117;color:#e6edf3}</style></head>
<body>
  <h1>✅ GitHub App Created Successfully!</h1>
  <p>App ID: <strong>${appId}</strong></p>
  <p>Slug: <strong>${slug}</strong></p>
  <p>Installation ID: <strong>${installationId}</strong></p>
  <p>Private key stored in Key Vault. Repo variables set.</p>
  <p><strong>You can close this tab.</strong></p>
  <p>Run <code>git push origin main</code> to trigger deploy and activate the GitHub tools.</p>
</body></html>`;

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(successHtml);

      server.close();
      console.log(`
✅ Setup complete!
   App ID:          ${appId}
   Installation ID: ${installationId}
   Private key:     kv://${KV_NAME}/GitHubAppPrivateKey

Next steps:
  1. Push a commit to trigger deploy (the Bicep will wire up the KV reference)
  2. Or manually restart the Function App to pick up the new GITHUB_APP_PRIVATE_KEY env var
`);
      process.exit(0);
    } catch (e) {
      console.error('\n❌ Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:sans-serif;padding:40px"><h1>❌ Error</h1><pre>${e.message}</pre></body></html>`);
      server.close();
      process.exit(1);
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`
🤖 HelkinSwarm GitHub App Setup
================================
Server running at http://localhost:${PORT}
Opening browser... You'll be redirected to GitHub.

ACTION REQUIRED: Click "Create GitHub App" once on the GitHub page.
Everything else is automated.
`);
  // Open browser on Windows/Mac/Linux
  const openCmd = process.platform === 'win32'
    ? `start http://localhost:${PORT}`
    : process.platform === 'darwin'
      ? `open http://localhost:${PORT}`
      : `xdg-open http://localhost:${PORT}`;
  execCb(openCmd);
});

server.on('error', e => {
  console.error('Server error:', e);
  process.exit(1);
});
