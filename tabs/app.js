// HelkinSwarm Tab SPA — app.js
// Hash-based router for Get Started, Control Center, Dev Console panels.
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

  // Cached AAD token from Teams SDK
  var _cachedToken = null;

  function getAadToken() {
    if (_cachedToken) return Promise.resolve(_cachedToken);
    return microsoftTeams.authentication.getAuthToken().then(function (token) {
      _cachedToken = token;
      return token;
    });
  }

  function apiCall(endpoint) {
    return getAadToken().then(function (token) {
      return fetch(TAB_API_BASE + "/" + endpoint, {
        headers: {
          "x-helkinswarm-user-id": token,
          "Authorization": "Bearer " + token,
        },
      });
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
            esc((data.capabilities.activeSkills || []).length) + " skills</p></div>";
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
      apiCall("sessions")
        .then(function (data) {
          var rows = (data.sessions || [])
            .slice(0, 20)
            .map(function (s) {
              var badge = s.isRunning ? "ok" : "warn";
              return (
                "<tr><td>" + esc(s.instanceId) + "</td>" +
                "<td>" + esc(s.name) + "</td>" +
                '<td><span class="badge badge-' + badge + '">' + esc(s.runtimeStatus) + "</span></td>" +
                "<td>" + (s.createdAt ? new Date(s.createdAt).toLocaleString() : "—") + "</td></tr>"
              );
            })
            .join("");

          document.getElementById(panelId).innerHTML =
            "<h1>Dev Console</h1>" +
            '<div class="card"><h2>Orchestration Sessions (' +
            esc(data.active) + " active / " + esc(data.total) + " total)</h2>" +
            "<table><tr><th>Instance</th><th>Name</th><th>Status</th><th>Created</th></tr>" +
            rows + "</table></div>";
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
        if (context && context.app && context.app.theme) {
          applyTheme(context.app.theme);
        }
        microsoftTeams.app.registerOnThemeChangeHandler(applyTheme);

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
      })
      .catch(function (err) {
        // Outside Teams — still render for standalone testing
        console.warn("Teams SDK init failed (may be outside Teams):", err);
        window.addEventListener("hashchange", function () {
          router.render();
        });
        var hash = window.location.hash.replace("#", "") || "get-started";
        window.location.hash = hash;
        var loading = document.getElementById("loading");
        if (loading) loading.remove();
        router.render();
      });
  });
})();
