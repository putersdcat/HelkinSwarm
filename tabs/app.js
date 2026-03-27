// HelkinSwarm Tab SPA — app.js
// Hash-based router for Get Started, Control Center, Dev Console, Skills Library panels.
// Spec ref: docs/ADDENDA/ADDENDA-03-Tab-Infrastructure-Control-Center-and-Dev-Console.md

/* global microsoftTeams */

(function () {
  "use strict";

  // Per-stamp API base — substituted at deploy time by deploy-tabs.yml
  // Placeholder uses the live Function App URL for the default stamp.
  var TAB_API_BASE = "{{TAB_API_BASE}}";

  // Escape HTML to prevent XSS from API data
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
    return d > 0 ? d + "d " + h + "h " + m + "m" : h + "h " + m + "m";
  }

  // Phase type icons for trace tree (#140, #269)
  // Enriched type names from sessionTracer.ts TracePhaseType enum
  var PHASE_ICONS = {
    // Current enriched type names
    "llm-call": "🤖", "tool-dispatch": "🔧", "verification": "🛡️",
    "memory": "🧠", "reply-send": "💬", "orchestrator": "⚙️",
    "bot-receive": "📨", "prompt-build": "📝", "subagent": "🤖",
    "executor": "⚙️", "confirmation": "🔒",
    // Legacy aliases (kept for backwards compatibility with old traces)
    "llm": "🤖", "tool": "🔧", "reply": "💬"
  };

  /**
   * Render trace phases as a collapsible tree (recursive).
   * Each node shows: icon, name, duration, status badge, detail.
   * Children are nested with indent and collapsible via toggle button.
   */
  function renderTracePhases(phases, depth) {
    if (!phases || phases.length === 0) return "";
    var indent = depth * 20;
    return phases.map(function (p) {
      var icon = PHASE_ICONS[p.type] || "📋";
      var statusCls = p.status === "error" ? "trace-error" : (p.status === "running" ? "trace-running" : "trace-ok");
      var hasChildren = p.children && p.children.length > 0;
      var toggle = hasChildren ? '<span class="trace-toggle">▼</span>' : '<span class="trace-leaf">·</span>';
      var childHtml = hasChildren ? '<div class="trace-children">' + renderTracePhases(p.children, depth + 1) + '</div>' : '';
      var errorBadge = p.error ? ' <span class="trace-error-badge" title="' + esc(p.error) + '">⚠</span>' : '';
      return '<div class="trace-node" style="margin-left:' + indent + 'px">' +
        toggle + ' ' + icon + ' <strong>' + esc(p.name) + '</strong> ' +
        '<span class="trace-duration">' + p.durationMs + 'ms</span> ' +
        '<span class="trace-status ' + statusCls + '">' + esc(p.status) + '</span>' +
        errorBadge +
        (p.detail ? ' <span class="trace-detail">' + esc(p.detail) + '</span>' : '') +
        childHtml +
        '</div>';
    }).join("");
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === "dark") {
      root.style.setProperty("--bg", "#1f1f1f");
      root.style.setProperty("--text", "#ffffff");
      root.style.setProperty("--card-bg", "#2d2d2d");
      root.style.setProperty("--muted", "#a0a0a0");
      root.style.setProperty("--border", "#404040");
      root.style.setProperty("--nav-bg", "#4b4ea0");
    } else if (theme === "contrast") {
      root.style.setProperty("--bg", "#000000");
      root.style.setProperty("--text", "#ffffff");
      root.style.setProperty("--card-bg", "#1a1a1a");
      root.style.setProperty("--muted", "#ffffff");
      root.style.setProperty("--border", "#ffffff");
      root.style.setProperty("--nav-bg", "#000000");
    } else {
      // Default light theme — CSS vars already set
      root.style.removeProperty("--bg");
      root.style.removeProperty("--text");
      root.style.removeProperty("--card-bg");
      root.style.removeProperty("--muted");
      root.style.removeProperty("--border");
      root.style.removeProperty("--nav-bg");
    }
  }

  // User OID from Teams context (set during init)
  var _userOid = null;

  // Cached AAD token from Teams SDK (may be null if SSO not configured)
  var _cachedToken = null;
  var _ssoAttempted = false;

  function getAadToken() {
    if (_cachedToken) return Promise.resolve(_cachedToken);
    if (_ssoAttempted) return Promise.resolve(null);
    _ssoAttempted = true;
    return microsoftTeams.authentication.getAuthToken().then(function (token) {
      _cachedToken = token;
      return token;
    }).catch(function () {
      // SSO not configured (missing Entra app registration) — fall back to context-only auth
      return null;
    });
  }

  function apiCall(endpoint) {
    if (!_userOid) return Promise.reject(new Error("Not authenticated — Teams context unavailable."));
    return getAadToken().then(function (token) {
      if (!token) throw new Error("Authentication required — Teams SSO token unavailable.");
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
    if (!_userOid) return Promise.reject(new Error("Not authenticated — Teams context unavailable."));
    return getAadToken().then(function (token) {
      if (!token) throw new Error("Authentication required — Teams SSO token unavailable.");
      var headers = { "x-helkinswarm-user-id": _userOid, "Authorization": "Bearer " + token };
      return fetch(TAB_API_BASE + "/" + endpoint, { method: "POST", headers: headers });
    }).then(function (resp) {
      if (!resp.ok) throw new Error("Tab API error: " + resp.status);
      return resp.json();
    });
  }

  function showError(panelId, msg) {
    var el = document.getElementById(panelId);
    if (el) el.innerHTML = '<div class="error-msg">' + esc(msg) + "</div>";
  }

  function showColdStart(panelId, retryAfter) {
    var el = document.getElementById(panelId);
    if (el) {
      el.innerHTML =
        '<div class="card loading-card">' +
        "<h1>Starting up...</h1>" +
        "<p>HelkinSwarm is cold-starting. Retrying in " + esc(retryAfter) + "s...</p>" +
        "</div>";
    }
  }

  function showAuthRequired(msg) {
    var loading = document.getElementById("loading");
    if (loading) loading.remove();

    var appRoot = document.getElementById("app");
    if (appRoot) {
      appRoot.innerHTML =
        '<div class="panel active">' +
        '<div class="card">' +
        '<h1>Authentication required</h1>' +
        '<p>' + esc(msg || "Open this tab inside a signed-in Teams session with SSO available.") + '</p>' +
        '</div>' +
        '</div>';
    }
  }

  // --- Router ---

  var router = {
    navigate: function (panel) {
      window.location.hash = panel;
    },

    render: function () {
      var panel = (window.location.hash.replace("#", "") || "get-started");
      document.querySelectorAll(".panel").forEach(function (p) {
        p.classList.remove("active");
      });
      var target = document.getElementById("panel-" + panel);
      if (target) target.classList.add("active");

      if (panel === "get-started") router.renderGetStarted();
      else if (panel === "control-center") router.renderControlCenter();
      else if (panel === "dev-console") router.renderDevConsole();
      else if (panel === "skills-library") router.renderSkillsLibrary();
    },

    renderGetStarted: function () {
      var panelId = "panel-get-started";
      apiCall("get-started")
        .then(function (data) {
          var cmds = (data.quickCommands || [])
            .map(function (c) {
              var cls = c.danger ? "cmd-btn cmd-btn-danger" : "cmd-btn";
              return '<button class="' + cls + '">' + esc(c.label) + " (" + esc(c.cmd) + ")</button>";
            })
            .join(" ");

          var skills = (data.activeSkills || [])
            .map(function (s) {
              return '<span class="skill-chip">' + esc(s) + "</span>";
            })
            .join("");

          document.getElementById(panelId).innerHTML =
            "<h1>Get Started</h1>" +
            '<div class="card"><h2>Quick Commands</h2>' + cmds + "</div>" +
            '<div class="card"><h2>Active Capabilities (' + esc(data.capabilitiesCount) + " tools)</h2>" +
            '<div class="skill-list">' + skills + "</div></div>" +
            '<div class="card"><h2>Safety</h2><p>Mode: <strong>' +
            esc(data.safetyMode) + "</strong></p>" +
            "<p>SkillForge: <strong>" + (data.skillforgeEnabled ? "Enabled" : "Disabled") + "</strong></p></div>";
        })
        .catch(function (err) {
          if (String(err.message).startsWith("cold-start:")) {
            var retry = parseInt(err.message.split(":")[1], 10) || 5;
            showColdStart(panelId, retry);
            setTimeout(function () { router.renderGetStarted(); }, retry * 1000);
          } else {
            showError(panelId, err.message);
          }
        });
    },

    renderControlCenter: function () {
      var panelId = "panel-control-center";
      apiCall("dashboard")
        .then(function (data) {
          var model = data.model || {};
          document.getElementById(panelId).innerHTML =
            "<h1>Control Center</h1>" +
            '<div class="card"><h2>Service Status</h2>' +
            '<span class="badge badge-' + (data.status === "healthy" ? "ok" : "warn") + '">' +
            esc(data.status) + "</span>" +
            "<p>Uptime: " + fmtDuration(data.uptime) + " | Version: " + esc(data.version) + "</p>" +
            "<p>Sessions: " + esc(data.activeSessions) + " active / " + esc(data.totalSessions) + " total</p></div>" +
            '<div class="card"><h2>Model Routing</h2>' +
            "<table><tr><th>Role</th><th>Deployment</th></tr>" +
            "<tr><td>Primary</td><td>" + esc(model.primary) + "</td></tr>" +
            "<tr><td>Secondary</td><td>" + esc(model.secondary) + "</td></tr>" +
            "<tr><td>Reasoning</td><td>" + esc(model.reasoning || "—") + "</td></tr>" +
            "<tr><td>Embedding</td><td>" + esc(model.embedding) + "</td></tr>" +
            "<tr><td>Vision</td><td>" + esc(model.vision || "—") + "</td></tr>" +
            "<tr><td>Lane</td><td><strong>" + esc(model.laneName) + "</strong></td></tr></table></div>" +
            '<div class="card"><h2>Safety &amp; Maintenance</h2>' +
            "<p>Safety Mode: <strong>" + esc(data.safetyMode) + "</strong></p>" +
            "<p>EU Residency: <strong>" + (data.euResidencyMode ? "ON" : "OFF") + "</strong></p>" +
            "<p>Maintenance: <strong>" +
            (data.maintenanceMode ? '<span class="badge badge-warn">ON</span>' : '<span class="badge badge-ok">OFF</span>') +
            "</strong></p></div>" +
            '<div class="card"><h2>Capabilities</h2>' +
            "<p>" + esc(data.capabilities.toolCount) + " tools loaded across " +
            esc((data.capabilities.activeSkills || []).length) + " skills</p></div>" +
            '<div class="card"><h2>Developer Tools</h2>' +
            '<button class="cmd-btn" onclick="router.navigate(\'dev-console\')">Open Dev Console</button></div>';
        })
        .catch(function (err) {
          if (String(err.message).startsWith("cold-start:")) {
            var retry = parseInt(err.message.split(":")[1], 10) || 5;
            showColdStart(panelId, retry);
            setTimeout(function () { router.renderControlCenter(); }, retry * 1000);
          } else {
            showError(panelId, err.message);
          }
        });
    },

    renderDevConsole: function () {
      var panelId = "panel-dev-console";
      apiCall("dev-console")
        .then(function (data) {
          var sessions = (data.sessions && data.sessions.list) || [];
          var sessActive = data.sessions ? data.sessions.active : 0;
          var sessTotal = data.sessions ? data.sessions.total : 0;

          // Sessions table with kill buttons
          var sessRows = sessions
            .slice(0, 25)
            .map(function (s) {
              var badge = s.isRunning ? "ok" : "warn";
              var killBtn = s.isRunning
                ? '<button class="btn-kill" data-instance="' + esc(s.instanceId) + '">Kill</button>'
                : "";
              return (
                "<tr><td>" + esc(s.instanceId) + "</td>" +
                "<td>" + esc(s.name) + "</td>" +
                '<td><span class="badge badge-' + badge + '">' + esc(s.runtimeStatus) + "</span></td>" +
                "<td>" + (s.createdAt ? new Date(s.createdAt).toLocaleString() : "—") + "</td>" +
                "<td>" + killBtn + "</td></tr>"
              );
            })
            .join("");

          // Hooks summary
          var hooks = (data.hooks && data.hooks.list) || [];
          var hookRows = hooks
            .slice(0, 15)
            .map(function (h) {
              var badge = h.status === "active" ? "ok" : h.status === "paused" ? "warn" : "error";
              return (
                "<tr><td>" + esc(h.id) + "</td>" +
                "<td>" + esc(h.hookType) + "</td>" +
                "<td>" + esc(h.skillDomain) + "</td>" +
                '<td><span class="badge badge-' + badge + '">' + esc(h.status) + "</span></td>" +
                "<td>" + (h.expiresAt ? new Date(h.expiresAt).toLocaleString() : "—") + "</td></tr>"
              );
            })
            .join("");

          // Relay stats
          var relay = data.relay || { total: 0, pending: 0 };

          // Memory stats
          var mem = data.memory || { totalVaults: 0, totalEntries: 0, vaults: [] };

          // Maintenance status
          var maintBadge = data.maintenance ? "error" : "ok";
          var maintText = data.maintenance ? "ACTIVE" : "Clear";

          var html =
            "<h1>Dev Console</h1>" +

            // Status cards row
            '<div class="card-row">' +
            '<div class="card mini-card"><h3>Sessions</h3><span class="stat">' +
            esc(sessActive) + " / " + esc(sessTotal) + "</span></div>" +
            '<div class="card mini-card"><h3>Hooks</h3><span class="stat">' +
            esc(data.hooks ? data.hooks.active : 0) + " / " + esc(data.hooks ? data.hooks.total : 0) + "</span></div>" +
            '<div class="card mini-card"><h3>Relay (24h)</h3><span class="stat">' +
            esc(relay.total) + " msgs / " + esc(relay.pending) + " pending</span></div>" +
            '<div class="card mini-card"><h3>Memory</h3><span class="stat">' +
            esc(mem.totalVaults) + " vaults / " + esc(mem.totalEntries) + " entries</span></div>" +
            '<div class="card mini-card"><h3>Maintenance</h3><span class="badge badge-' +
            maintBadge + '">' + maintText + "</span></div>" +
            '<div class="card mini-card"><h3>Safety</h3><span class="stat">' +
            esc(data.safetyMode) + "</span></div>" +
            "</div>" +

            // Sessions table
            '<div class="card"><h2>Orchestration Sessions</h2>' +
            "<table><tr><th>Instance</th><th>Name</th><th>Status</th><th>Created</th><th>Action</th></tr>" +
            sessRows + "</table></div>" +

            // Hooks table
            '<div class="card"><h2>Durable Hooks</h2>' +
            (hookRows
              ? "<table><tr><th>Hook ID</th><th>Type</th><th>Skill</th><th>Status</th><th>Expires</th></tr>" +
                hookRows + "</table>"
              : "<p>No hooks registered.</p>") +
            "</div>" +

            // Memory vaults
            '<div class="card"><h2>Memory Vaults</h2>' +
            (mem.vaults.length > 0
              ? "<table><tr><th>Skill</th><th>Entries</th><th>Last Updated</th></tr>" +
                mem.vaults.map(function (v) {
                  return "<tr><td>" + esc(v.skill) + "</td>" +
                    "<td>" + esc(v.entries) + "</td>" +
                    "<td>" + (v.lastUpdated ? new Date(v.lastUpdated).toLocaleString() : "—") + "</td></tr>";
                }).join("") + "</table>"
              : "<p>No memory vaults created yet.</p>") +
            "</div>" +

            // Recent traces list
            '<div class="card"><h2>Recent Traces</h2>' +
            '<div style="display:flex;gap:8px;margin-bottom:8px">' +
            '<input id="trace-since" type="datetime-local" ' +
            'style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">' +
            '<input id="trace-until" type="datetime-local" ' +
            'style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px">' +
            '<button id="trace-filter-btn" class="cmd-btn">Filter</button>' +
            '<button id="trace-clear-btn" class="cmd-btn" style="background:var(--muted)">Clear</button></div>' +
            '<div id="recent-traces"><p>Loading...</p></div>' +
            '</div>' +

            // Correlation search
            '<div class="card"><h2>Correlation Search</h2>' +
            '<div style="display:flex;gap:8px;margin-bottom:8px">' +
            '<input id="corr-input" type="text" placeholder="Enter correlation tag..." ' +
            'style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:4px;font-size:13px">' +
            '<button id="corr-search-btn" class="cmd-btn">Search</button></div>' +
            '<div id="corr-results"></div>' +
            "</div>";

          document.getElementById(panelId).innerHTML = html;

          // Wire kill buttons
          document.querySelectorAll(".btn-kill").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var instanceId = btn.getAttribute("data-instance");
              btn.disabled = true;
              btn.textContent = "Killing...";
              apiPost("sessions/" + instanceId + "/terminate")
                .then(function () { router.renderDevConsole(); })
                .catch(function (err) { btn.textContent = "Error: " + err.message; });
            });
          });

          // Load and render recent traces
          function loadRecentTraces(since, until) {
            var container = document.getElementById("recent-traces");
            if (!container) return;
            container.innerHTML = "<p>Loading...</p>";
            var url = "traces?limit=20";
            if (since) url += "&since=" + encodeURIComponent(since);
            if (until) url += "&until=" + encodeURIComponent(until);
            apiCall(url)
              .then(function (data) {
                var recent = (data.recent) || [];
                if (recent.length === 0) {
                  container.innerHTML = "<p>No traces yet — send a message to the bot to generate one.</p>";
                  return;
                }
                var rows = recent.map(function (t) {
                  return "<tr><td><a class=\"trace-link\" data-corr=\"" + esc(t.correlationId) + "\" href=\"#\">" +
                    esc(t.correlationId) + "</a></td>" +
                    "<td>" + new Date(t.turnStartedAt).toLocaleString() + "</td>" +
                    "<td>" + t.totalMs + "ms</td>" +
                    "<td>" + t.phaseCount + "</td></tr>";
                }).join("");
                container.innerHTML = "<table><tr><th>Correlation ID</th><th>Started</th><th>Total</th><th>Phases</th></tr>" +
                  rows + "</table>";
                // Wire trace row click — fills search box and triggers search
                container.querySelectorAll(".trace-link").forEach(function (a) {
                  a.addEventListener("click", function (e) {
                    e.preventDefault();
                    var corrId = a.getAttribute("data-corr");
                    var inp = document.getElementById("corr-input");
                    if (inp) { inp.value = corrId; }
                    var btn = document.getElementById("corr-search-btn");
                    if (btn) btn.click();
                  });
                });
              })
              .catch(function (err) {
                container.innerHTML = "<p class=\"error-msg\">" + esc(err.message) + "</p>";
              });
          }
          loadRecentTraces();

          // Wire time-range filter
          var filterBtn = document.getElementById("trace-filter-btn");
          if (filterBtn) {
            filterBtn.addEventListener("click", function () {
              var sinceEl = document.getElementById("trace-since");
              var untilEl = document.getElementById("trace-until");
              var since = sinceEl && sinceEl.value ? new Date(sinceEl.value).toISOString() : undefined;
              var until = untilEl && untilEl.value ? new Date(untilEl.value).toISOString() : undefined;
              loadRecentTraces(since, until);
            });
          }
          var clearBtn = document.getElementById("trace-clear-btn");
          if (clearBtn) {
            clearBtn.addEventListener("click", function () {
              var sinceEl = document.getElementById("trace-since");
              var untilEl = document.getElementById("trace-until");
              if (sinceEl) sinceEl.value = "";
              if (untilEl) untilEl.value = "";
              loadRecentTraces();
            });
          }

          // Wire correlation search
          var searchBtn = document.getElementById("corr-search-btn");
          if (searchBtn) {
            searchBtn.addEventListener("click", function () {
              var input = document.getElementById("corr-input");
              var tag = input ? input.value.trim() : "";
              if (!tag) return;
              var results = document.getElementById("corr-results");
              if (results) results.innerHTML = "<p>Searching...</p>";
              apiCall("traces?corr=" + encodeURIComponent(tag))
                .then(function (data) {
                  var html = "";

                  // Render trace tree if available
                  if (data.traceTree && data.traceTree.phases && data.traceTree.phases.length > 0) {
                    html += '<div class="trace-tree">' +
                      '<h3>Trace Tree — ' + esc(data.correlationTag) + '</h3>' +
                      '<div class="trace-summary">' +
                      '<span class="trace-total">Total: ' + data.traceTree.totalMs + 'ms</span> · ' +
                      '<span class="trace-started">' + new Date(data.traceTree.turnStartedAt).toLocaleString() + '</span></div>' +
                      renderTracePhases(data.traceTree.phases, 0) +
                      '</div>';
                  }

                  // Render relay messages
                  if (data.messages && data.messages.length > 0) {
                    var rows = data.messages.map(function (m) {
                      return (
                        "<tr><td>" + esc(m.direction) + "</td>" +
                        "<td>" + esc(m.messageType) + "</td>" +
                        "<td>" + (m.createdAt ? new Date(m.createdAt).toLocaleString() : "—") + "</td>" +
                        "<td><pre>" + esc((m.payload || "").substring(0, 200)) + "</pre></td></tr>"
                      );
                    }).join("");
                    html += "<h3>Relay Messages (" + data.count + ")</h3>" +
                      "<table><tr><th>Direction</th><th>Type</th><th>Time</th><th>Payload</th></tr>" +
                      rows + "</table>";
                  }

                  if (!html) {
                    html = "<p>No trace data found for: " + esc(tag) + "</p>";
                  }
                  results.innerHTML = html;

                  // Wire collapsible tree nodes
                  results.querySelectorAll(".trace-toggle").forEach(function (btn) {
                    btn.addEventListener("click", function () {
                      var children = btn.parentElement.querySelector(".trace-children");
                      if (children) {
                        var hidden = children.style.display === "none";
                        children.style.display = hidden ? "block" : "none";
                        btn.textContent = hidden ? "▼" : "▶";
                      }
                    });
                  });
                })
                .catch(function (err) {
                  results.innerHTML = '<p class="error-msg">' + esc(err.message) + "</p>";
                });
            });
          }
        })
        .catch(function (err) {
          if (String(err.message).startsWith("cold-start:")) {
            var retry = parseInt(err.message.split(":")[1], 10) || 5;
            showColdStart(panelId, retry);
            setTimeout(function () { router.renderDevConsole(); }, retry * 1000);
          } else {
            showError(panelId, err.message);
          }
        });
    },

    renderSkillsLibrary: function () {
      var panelId = "panel-skills-library";
      apiCall("skills")
        .then(function (data) {
          var skills = (data.skills || []);
          var cards = skills.map(function (s) {
            var badge = s.installed
              ? '<span class="badge badge-ok">Installed</span>'
              : '<span class="badge">Available</span>';
            var linkBadge = s.linkRequired
              ? ' <span class="badge badge-warn">OAuth</span>'
              : '';
            var tools = (s.toolNames || []).map(function (t) {
              return '<code>' + esc(t) + '</code>';
            }).join(', ');
            return '<div class="card skill-card">' +
              '<div class="skill-card-header">' +
              '<img src="' + esc(s.iconUrl) + '" alt="" class="skill-icon" width="32" height="32" />' +
              '<div><h3>' + esc(s.displayName) + '</h3>' +
              badge + linkBadge + '</div></div>' +
              '<p>' + esc(s.shortDescription) + '</p>' +
              '<p class="muted">' + s.toolCount + ' tool' + (s.toolCount !== 1 ? 's' : '') + ': ' + tools + '</p>' +
              '</div>';
          }).join("");
          document.getElementById(panelId).innerHTML =
            "<h1>Skills Library</h1>" +
            '<div class="card"><h2>Installed Skills (' + skills.filter(function (s) { return s.installed; }).length + ')</h2>' +
            '<p>' + esc(data.totalTools) + ' tools total across all skills.</p></div>' +
            '<div class="skills-grid">' + (cards || '<p>No skills loaded.</p>') + '</div>' +
            '<div class="card"><h2>SkillForge</h2>' +
            '<p>Custom skills forged by SkillForge will appear here as "Available" once the forge pipeline is active.</p></div>';
        })
        .catch(function (err) {
          if (String(err.message).startsWith("cold-start:")) {
            var retry = parseInt(err.message.split(":")[1], 10) || 5;
            showColdStart(panelId, retry);
            setTimeout(function () { router.renderSkillsLibrary(); }, retry * 1000);
          } else {
            showError(panelId, err.message);
          }
        });
    },
  };

  // Expose for nav button onclick
  window.router = router;

  // --- Init ---
  window.addEventListener("DOMContentLoaded", function () {
    microsoftTeams.app
      .initialize()
      .then(function () {
        return microsoftTeams.app.getContext();
      })
      .then(function (context) {
        // Store user OID for API auth (context.user.id is AAD Object ID in TeamsJS v2)
        if (!(context && context.user && context.user.id)) {
          throw new Error("Teams user context unavailable.");
        }
        _userOid = context.user.id;

        if (context && context.app && context.app.theme) {
          applyTheme(context.app.theme);
        }
        microsoftTeams.app.registerOnThemeChangeHandler(applyTheme);

        // Hide SPA nav when embedded in Teams — Teams provides its own tab switching
        if (context && context.page && context.page.frameContext) {
          var nav = document.getElementById("nav");
          if (nav) nav.style.display = "none";
        }

        return getAadToken().then(function (token) {
          if (!token) {
            throw new Error("Teams SSO token unavailable.");
          }

          window.addEventListener("hashchange", function () {
            router.render();
          });

          // Set initial route
          var hash = window.location.hash.replace("#", "") || "get-started";
          window.location.hash = hash;
          // Remove loading panel
          var loading = document.getElementById("loading");
          if (loading) loading.remove();
          router.render();
        });
      })
      .catch(function (err) {
        showAuthRequired(err && err.message ? err.message : "Teams authentication is required.");
      });
  });
})();
