// HelkinSwarm Tab SPA — app.js (#304 sub-tabbed product-grade redesign)
// Hash-based router with secondary sub-tab navigation inside each top-level panel.
// Spec ref: docs/0o-Microsoft-Teams-App-Expansion-with-Tabs.md

/* global microsoftTeams */

(function () {
  "use strict";

  // Per-stamp API base — substituted at deploy time by deploy-tabs.yml
  var TAB_API_BASE = "{{TAB_API_BASE}}";

  // ─── Utilities ───────────────────────────────────────────────────────────

  function esc(str) {
    if (str == null) return "";
    var div = document.createElement("div");
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  function fmtDuration(seconds) {
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? d + "d " + h + "h " + m + "m" : h > 0 ? h + "h " + m + "m" : m + "m";
  }

  function fmtTime(iso) {
    if (!iso) return "\u2014";
    return new Date(iso).toLocaleString();
  }

  function fmtMoney(amount, currency) {
    if (typeof amount !== "number") return "\u2014";
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2
      }).format(amount);
    } catch (_) {
      return (currency || "USD") + " " + amount.toFixed(2);
    }
  }

  var PHASE_ICONS = {
    "llm-call": "\uD83E\uDD16", "tool-dispatch": "\uD83D\uDD27", "verification": "\uD83D\uDEE1\uFE0F",
    "memory": "\uD83E\uDDE0", "reply-send": "\uD83D\uDCAC", "orchestrator": "\u2699\uFE0F",
    "bot-receive": "\uD83D\uDCE8", "prompt-build": "\uD83D\uDCDD", "subagent": "\uD83E\uDD16",
    "executor": "\u2699\uFE0F", "confirmation": "\uD83D\uDD12",
    "llm": "\uD83E\uDD16", "tool": "\uD83D\uDD27", "reply": "\uD83D\uDCAC"
  };

  function renderTracePhases(phases, depth) {
    if (!phases || phases.length === 0) return "";
    var indent = depth * 20;
    return phases.map(function (p) {
      var icon = PHASE_ICONS[p.type] || "\uD83D\uDCCB";
      var statusCls = p.status === "error" ? "trace-error" : (p.status === "running" ? "trace-running" : "trace-ok");
      var hasChildren = p.children && p.children.length > 0;
      var toggle = hasChildren ? '<span class="trace-toggle">\u25BC</span>' : '<span class="trace-leaf">\u00B7</span>';
      var childHtml = hasChildren ? '<div class="trace-children">' + renderTracePhases(p.children, depth + 1) + '</div>' : '';
      var errorBadge = p.error ? ' <span class="trace-error-badge" title="' + esc(p.error) + '">\u26A0</span>' : '';
      return '<div class="trace-node" style="margin-left:' + indent + 'px">' +
        toggle + ' ' + icon + ' <strong>' + esc(p.name) + '</strong> ' +
        '<span class="trace-duration">' + p.durationMs + 'ms</span> ' +
        '<span class="trace-status ' + statusCls + '">' + esc(p.status) + '</span>' +
        errorBadge +
        (p.detail ? ' <span class="trace-detail">' + esc(p.detail) + '</span>' : '') +
        childHtml + '</div>';
    }).join("");
  }

  // ─── Theme ───────────────────────────────────────────────────────────────

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "dark") {
      root.style.setProperty("--bg", "#1f1f1f");
      root.style.setProperty("--text", "#ffffff");
      root.style.setProperty("--card-bg", "#2d2d2d");
      root.style.setProperty("--muted", "#a0a0a0");
      root.style.setProperty("--border", "#404040");
      root.style.setProperty("--nav-bg", "#4b4ea0");
      root.style.setProperty("--subtab-bg", "#2d2d2d");
      root.style.setProperty("--subtab-border", "#404040");
      root.style.setProperty("--kpi-bg", "#252525");
      root.style.setProperty("--accent-light", "#1a3a5c");
    } else if (theme === "contrast") {
      root.style.setProperty("--bg", "#000000");
      root.style.setProperty("--text", "#ffffff");
      root.style.setProperty("--card-bg", "#1a1a1a");
      root.style.setProperty("--muted", "#ffffff");
      root.style.setProperty("--border", "#ffffff");
      root.style.setProperty("--nav-bg", "#000000");
      root.style.setProperty("--subtab-bg", "#1a1a1a");
      root.style.setProperty("--subtab-border", "#ffffff");
      root.style.setProperty("--kpi-bg", "#111111");
      root.style.setProperty("--accent-light", "#003366");
    } else {
      ["--bg","--text","--card-bg","--muted","--border","--nav-bg",
       "--subtab-bg","--subtab-border","--kpi-bg","--accent-light"].forEach(function (v) {
        root.style.removeProperty(v);
      });
    }
  }

  // ─── Auth / API ──────────────────────────────────────────────────────────

  var _userOid = null;
  var _cachedToken = null;
  var _ssoAttempted = false;
  var _oboBootstrapAttempted = false;
  var _oboBootstrapPromise = null;

  function bootstrapOboFromTabToken(token) {
    if (!token) return Promise.resolve(null);
    if (_oboBootstrapPromise) return _oboBootstrapPromise;
    if (_oboBootstrapAttempted) return Promise.resolve(null);
    _oboBootstrapAttempted = true;

    _oboBootstrapPromise = fetch(TAB_API_BASE + "/bootstrap-obo", {
      method: "POST",
      headers: {
        "x-helkinswarm-user-id": _userOid,
        "Authorization": "Bearer " + token
      }
    }).then(function (resp) {
      if (!resp.ok) {
        return resp.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body && body.error ? body.error : ("Tab OBO bootstrap error: " + resp.status));
        });
      }
      return resp.json();
    }).then(function (body) {
      console.info("[HelkinSwarmTab] OBO bootstrap status:", body && body.status);
      return body;
    }).catch(function (err) {
      console.warn("[HelkinSwarmTab] OBO bootstrap failed:", err && err.message ? err.message : err);
      return null;
    });

    return _oboBootstrapPromise;
  }

  function getAadToken() {
    if (_cachedToken) return Promise.resolve(_cachedToken);
    if (_ssoAttempted) return Promise.resolve(null);
    _ssoAttempted = true;
    return microsoftTeams.authentication.getAuthToken().then(function (token) {
      _cachedToken = token;
      return bootstrapOboFromTabToken(token).then(function () { return token; });
    }).catch(function () {
      return null;
    });
  }

  function apiCall(endpoint) {
    if (!_userOid) return Promise.reject(new Error("Not authenticated."));
    return getAadToken().then(function (token) {
      if (!token) throw new Error("Authentication required \u2014 Teams SSO token unavailable.");
      var headers = { "x-helkinswarm-user-id": _userOid, "Authorization": "Bearer " + token };
      return fetch(TAB_API_BASE + "/" + endpoint, { headers: headers });
    }).then(function (resp) {
      if (resp.status === 503) {
        return resp.json().then(function (body) {
          throw new Error("cold-start:" + (body.retryAfter || 5));
        });
      }
      if (!resp.ok) throw new Error("Tab API error: " + resp.status);
      return resp.json();
    });
  }

  function apiPost(endpoint) {
    if (!_userOid) return Promise.reject(new Error("Not authenticated."));
    return getAadToken().then(function (token) {
      if (!token) throw new Error("Authentication required.");
      var headers = { "x-helkinswarm-user-id": _userOid, "Authorization": "Bearer " + token };
      return fetch(TAB_API_BASE + "/" + endpoint, { method: "POST", headers: headers });
    }).then(function (resp) {
      if (!resp.ok) throw new Error("Tab API error: " + resp.status);
      return resp.json();
    });
  }

  // ─── UI Helpers ──────────────────────────────────────────────────────────

  function showError(panelId, msg) {
    var el = document.getElementById(panelId);
    if (el) el.innerHTML = '<div class="error-msg">' + esc(msg) + "</div>";
  }

  function showColdStart(panelId, retryAfter) {
    var el = document.getElementById(panelId);
    if (el) {
      el.innerHTML =
        '<div class="card loading-card">' +
        "<h1>Starting up\u2026</h1>" +
        "<p>HelkinSwarm is cold-starting. Retrying in " + esc(retryAfter) + "s\u2026</p>" +
        "</div>";
    }
  }

  function buildSubtabRail(tabs, activeKey, onSelect) {
    var rail = document.createElement("div");
    rail.className = "subtab-rail";
    tabs.forEach(function (tab) {
      var btn = document.createElement("button");
      btn.className = "subtab-btn" + (tab.key === activeKey ? " active" : "");
      btn.textContent = tab.label;
      btn.addEventListener("click", function () {
        rail.querySelectorAll(".subtab-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        onSelect(tab.key);
      });
      rail.appendChild(btn);
    });
    return rail;
  }

  function buildPageHeader(title, statusHtml) {
    return '<div class="page-header"><h1>' + esc(title) + '</h1>' +
      '<div class="header-status">' + (statusHtml || '') +
      '<button class="refresh-btn">\u21BB Refresh</button>' +
      '</div></div>';
  }

  function kpiTile(label, value, cls) {
    return '<div class="kpi-tile"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-value' + (cls ? ' ' + cls : '') + '">' + esc(String(value)) + '</div></div>';
  }

  function healthRow(status, label, detail) {
    var dot = status === "ok" ? "dot-ok" : status === "warn" ? "dot-warn" : "dot-error";
    return '<div class="health-row"><span class="health-dot ' + dot + '"></span>' +
      '<span class="health-label">' + esc(label) + '</span>' +
      '<span class="health-detail">' + esc(detail) + '</span></div>';
  }

  function configRow(label, value) {
    return '<div class="config-row"><span class="config-label">' + esc(label) + '</span>' +
      '<span class="config-value">' + value + '</span></div>';
  }

  function badgeForStatus(status) {
    if (status === "ready" || status === "success") return "badge-ok";
    if (status === "blocked" || status === "action-required") return "badge-warn";
    if (status === "not-installed" || status === "error") return "badge-error";
    return "badge-info";
  }

  function renderInlineTags(items, cls) {
    if (!items || items.length === 0) return '<span class="muted">\u2014</span>';
    return items.map(function (item) {
      return '<span class="inline-tag' + (cls ? ' ' + cls : '') + '">' + esc(item) + '</span>';
    }).join(' ');
  }

  function renderSkillInspection(result) {
    if (!result) {
      return '<p class="empty-state">Choose a skill action to inspect onboarding, dependency, or lifecycle state.</p>';
    }

    return '<div class="inspection-card">' +
      '<div class="inspection-head"><strong>' + esc(result.skillId || 'skill') + '</strong>' +
      ' <span class="badge ' + badgeForStatus(result.status) + '">' + esc(result.status || 'info') + '</span></div>' +
      '<p>' + esc(result.message || 'No message returned.') + '</p>' +
      (result.onboardingMethod ? configRow('Onboarding', '<span class="badge badge-info">' + esc(result.onboardingMethod) + '</span>') : '') +
      (result.lifecycleRules ? configRow('Lifecycle', '<span class="badge badge-info">' + esc(result.lifecycleRules) + '</span>') : '') +
      (result.dependencies ? configRow('Dependencies', renderInlineTags(result.dependencies)) : '') +
      (result.missingDependencies ? configRow('Missing', renderInlineTags(result.missingDependencies, 'inline-tag-warn')) : '') +
      (result.blockingDependents ? configRow('Blocked By', renderInlineTags(result.blockingDependents, 'inline-tag-warn')) : '') +
      (result.requiredPermissions ? configRow('Permissions', renderInlineTags(result.requiredPermissions)) : '') +
      (result.externalAccountsNeeded ? configRow('Accounts', renderInlineTags(result.externalAccountsNeeded)) : '') +
      (result.externalAccountsToClose ? configRow('Close First', renderInlineTags(result.externalAccountsToClose, 'inline-tag-warn')) : '') +
      (result.steps && result.steps.length ? '<div class="card-section"><h3>Activation Steps</h3><ol class="mini-steps">' + result.steps.map(function (step) {
        return '<li>' + esc(step) + '</li>';
      }).join('') + '</ol></div>' : '') +
      (result.nextStep ? '<div class="card-section"><h3>Next Step</h3><pre>' + esc(result.nextStep) + '</pre></div>' : '') +
      '</div>';
  }

  // ─── Sub-tab panel renderer ──────────────────────────────────────────────

  function renderSubtabPanel(panelId, tabs, dataPromise, renderers, opts) {
    var panel = document.getElementById(panelId);
    var activeKey = tabs[0].key;

    dataPromise
      .then(function (data) {
        panel.innerHTML = "";
        var headerDiv = document.createElement("div");
        var statusHtml = opts && opts.statusBadge ? opts.statusBadge(data) : "";
        headerDiv.innerHTML = buildPageHeader(opts && opts.title || "", statusHtml);
        panel.appendChild(headerDiv);

        var contentContainer = document.createElement("div");
        var rail = buildSubtabRail(tabs, activeKey, function (key) {
          activeKey = key;
          renderContent(key);
        });
        panel.appendChild(rail);
        panel.appendChild(contentContainer);

        function renderContent(key) {
          if (renderers[key]) {
            contentContainer.innerHTML = '<div class="subtab-content active">' + renderers[key](data) + '</div>';
            if (opts && opts.afterRender) opts.afterRender(key, data, contentContainer);
          }
        }

        renderContent(activeKey);

        headerDiv.querySelector(".refresh-btn").addEventListener("click", function () {
          opts._refreshFn();
        });
      })
      .catch(function (err) {
        if (String(err.message).startsWith("cold-start:")) {
          var retry = parseInt(err.message.split(":")[1], 10) || 5;
          showColdStart(panelId, retry);
          setTimeout(function () { opts._refreshFn(); }, retry * 1000);
        } else {
          showError(panelId, err.message);
        }
      });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  GET STARTED
  // ═══════════════════════════════════════════════════════════════════════════

  function renderGetStarted() {
    var tabs = [
      { key: "overview", label: "Overview" },
      { key: "actions", label: "Quick Actions" },
      { key: "connections", label: "Connections" },
      { key: "help", label: "Help" }
    ];

    var dataP = Promise.all([apiCall("get-started"), apiCall("skills"), apiCall("dashboard")]).then(function (r) {
      return { gs: r[0], skills: r[1], dash: r[2] };
    });

    renderSubtabPanel("panel-get-started", tabs, dataP, {
      overview: function (d) {
        var gs = d.gs;
        var dash = d.dash || {};
        var skills = d.skills.skills || [];
        var skillCount = (gs.activeSkills || []).length;
        var oauthSkills = skills.filter(function (s) { return s.linkRequired; });
        var maintenance = dash.maintenanceMode ? "warn" : "ok";
        return '<div class="kpi-row">' +
          kpiTile("Version", dash.version || "\u2014") +
          kpiTile("Tools Loaded", gs.capabilitiesCount, "kpi-ok") +
          kpiTile("Active Skills", skillCount) +
          kpiTile("OAuth Skills", oauthSkills.length, oauthSkills.length > 0 ? "kpi-warn" : "") +
          kpiTile("Safety Mode", gs.safetyMode) +
          kpiTile("SkillForge", gs.skillforgeEnabled ? "Enabled" : "Disabled") +
          '</div>' +
          '<div class="two-col">' +
          '<div class="card"><h2>Readiness</h2>' +
          healthRow(dash.status === "healthy" ? "ok" : "warn", "Runtime", dash.status === "healthy" ? "Healthy" : (dash.status || "Unknown")) +
          healthRow(maintenance, "Maintenance", dash.maintenanceMode ? "Active" : "Clear") +
          healthRow(skillCount > 0 ? "ok" : "warn", "Skills Loaded", skillCount + " active skills") +
          healthRow(oauthSkills.length > 0 ? "warn" : "ok", "Connections", oauthSkills.length > 0 ? oauthSkills.length + " skills still need chat linking as required" : "No OAuth link steps required") +
          '</div>' +
          '<div class="card"><h2>Next Best Steps</h2>' +
          '<div class="cta-list">' +
          '<button class="cmd-btn cmd-btn-primary tab-nav-btn" data-panel="control-center">Open Control Center</button>' +
          '<button class="cmd-btn tab-nav-btn" data-panel="skills-library">Open Skills Library</button>' +
          '<button class="cmd-btn">/status</button>' +
          '<button class="cmd-btn">/link outlook</button>' +
          '</div>' +
          '<p class="muted">Use the Teams chat for commands and the tabs for overview, management, and drill-down.</p>' +
          '</div></div>' +
          '<div class="card"><h2>What is HelkinSwarm?</h2>' +
          '<p>Your personal sovereign AI copilot in Microsoft Teams. HelkinSwarm orchestrates frontier LLMs, ' +
          'tools, and skills to act as a forward-deployed digital assistant \u2014 a Special Circumstances unit ' +
          'built in the spirit of the Culture series.</p>' +
          '<p style="margin-top:8px;color:var(--muted);font-size:13px">' +
          'Active capabilities: <strong>' + esc(gs.capabilitiesCount) + '</strong> tools across ' +
          '<strong>' + esc(skillCount) + '</strong> skills.</p></div>' +
          '<div class="card"><h2>Active Skills</h2>' +
          '<div class="skill-list">' +
          (gs.activeSkills || []).map(function (s) {
            return '<span class="skill-chip">' + esc(s) + '</span>';
          }).join("") + '</div></div>';
      },
      actions: function (d) {
        var cmds = d.gs.quickCommands || [];
        return '<div class="card"><h2>Quick Commands</h2>' +
          '<p style="margin-bottom:12px;color:var(--muted);font-size:13px">Type these in the HelkinSwarm chat:</p>' +
          cmds.map(function (c) {
            var cls = c.danger ? "cmd-btn cmd-btn-danger" : "cmd-btn";
            return '<button class="' + cls + '">' + esc(c.label) + ' <code>' + esc(c.cmd) + '</code></button>';
          }).join(" ") +
          '</div>' +
          '<div class="card"><h2>Control Surfaces</h2>' +
          '<div class="cta-list">' +
          '<button class="cmd-btn cmd-btn-primary tab-nav-btn" data-panel="control-center">Go to Control Center</button>' +
          '<button class="cmd-btn tab-nav-btn" data-panel="skills-library">Go to Skills Library</button>' +
          '</div>' +
          '<p class="muted">Tabs are for dashboards and management. Chat is for commands, linking, and actual work execution.</p>' +
          '</div>' +
          '<div class="card"><h2>Common Actions</h2>' +
          '<div class="step-list">' +
          '<div class="step-item"><div class="step-num">1</div><div class="step-body">' +
          '<h3>Check Status</h3><p>Type <code>/status</code> to see service health and model routing.</p></div></div>' +
          '<div class="step-item"><div class="step-num">2</div><div class="step-body">' +
          '<h3>Link an Account</h3><p>Type <code>/link</code> to connect OAuth accounts for skill access.</p></div></div>' +
          '<div class="step-item"><div class="step-num">3</div><div class="step-body">' +
          '<h3>Ask Anything</h3><p>Send a message. HelkinSwarm routes to the best model and dispatches tools automatically.</p></div></div>' +
          '</div></div>';
      },
      connections: function (d) {
        var skills = d.skills.skills || [];
        var oauthSkills = skills.filter(function (s) { return s.linkRequired; });
        var connected = skills.filter(function (s) { return s.installed && s.linkRequired; });
        var needsLink = oauthSkills.length - connected.length;

        return '<div class="kpi-row">' +
          kpiTile("OAuth Skills", oauthSkills.length) +
          kpiTile("Connected", connected.length, connected.length > 0 ? "kpi-ok" : "") +
          kpiTile("Needs Link", needsLink, needsLink > 0 ? "kpi-warn" : "kpi-ok") +
          '</div>' +
          '<div class="card"><h2>Account Connections</h2>' +
          (oauthSkills.length > 0 ?
            oauthSkills.map(function (s) {
              return '<div class="connection-card">' +
                '<div class="connection-head"><strong>' + esc(s.displayName) + '</strong><span class="badge badge-warn">/link required</span></div>' +
                '<p>' + esc(s.shortDescription) + '</p>' +
                configRow('Onboarding', '<span class="badge badge-info">' + esc(s.onboardingMethod) + '</span>') +
                configRow('Permissions', renderInlineTags(s.requiredPermissions)) +
                configRow('External Accounts', renderInlineTags(s.externalAccountsNeeded)) +
                '<div class="cta-list"><button class="cmd-btn">/link ' + esc(s.domain) + '</button></div>' +
                '</div>';
            }).join("") :
            '<p class="empty-state">No OAuth-integrated skills.</p>') +
          '</div>';
      },
      help: function () {
        return '<div class="card"><h2>How HelkinSwarm Works</h2>' +
          '<div class="step-list">' +
          '<div class="step-item"><div class="step-num">1</div><div class="step-body">' +
          '<h3>You send a message</h3><p>In the HelkinSwarm Teams chat, type naturally.</p></div></div>' +
          '<div class="step-item"><div class="step-num">2</div><div class="step-body">' +
          '<h3>Request classification</h3><p>The orchestrator classifies your request as simple, compound, or complex.</p></div></div>' +
          '<div class="step-item"><div class="step-num">3</div><div class="step-body">' +
          '<h3>LLM + Tools</h3><p>Routed to the best model. Tools dispatched automatically if needed.</p></div></div>' +
          '<div class="step-item"><div class="step-num">4</div><div class="step-body">' +
          '<h3>Safety check</h3><p>Responses pass through the safety pipeline. Dangerous actions require confirmation.</p></div></div>' +
          '<div class="step-item"><div class="step-num">5</div><div class="step-body">' +
          '<h3>Reply delivered</h3><p>Response appears in chat with optional operational telemetry.</p></div></div>' +
          '</div></div>' +
          '<div class="card"><h2>Key Concepts</h2>' +
          configRow("Overseer", "Eternal orchestrator managing session state") +
          configRow("Skills", "Modular tool packages (Outlook, GitHub, etc.)") +
          configRow("Model Lanes", "Global (frontier) or EU (DataZone) routing") +
          configRow("Safety Pipeline", "Four-eyes verification for dangerous ops") +
          configRow("SkillForge", "Create custom skills from natural language") +
          '</div>' +
          '<div class="card"><h2>Where to go next</h2>' +
          '<div class="step-list">' +
          '<div class="step-item"><div class="step-num">A</div><div class="step-body"><h3>Control Center</h3><p>Use it for runtime health, costs, sessions, and diagnostics.</p></div></div>' +
          '<div class="step-item"><div class="step-num">B</div><div class="step-body"><h3>Skills Library</h3><p>Use it to inspect onboarding, lifecycle rules, uninstall impact, and reload capability manifests.</p></div></div>' +
          '<div class="step-item"><div class="step-num">C</div><div class="step-body"><h3>Teams Chat</h3><p>Use chat for live commands, linking, and day-to-day work.</p></div></div>' +
          '</div>';
      }
    }, {
      title: "Get Started",
      _refreshFn: renderGetStarted,
      afterRender: function (_key, _data, container) {
        container.querySelectorAll('.tab-nav-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var panel = btn.getAttribute('data-panel');
            if (panel) router.navigate(panel);
          });
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONTROL CENTER (absorbs Dev Console as sub-tab)
  // ═══════════════════════════════════════════════════════════════════════════

  function renderControlCenter() {
    var tabs = [
      { key: "overview", label: "Overview" },
      { key: "health", label: "Health" },
      { key: "costs", label: "Costs" },
      { key: "config", label: "Config" },
      { key: "sessions", label: "Sessions" },
      { key: "dev", label: "Dev" }
    ];

    var dataP = Promise.all([apiCall("dashboard"), apiCall("dev-console"), apiCall("costs")]).then(function (r) {
      return { dash: r[0], dev: r[1], costs: r[2] };
    });

    renderSubtabPanel("panel-control-center", tabs, dataP, {
      overview: function (d) {
        var data = d.dash;
        var llm = d.dev.llmHealth || { aggregate: "ok" };
        var model = data.model || {};
        var llmCls = llm.aggregate === "down" ? "kpi-error" : llm.aggregate === "degraded" ? "kpi-warn" : "kpi-ok";

        return '<div class="kpi-row">' +
          kpiTile("Status", data.status === "healthy" ? "Healthy" : data.status, data.status === "healthy" ? "kpi-ok" : "kpi-warn") +
          kpiTile("Uptime", fmtDuration(data.uptime)) +
          kpiTile("Version", data.version) +
          kpiTile("Sessions", data.activeSessions + " / " + data.totalSessions) +
          kpiTile("Tools", data.capabilities.toolCount) +
          kpiTile("LLM", llm.aggregate === "ok" ? "OK" : llm.aggregate.toUpperCase(), llmCls) +
          '</div>' +
          '<div class="two-col">' +
          '<div class="card"><h2>Model Routing</h2>' +
          '<table><tr><th>Role</th><th>Deployment</th></tr>' +
          '<tr><td>Primary</td><td><code>' + esc(model.primary) + '</code></td></tr>' +
          '<tr><td>Secondary</td><td><code>' + esc(model.secondary) + '</code></td></tr>' +
          '<tr><td>Reasoning</td><td><code>' + esc(model.reasoning || "\u2014") + '</code></td></tr>' +
          '<tr><td>Embedding</td><td><code>' + esc(model.embedding) + '</code></td></tr>' +
          '<tr><td>Vision</td><td><code>' + esc(model.vision || "\u2014") + '</code></td></tr>' +
          '<tr><td>Lane</td><td><strong>' + esc(model.laneName) + '</strong></td></tr></table></div>' +
          '<div class="card"><h2>Quick Stats</h2>' +
          configRow("Safety", '<span class="badge badge-ok">' + esc(data.safetyMode) + '</span>') +
          configRow("EU Residency", data.euResidencyMode ? '<span class="badge badge-info">ON</span>' : '<span class="badge">OFF</span>') +
          configRow("Maintenance", data.maintenanceMode ? '<span class="badge badge-warn">ACTIVE</span>' : '<span class="badge badge-ok">OFF</span>') +
          configRow("Skills", (data.capabilities.activeSkills || []).length + " loaded") +
          '</div></div>';
      },
      health: function (d) {
        var llm = d.dev.llmHealth || { aggregate: "ok", models: [] };
        var models = llm.models || [];
        var relay = d.dev.relay || { total: 0, pending: 0 };
        var mem = d.dev.memory || { totalVaults: 0, totalEntries: 0 };
        var llmBadge = llm.aggregate === "down" ? "kpi-error" : llm.aggregate === "degraded" ? "kpi-warn" : "kpi-ok";

        return '<div class="kpi-row">' +
          kpiTile("LLM Health", llm.aggregate === "ok" ? "OK" : llm.aggregate.toUpperCase(), llmBadge) +
          kpiTile("Models", models.length) +
          kpiTile("Relay 24h", relay.total + " msgs") +
          kpiTile("Pending", relay.pending, relay.pending > 0 ? "kpi-warn" : "") +
          kpiTile("Vaults", mem.totalVaults) +
          kpiTile("Entries", mem.totalEntries) +
          '</div>' +
          '<div class="card"><h2>LLM Model Health</h2>' +
          (models.length > 0 ?
            models.map(function (m) {
              var st = m.isDown ? "error" : m.consecutiveFailures > 0 ? "warn" : "ok";
              var dt = m.isDown ? "DOWN" : m.consecutiveFailures > 0 ? m.consecutiveFailures + " failures" : "OK";
              if (m.lastSuccessAt) dt += " \u00B7 Last OK: " + fmtTime(m.lastSuccessAt);
              return healthRow(st, m.deploymentName, dt);
            }).join("") :
            '<p class="empty-state">No LLM health data yet.</p>') +
          '</div>' +
          '<div class="card"><h2>Component Status</h2>' +
          healthRow("ok", "Bot Framework", "Receiving messages") +
          healthRow(d.dash.maintenanceMode ? "warn" : "ok", "Maintenance", d.dash.maintenanceMode ? "ACTIVE" : "Clear") +
          healthRow("ok", "Orchestrator", d.dash.activeSessions + " active sessions") +
          healthRow(relay.pending > 5 ? "warn" : "ok", "IDE Relay", relay.total + " / " + relay.pending + " pending") +
          healthRow("ok", "Cosmos DB", mem.totalVaults + " vaults") +
          '</div>';
      },
      costs: function (d) {
        var data = d.costs || {};
        if (data.status !== "success") {
          return '<div class="card"><h2>Azure Costs</h2>' +
            '<p class="error-msg">' + esc(data.message || 'Cost data unavailable.') + '</p>' +
            (data.detail ? '<pre>' + esc(data.detail) + '</pre>' : '') +
            '</div>';
        }

        var breakdown = data.breakdown || [];
        var daily = data.daily || [];
        var top = breakdown.slice(0, 8);
        var maxServiceCost = top.reduce(function (max, item) { return Math.max(max, item.cost || 0); }, 0) || 1;
        var recentDaily = daily.slice(-14);
        var maxDailyCost = recentDaily.reduce(function (max, item) { return Math.max(max, item.cost || 0); }, 0) || 1;

        return '<div class="kpi-row">' +
          kpiTile('Period', data.period || 'MonthToDate') +
          kpiTile('Resource Group', data.resourceGroup || '\u2014') +
          kpiTile('Total Spend', fmtMoney(data.totalCost, data.currency), 'kpi-ok') +
          kpiTile('Services', breakdown.length) +
          '</div>' +
          '<div class="two-col">' +
          '<div class="card"><h2>Top Services</h2>' +
          (top.length > 0 ? top.map(function (item) {
            var width = Math.max(8, Math.round((item.cost / maxServiceCost) * 100));
            return '<div class="cost-row">' +
              '<div class="cost-row-header"><span>' + esc(item.service) + '</span><strong>' + esc(fmtMoney(item.cost, data.currency)) + '</strong></div>' +
              '<div class="cost-bar"><span class="cost-bar-fill" style="width:' + width + '%"></span></div>' +
              '</div>';
          }).join('') : '<p class="empty-state">No cost breakdown data.</p>') +
          '</div>' +
          '<div class="card"><h2>Daily Trend (Last 14 Days)</h2>' +
          (recentDaily.length > 0 ? recentDaily.map(function (item) {
            var width = Math.max(6, Math.round((item.cost / maxDailyCost) * 100));
            return '<div class="cost-row">' +
              '<div class="cost-row-header"><span>' + esc(item.date) + '</span><strong>' + esc(fmtMoney(item.cost, data.currency)) + '</strong></div>' +
              '<div class="cost-bar cost-bar-daily"><span class="cost-bar-fill" style="width:' + width + '%"></span></div>' +
              '</div>';
          }).join('') : '<p class="empty-state">No daily cost data yet.</p>') +
          '</div></div>' +
          '<div class="card"><h2>Notes</h2>' +
          '<p>Current scope shows month-to-date spend for the active stamp resource group with service breakdowns and daily trend bars.</p>' +
          '<p class="muted">Filters, model-level slices, and richer charts remain follow-on work under the broader Costs UI backlog.</p>' +
          '</div>';
      },
      config: function (d) {
        var data = d.dash;
        var model = data.model || {};
        return '<div class="card"><h2>Safety &amp; Security</h2>' +
          configRow("Safety Mode", '<span class="badge badge-ok">' + esc(data.safetyMode) + '</span>') +
          configRow("EU Residency", data.euResidencyMode ? '<span class="badge badge-info">Enabled</span>' : '<span class="badge">Disabled</span>') +
          configRow("Maintenance", data.maintenanceMode ? '<span class="badge badge-warn">Active</span>' : '<span class="badge badge-ok">Off</span>') +
          '</div>' +
          '<div class="card"><h2>Model Configuration</h2>' +
          configRow("Lane", '<span class="badge badge-info">' + esc(model.laneName) + '</span>') +
          configRow("Primary", '<code>' + esc(model.primary) + '</code>') +
          configRow("Secondary", '<code>' + esc(model.secondary) + '</code>') +
          configRow("Reasoning", '<code>' + esc(model.reasoning || "\u2014") + '</code>') +
          configRow("Embedding", '<code>' + esc(model.embedding) + '</code>') +
          configRow("Vision", '<code>' + esc(model.vision || "\u2014") + '</code>') +
          '</div>' +
          '<div class="card"><h2>Capabilities</h2>' +
          configRow("Tools Loaded", data.capabilities.toolCount) +
          configRow("Active Skills", (data.capabilities.activeSkills || []).join(", ")) +
          '</div>';
      },
      sessions: function (d) {
        var sessions = (d.dev.sessions && d.dev.sessions.list) || [];
        var active = d.dev.sessions ? d.dev.sessions.active : 0;
        var total = d.dev.sessions ? d.dev.sessions.total : 0;

        return '<div class="kpi-row">' +
          kpiTile("Active", active, active > 0 ? "kpi-ok" : "") +
          kpiTile("Total", total) +
          '</div>' +
          '<div class="card"><h2>Orchestration Sessions</h2>' +
          (sessions.length > 0 ?
            '<table><tr><th>Instance</th><th>Name</th><th>Status</th><th>Created</th><th>Action</th></tr>' +
            sessions.slice(0, 25).map(function (s) {
              var badge = s.isRunning ? "ok" : "warn";
              var killBtn = s.isRunning
                ? '<button class="btn-kill" data-instance="' + esc(s.instanceId) + '">Kill</button>'
                : "";
              return '<tr><td><code>' + esc(s.instanceId) + '</code></td>' +
                '<td>' + esc(s.name) + '</td>' +
                '<td><span class="badge badge-' + badge + '">' + esc(s.runtimeStatus) + '</span></td>' +
                '<td>' + fmtTime(s.createdAt) + '</td>' +
                '<td>' + killBtn + '</td></tr>';
            }).join("") + '</table>' :
            '<p class="empty-state">No sessions found.</p>') +
          '</div>';
      },
      dev: function (d) {
        var hooks = (d.dev.hooks && d.dev.hooks.list) || [];
        var mem = d.dev.memory || { vaults: [] };
        var relay = d.dev.relay || {};

        return '<div class="kpi-row">' +
          kpiTile("Hooks", (d.dev.hooks ? d.dev.hooks.active : 0) + " / " + (d.dev.hooks ? d.dev.hooks.total : 0)) +
          kpiTile("Relay", (relay.total || 0) + " / " + (relay.pending || 0) + " pending") +
          kpiTile("Memory", (mem.totalVaults || 0) + " vaults") +
          '</div>' +
          '<div class="card"><h2>Durable Hooks</h2>' +
          (hooks.length > 0 ?
            '<table><tr><th>Hook</th><th>Type</th><th>Skill</th><th>Status</th><th>Expires</th></tr>' +
            hooks.slice(0, 15).map(function (h) {
              var b = h.status === "active" ? "ok" : h.status === "paused" ? "warn" : "error";
              return '<tr><td><code>' + esc(h.id) + '</code></td>' +
                '<td>' + esc(h.hookType) + '</td><td>' + esc(h.skillDomain) + '</td>' +
                '<td><span class="badge badge-' + b + '">' + esc(h.status) + '</span></td>' +
                '<td>' + fmtTime(h.expiresAt) + '</td></tr>';
            }).join("") + '</table>' :
            '<p class="empty-state">No hooks registered.</p>') +
          '</div>' +
          '<div class="card"><h2>Memory Vaults</h2>' +
          (mem.vaults && mem.vaults.length > 0 ?
            '<table><tr><th>Skill</th><th>Entries</th><th>Last Updated</th></tr>' +
            mem.vaults.map(function (v) {
              return '<tr><td>' + esc(v.skill) + '</td><td>' + esc(v.entries) + '</td><td>' + fmtTime(v.lastUpdated) + '</td></tr>';
            }).join("") + '</table>' :
            '<p class="empty-state">No memory vaults yet.</p>') +
          '</div>' +
          '<div class="card"><h2>Recent Traces</h2>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap">' +
          '<input id="trace-since" type="datetime-local" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;background:var(--card-bg);color:var(--text)">' +
          '<input id="trace-until" type="datetime-local" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;background:var(--card-bg);color:var(--text)">' +
          '<button id="trace-filter-btn" class="cmd-btn">Filter</button>' +
          '<button id="trace-clear-btn" class="cmd-btn">Clear</button></div>' +
          '<div id="recent-traces"><p class="empty-state">Loading\u2026</p></div></div>' +
          '<div class="card"><h2>Correlation Search</h2>' +
          '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<input id="corr-input" type="text" placeholder="Correlation tag\u2026" ' +
          'style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px;background:var(--card-bg);color:var(--text)">' +
          '<button id="corr-search-btn" class="cmd-btn">Search</button></div>' +
          '<div id="corr-results"></div></div>';
      }
    }, {
      title: "Control Center",
      statusBadge: function (d) {
        var cls = d.dash.status === "healthy" ? "badge-ok" : "badge-warn";
        return '<span class="badge ' + cls + '">' + esc(d.dash.status) + '</span>';
      },
      _refreshFn: renderControlCenter,
      afterRender: function (key, data, container) {
        if (key === "sessions") {
          container.querySelectorAll(".btn-kill").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.getAttribute("data-instance");
              btn.disabled = true;
              btn.textContent = "Killing\u2026";
              apiPost("sessions/" + id + "/terminate")
                .then(function () { renderControlCenter(); })
                .catch(function (err) { btn.textContent = err.message; });
            });
          });
        }
        if (key === "dev") {
          loadRecentTraces();
          wireTraceFilters();
          wireCorrelationSearch();
        }
      }
    });
  }

  // ─── Trace helpers (Control Center > Dev) ─────────────────────────────

  function loadRecentTraces(since, until) {
    var el = document.getElementById("recent-traces");
    if (!el) return;
    el.innerHTML = '<p class="empty-state">Loading\u2026</p>';
    var url = "traces?limit=20";
    if (since) url += "&since=" + encodeURIComponent(since);
    if (until) url += "&until=" + encodeURIComponent(until);
    apiCall(url)
      .then(function (data) {
        var recent = data.recent || [];
        if (!recent.length) {
          el.innerHTML = '<p class="empty-state">No traces yet.</p>';
          return;
        }
        el.innerHTML = '<table><tr><th>Correlation</th><th>Started</th><th>Total</th><th>Phases</th></tr>' +
          recent.map(function (t) {
            return '<tr><td><a class="trace-link" data-corr="' + esc(t.correlationId) + '" href="#">' +
              '<code>' + esc(t.correlationId) + '</code></a></td>' +
              '<td>' + fmtTime(t.turnStartedAt) + '</td><td>' + t.totalMs + 'ms</td><td>' + t.phaseCount + '</td></tr>';
          }).join("") + '</table>';
        el.querySelectorAll(".trace-link").forEach(function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            var inp = document.getElementById("corr-input");
            if (inp) inp.value = a.getAttribute("data-corr");
            var btn = document.getElementById("corr-search-btn");
            if (btn) btn.click();
          });
        });
      })
      .catch(function (err) {
        el.innerHTML = '<p class="error-msg">' + esc(err.message) + '</p>';
      });
  }

  function wireTraceFilters() {
    var fb = document.getElementById("trace-filter-btn");
    if (fb) fb.addEventListener("click", function () {
      var s = document.getElementById("trace-since");
      var u = document.getElementById("trace-until");
      loadRecentTraces(
        s && s.value ? new Date(s.value).toISOString() : undefined,
        u && u.value ? new Date(u.value).toISOString() : undefined
      );
    });
    var cb = document.getElementById("trace-clear-btn");
    if (cb) cb.addEventListener("click", function () {
      var s = document.getElementById("trace-since");
      var u = document.getElementById("trace-until");
      if (s) s.value = "";
      if (u) u.value = "";
      loadRecentTraces();
    });
  }

  function wireCorrelationSearch() {
    var sb = document.getElementById("corr-search-btn");
    if (!sb) return;
    sb.addEventListener("click", function () {
      var input = document.getElementById("corr-input");
      var tag = input ? input.value.trim() : "";
      if (!tag) return;
      var results = document.getElementById("corr-results");
      if (results) results.innerHTML = '<p class="empty-state">Searching\u2026</p>';
      apiCall("traces?corr=" + encodeURIComponent(tag))
        .then(function (data) {
          var html = "";
          if (data.traceTree && data.traceTree.phases && data.traceTree.phases.length > 0) {
            html += '<div class="trace-tree"><h3>Trace \u2014 ' + esc(data.correlationTag) + '</h3>' +
              '<div class="trace-summary"><span class="trace-total">Total: ' + data.traceTree.totalMs + 'ms</span> \u00B7 ' +
              fmtTime(data.traceTree.turnStartedAt) + '</div>' +
              renderTracePhases(data.traceTree.phases, 0) + '</div>';
          }
          if (data.messages && data.messages.length > 0) {
            html += '<h3>Relay Messages (' + data.count + ')</h3>' +
              '<table><tr><th>Direction</th><th>Type</th><th>Time</th><th>Payload</th></tr>' +
              data.messages.map(function (m) {
                return '<tr><td>' + esc(m.direction) + '</td><td>' + esc(m.messageType) + '</td>' +
                  '<td>' + fmtTime(m.createdAt) + '</td><td><pre>' + esc((m.payload || "").substring(0, 200)) + '</pre></td></tr>';
              }).join("") + '</table>';
          }
          if (!html) html = '<p class="empty-state">No data for: ' + esc(tag) + '</p>';
          results.innerHTML = html;
          results.querySelectorAll(".trace-toggle").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var ch = btn.parentElement.querySelector(".trace-children");
              if (ch) {
                var hidden = ch.style.display === "none";
                ch.style.display = hidden ? "block" : "none";
                btn.textContent = hidden ? "\u25BC" : "\u25B6";
              }
            });
          });
        })
        .catch(function (err) {
          results.innerHTML = '<p class="error-msg">' + esc(err.message) + '</p>';
        });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SKILLS LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════

  function renderSkillsLibrary() {
    var tabs = [
      { key: "installed", label: "Installed" },
      { key: "manage", label: "Manage" },
      { key: "connections", label: "Connections" },
      { key: "catalog", label: "Catalog" }
    ];

    renderSubtabPanel("panel-skills-library", tabs, apiCall("skills"), {
      installed: function (data) {
        var installed = (data.skills || []).filter(function (s) { return s.installed; });
        return '<div class="kpi-row">' +
          kpiTile("Installed", installed.length, "kpi-ok") +
          kpiTile("Total Tools", data.totalTools) +
          '</div>' +
          '<div class="skills-grid">' +
          (installed.length > 0 ? installed.map(function (skill) { return renderSkillCard(skill, true); }).join("") : '<p class="empty-state">No skills installed.</p>') +
          '</div>';
      },
      manage: function (data) {
        var skills = data.skills || [];
        return '<div class="kpi-row">' +
          kpiTile("Manageable", skills.length, "kpi-ok") +
          kpiTile("Reload Scope", "User-only") +
          kpiTile("Mode", "Inspect / Prepare") +
          '</div>' +
          '<div class="card"><h2>Management Actions</h2>' +
          '<p>This surface now exposes real readiness and uninstall-impact checks plus owner-only skill reload. Actual enable/disable persistence is still a follow-on backend capability and is shown honestly as such.</p>' +
          '<div class="manage-toolbar"><button class="cmd-btn cmd-btn-primary" id="skills-reload-btn">Reload Skills</button><span id="skills-reload-status" class="muted"></span></div>' +
          '</div>' +
          '<div class="skills-grid manage-grid">' +
          (skills.length > 0 ? skills.map(renderManageSkillCard).join('') : '<p class="empty-state">No skills found.</p>') +
          '</div>' +
          '<div class="card"><h2>Inspection Result</h2><div id="skill-inspection-panel">' +
          '<p class="empty-state">Choose a skill action to inspect onboarding, dependencies, lifecycle rules, or uninstall blockers.</p>' +
          '</div></div>';
      },
      catalog: function (data) {
        var skills = data.skills || [];
        return '<div class="kpi-row">' +
          kpiTile("Total", skills.length) +
          kpiTile("Tools", data.totalTools) +
          kpiTile("Installed", skills.filter(function (s) { return s.installed; }).length, "kpi-ok") +
          kpiTile("Available", skills.filter(function (s) { return !s.installed; }).length) +
          '</div>' +
          '<div class="card"><h2>Catalog Mode</h2><p>Browse all currently loaded manifests. Use the <strong>Manage</strong> tab for readiness checks, dependency impact, and owner-only reload operations.</p></div>' +
          '<div class="skills-grid">' +
          (skills.length > 0 ? skills.map(function (skill) { return renderSkillCard(skill, false); }).join("") : '<p class="empty-state">No skills.</p>') +
          '</div>';
      },
      connections: function (data) {
        var oauth = (data.skills || []).filter(function (s) { return s.linkRequired; });
        return '<div class="card"><h2>OAuth-Integrated Skills</h2>' +
          '<p style="margin-bottom:12px;color:var(--muted);font-size:13px">Skills requiring <code>/link</code> in chat:</p>' +
          (oauth.length > 0 ?
            oauth.map(function (s) {
              return healthRow(s.installed ? "ok" : "warn", s.displayName,
                s.installed ? "Linkable \u2014 " + s.toolCount + " tools" : "Not linked");
            }).join("") :
            '<p class="empty-state">No skills require OAuth.</p>') +
          '</div>' +
          '<div class="card"><h2>Connection Notes</h2>' +
          '<p>The Skills tab currently shows connection requirements and routes you to chat commands like <code>/link outlook</code>. Fine-grained linked/unlinked state per skill remains constrained by the shared auth runtime and will be tightened in follow-on work.</p>' +
          '</div>';
      }
    }, {
      title: "Skills Library",
      statusBadge: function () {
        return '<span class="badge badge-info">Management mode</span>';
      },
      _refreshFn: renderSkillsLibrary,
      afterRender: function (key, data, container) {
        if (key !== "manage") return;

        var resultPanel = container.querySelector("#skill-inspection-panel");
        var reloadBtn = container.querySelector("#skills-reload-btn");
        var reloadStatus = container.querySelector("#skills-reload-status");

        function setInspectionBusy(text) {
          if (resultPanel) resultPanel.innerHTML = '<p class="empty-state">' + esc(text) + '</p>';
        }

        container.querySelectorAll(".skill-action-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var skillId = btn.getAttribute("data-skill");
            var action = btn.getAttribute("data-action");
            if (!skillId || !action) return;
            setInspectionBusy(action === "install" ? "Inspecting activation steps..." : "Inspecting uninstall impact...");
            apiPost("skills/" + encodeURIComponent(skillId) + "/" + (action === "install" ? "install-readiness" : "uninstall-impact"))
              .then(function (result) {
                if (resultPanel) resultPanel.innerHTML = renderSkillInspection(result);
              })
              .catch(function (err) {
                if (resultPanel) resultPanel.innerHTML = '<p class="error-msg">' + esc(err.message) + '</p>';
              });
          });
        });

        if (reloadBtn) {
          reloadBtn.addEventListener("click", function () {
            reloadBtn.disabled = true;
            if (reloadStatus) reloadStatus.textContent = "Reloading...";
            apiPost("skills/reload")
              .then(function (result) {
                if (reloadStatus) reloadStatus.textContent = result.message || "Reloaded.";
                renderSkillsLibrary();
              })
              .catch(function (err) {
                if (reloadStatus) reloadStatus.textContent = err.message;
                reloadBtn.disabled = false;
              });
          });
        }
      }
    });
  }

  function renderSkillCard(s, showMetadata) {
    var badge = s.installed ? '<span class="badge badge-ok">Installed</span>' : '<span class="badge">Available</span>';
    var linkBadge = s.linkRequired ? ' <span class="badge badge-warn">OAuth</span>' : '';
    var tools = (s.toolNames || []).map(function (t) { return '<code>' + esc(t) + '</code>'; }).join(', ');
    return '<div class="card skill-card">' +
      '<div class="skill-card-header">' +
      '<img src="' + esc(s.iconUrl) + '" alt="" class="skill-icon" width="32" height="32" />' +
      '<div><h3>' + esc(s.displayName) + '</h3>' + badge + linkBadge + '</div></div>' +
      '<p>' + esc(s.shortDescription) + '</p>' +
      '<p class="muted">' + s.toolCount + ' tool' + (s.toolCount !== 1 ? 's' : '') + ': ' + tools + '</p>' +
      (showMetadata ? '<div class="skill-meta">' +
        configRow('Onboarding', '<span class="badge badge-info">' + esc(s.onboardingMethod) + '</span>') +
        configRow('Lifecycle', '<span class="badge badge-info">' + esc(s.lifecycleRules) + '</span>') +
        configRow('Dependencies', renderInlineTags(s.dependencies)) +
        configRow('Permissions', renderInlineTags(s.requiredPermissions)) +
        configRow('Accounts', renderInlineTags(s.externalAccountsNeeded)) +
        '</div>' : '') +
      '</div>';
  }

  function renderManageSkillCard(s) {
    return '<div class="card skill-card manage-card">' +
      '<div class="skill-card-header">' +
      '<img src="' + esc(s.iconUrl) + '" alt="" class="skill-icon" width="32" height="32" />' +
      '<div><h3>' + esc(s.displayName) + '</h3>' +
      '<span class="badge badge-ok">Loaded</span>' +
      (s.linkRequired ? ' <span class="badge badge-warn">OAuth</span>' : '') +
      '</div></div>' +
      '<p>' + esc(s.shortDescription) + '</p>' +
      '<div class="manage-actions">' +
      '<button class="cmd-btn cmd-btn-primary skill-action-btn" data-action="install" data-skill="' + esc(s.domain) + '">Check Activation</button>' +
      '<button class="cmd-btn skill-action-btn" data-action="uninstall" data-skill="' + esc(s.domain) + '">Check Uninstall Impact</button>' +
      '</div>' +
      '<div class="skill-facts">' +
      '<span class="inline-tag">' + esc(s.onboardingMethod) + '</span> ' +
      '<span class="inline-tag">' + esc(s.lifecycleRules) + '</span> ' +
      '<span class="inline-tag">' + esc(String(s.maintenanceTaskCount)) + ' maintenance</span>' +
      '</div>' +
      '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ROUTER
  // ═══════════════════════════════════════════════════════════════════════════

  var router = {
    navigate: function (panel) { window.location.hash = panel; },
    render: function () {
      var panel = window.location.hash.replace("#", "") || "get-started";
      document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
      var target = document.getElementById("panel-" + panel);
      if (target) target.classList.add("active");
      document.querySelectorAll(".nav-btn").forEach(function (btn) {
        btn.classList.toggle("active-tab", btn.getAttribute("data-panel") === panel);
      });
      if (panel === "get-started") renderGetStarted();
      else if (panel === "control-center") renderControlCenter();
      else if (panel === "skills-library") renderSkillsLibrary();
    }
  };

  window.router = router;
  window.addEventListener("hashchange", router.render);

  // ─── Teams SDK Init ──────────────────────────────────────────────────────

  microsoftTeams.app.initialize().then(function () {
    return microsoftTeams.app.getContext();
  }).then(function (ctx) {
    var thm = ctx.app && ctx.app.theme;
    applyTheme(thm === "dark" ? "dark" : thm === "contrast" ? "contrast" : "default");
    _userOid = ctx.user && ctx.user.id;
    if (!_userOid) {
      showError("loading", "User context unavailable.");
      return;
    }
    microsoftTeams.app.registerOnThemeChangeHandler(function (theme) {
      applyTheme(theme === "dark" ? "dark" : theme === "contrast" ? "contrast" : "default");
    });
    var loading = document.getElementById("loading");
    if (loading) loading.remove();
    router.render();
  }).catch(function () {
    var loading = document.getElementById("loading");
    if (loading) {
      loading.innerHTML = '<div class="card"><h1>Authentication required</h1>' +
        '<p>Open this tab inside a signed-in Teams session.</p></div>';
    }
  });
})();