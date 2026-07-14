let apiKey = localStorage.getItem("mkt-api-key") || "";

const API = {
  async req(path, opts = {}) {
    opts.headers = { ...opts.headers, "x-api-key": apiKey, "Content-Type": "application/json" };
    const res = await fetch("/api/admin" + path, opts);
    if (res.status === 401) throw new Error("Unauthorized");
    return res.json();
  },
  getSearches: () => API.req("/searches"),
  addSearch: (data) => API.req("/searches", { method: "POST", body: JSON.stringify(data) }),
  deleteSearch: (id) => API.req(`/searches/${id}`, { method: "DELETE" }),
  getProxies: () => API.req("/proxies"),
  saveProxies: (proxies) => API.req("/proxies", { method: "POST", body: JSON.stringify({ proxies }) }),
  getCookies: () => API.req("/cookies"),
  uploadCookie: (filename, content) => API.req("/cookies", { method: "POST", body: JSON.stringify({ filename, content }) }),
  deleteCookie: (filename) => API.req(`/cookies/${filename}`, { method: "DELETE" }),
  
  getAccounts: () => API.req("/accounts"),
  updateAccountStatus: (id, status) => API.req("/accounts/status", { method: "POST", body: JSON.stringify({ id, status }) }),
  assignAccount: (id, searchId) => API.req("/accounts/assign", { method: "POST", body: JSON.stringify({ id, searchId }) }),
  assignFallback: (id, fallbackId) => API.req("/accounts/fallback", { method: "POST", body: JSON.stringify({ id, fallbackId }) }),
  assignProxy: (id, proxy) => API.req("/accounts/proxy", { method: "POST", body: JSON.stringify({ id, proxy }) }),
  getMetrics: () => API.req("/metrics"),
  getLogs: () => API.req("/logs"),
  
  getListings: async () => {
    const res = await fetch("/api/listings/new?sinceSeconds=86400", { headers: { "x-api-key": apiKey } });
    if (res.status === 401) throw new Error("Unauthorized");
    return res.json();
  },
  
  // Notification APIs
  getNotificationStatus: () => API.req("/notifications/status"),
  getNotificationHistory: () => API.req("/notifications/history"),
  testNotification: (channel) => API.req("/notifications/test", { method: "POST", body: JSON.stringify({ channel }) }),
};

// --- TOAST & NAVIGATION UTILITIES ---
let toastIdCounter = 0;
let unreadNotifCount = 0;

function switchTab(tabId) {
  const btn = document.querySelector(`.nav-btn[data-tab="${tabId}"]`);
  if (btn) { btn.click(); return; }
  // If no sidebar button (like Notifications tab), switch directly
  document.querySelectorAll(".nav-btn").forEach(function(b) { b.classList.remove("active"); });
  document.querySelectorAll(".tab-pane").forEach(function(p) { p.classList.add("hidden"); });
  var pane = document.getElementById(tabId);
  if (pane) pane.classList.remove("hidden");
  // Load notification data
  if (tabId === "tab-notifications") {
    unreadNotifCount = 0;
    updateNotifBadge(0);
    loadNotificationStatus();
    loadNotificationHistory();
  }
}

function updateNotifBadge(count) {
  const badge = document.getElementById("notif-badge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

function showToast({ type = "info", title, message, duration = 5000, onClick } = {}) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const id = ++toastIdCounter;
  const icons = { success: "✓", error: "✗", warning: "!", info: "i" };

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.id = `toast-${id}`;
  toast.style.cursor = onClick ? "pointer" : "default";

  const msgHtml = message ? `<div class="toast-message">${message}</div>` : "";
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "i"}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      ${msgHtml}
    </div>
    <button class="toast-close" onclick="event.stopPropagation(); dismissToast(${id})">&times;</button>
  `;

  if (onClick) {
    toast.addEventListener("click", (e) => {
      if (e.target.closest(".toast-close")) return;
      dismissToast(id);
      onClick();
    });
  }

  container.appendChild(toast);
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}

window.dismissToast = function(id) {
  const toast = document.getElementById(`toast-${id}`);
  if (!toast) return;
  toast.classList.add("toast-hiding");
  setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
};

// --- NOTIFICATION TAB ---
let notifHistoryCache = [];

async function loadNotificationStatus() {
  try {
    const status = await API.getNotificationStatus();
    const fcmBadge = document.getElementById("fcm-status-badge");
    const fcmService = document.getElementById("fcm-service-account");
    const fcmTopic = document.getElementById("fcm-topic");
    if (fcmBadge) {
      if (status.fcmConfigured) { fcmBadge.textContent = "Active"; fcmBadge.className = "notification-card-status active"; }
      else { fcmBadge.textContent = "Not Configured"; fcmBadge.className = "notification-card-status warning"; }
    }
    if (fcmService) fcmService.textContent = status.fcmServiceAccount || "Not set";
    if (fcmTopic) fcmTopic.textContent = status.fcmTopic || "-";

    const tgBadge = document.getElementById("telegram-status-badge");
    const tgToken = document.getElementById("telegram-token");
    const tgChatId = document.getElementById("telegram-chat-id");
    if (tgBadge) {
      if (status.telegramConfigured) { tgBadge.textContent = "Active"; tgBadge.className = "notification-card-status active"; }
      else { tgBadge.textContent = "Not Configured"; tgBadge.className = "notification-card-status warning"; }
    }
    if (tgToken) tgToken.textContent = status.telegramBotToken ? status.telegramBotToken.slice(0, 20) + "..." : "Not set";
    if (tgChatId) tgChatId.textContent = status.telegramChatId || "-";
  } catch (err) {
    console.error("Failed to load notification status:", err);
  }
}

var notifCurrentPage = 1;
var notifPageSize = 10;

function renderNotifTable(events) {
  var tbody = document.getElementById('notification-history-tbody');
  var emptyEl = document.getElementById('notification-history-empty');
  var table = document.querySelector('.notif-table');
  var pagination = document.getElementById('notif-pagination');
  if (!tbody) return;
  
  if (events.length === 0) {
    if (table) table.style.display = 'none';
    if (pagination) pagination.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  
  if (table) table.style.display = '';
  if (emptyEl) emptyEl.style.display = 'none';
  
  var totalPages = Math.ceil(events.length / notifPageSize);
  if (notifCurrentPage > totalPages) notifCurrentPage = totalPages;
  if (notifCurrentPage < 1) notifCurrentPage = 1;
  
  var startIdx = (notifCurrentPage - 1) * notifPageSize;
  var pageEvents = events.slice(startIdx, startIdx + notifPageSize);
  
  // Map status to icon, class, and color
  function getStatusInfo(status) {
    if (status === 'sent') return { icon: '\u2705', cls: 'success', color: '#4ade80' };
    if (status === 'error' || status === 'failed') return { icon: '\u274C', cls: 'error', color: '#f87171' };
    if (status === 'warning') return { icon: '\u26A0\uFE0F', cls: 'warning', color: '#facc15' };
    return { icon: '\u2139\uFE0F', cls: 'info', color: '#60a5fa' };
  }
  
  // Escape HTML to prevent XSS
  function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  
  tbody.innerHTML = pageEvents.map(function(e, idx) {
    var globalIdx = startIdx + idx;
    var si = getStatusInfo(e.status);
    var time = e.timestamp ? new Date(e.timestamp).toLocaleString() : '-';
    var title = esc(e.title || e.message || 'Notification');
    var channel = esc(e.channel || '-');
    var platform = esc(e.platform || '-');
    
    return '<tr class="notif-table-row" data-notif-index="' + globalIdx + '" style="cursor:pointer;">' +
      '<td style="text-align:center;"><span style="font-size:1.2rem;" title="' + esc(e.status) + '">' + si.icon + '</span></td>' +
      '<td style="max-width:300px;"><div class="n-title" style="font-size:0.85rem;font-weight:500;color:var(--text-primary);white-space:normal;word-break:break-word;line-height:1.4;">' + title + '</div></td>' +
      '<td><span class="notif-channel-badge" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:0.72rem;font-weight:600;">' + channel + '</span></td>' +
      '<td>' + (platform !== '-' ? '<span class="platform-badge platform-' + platform.toLowerCase() + '" style="font-size:0.65rem;">' + platform + '</span>' : '<span style="color:var(--text-muted);font-size:0.78rem;">-</span>') + '</td>' +
      '<td style="color:var(--text-muted);font-size:0.78rem;white-space:nowrap;">' + time + '</td>' +
    '</tr>';
  }).join('');
  
  // Add click handlers
  tbody.querySelectorAll('.notif-table-row').forEach(function(row) {
    row.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-notif-index'));
      if (!isNaN(idx) && events[idx]) {
        openNotifDetails(events[idx]);
      }
    });
  });
  
  // Render pagination
  renderNotifPagination(totalPages, events.length);
}

function renderNotifPagination(totalPages, totalItems) {
  var pag = document.getElementById('notif-pagination');
  if (!pag) return;
  if (totalPages <= 1) {
    pag.innerHTML = '<div class="pagination-info">' + totalItems + ' notification' + (totalItems !== 1 ? 's' : '') + '</div>';
    return;
  }
  
  var html = '<div class="pagination-inner">';
  html += '<button class="page-btn" onclick="goNotifPage(' + (notifCurrentPage - 1) + ')" ' + (notifCurrentPage <= 1 ? 'disabled' : '') + '>&#9664; Prev</button>';
  
  // Calculate visible page range
  var startPage = Math.max(1, notifCurrentPage - 2);
  var endPage = Math.min(totalPages, notifCurrentPage + 2);
  if (endPage - startPage < 4) {
    if (startPage === 1) endPage = Math.min(totalPages, startPage + 4);
    else startPage = Math.max(1, endPage - 4);
  }
  
  if (startPage > 1) {
    html += '<button class="page-btn" onclick="goNotifPage(1)">1</button>';
    if (startPage > 2) html += '<span class="page-ellipsis">...</span>';
  }
  
  for (var p = startPage; p <= endPage; p++) {
    html += '<button class="page-btn' + (p === notifCurrentPage ? ' active' : '') + '" onclick="goNotifPage(' + p + ')">' + p + '</button>';
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="page-ellipsis">...</span>';
    html += '<button class="page-btn" onclick="goNotifPage(' + totalPages + ')">' + totalPages + '</button>';
  }
  
  html += '<button class="page-btn" onclick="goNotifPage(' + (notifCurrentPage + 1) + ')" ' + (notifCurrentPage >= totalPages ? 'disabled' : '') + '>Next &#9654;</button>';
  html += '<span class="pagination-info">' + totalItems + ' notification' + (totalItems !== 1 ? 's' : '') + '</span>';
  html += '</div>';
  
  pag.innerHTML = html;
}

window.goNotifPage = function(page) {
  notifCurrentPage = page;
  renderNotifTable(notifHistoryCache);
};

async function loadNotificationHistory() {
  try {
    const data = await API.getNotificationHistory();
    const events = data.events || [];
    
    // Check for new events and update badge
    if (notifHistoryCache.length > 0 && events.length > notifHistoryCache.length) {
      const newEvents = events.length - notifHistoryCache.length;
      const notifTabHidden = document.getElementById("tab-notifications")?.classList.contains("hidden");
      if (notifTabHidden) {
        unreadNotifCount += newEvents;
        updateNotifBadge(unreadNotifCount);
      }
      // Reset to first page when new events arrive
      notifCurrentPage = 1;
    }
    // Detect new events and show desktop notification
    if (notifHistoryCache.length > 0 && events.length > notifHistoryCache.length) {
      var latestEvent = events[0];
      if (latestEvent) {
        var notifTitle = latestEvent.title || 'New Notification';
        var notifBody = latestEvent.message || '';
        var statusIcon = latestEvent.status === 'sent' ? '\u2705' : latestEvent.status === 'error' ? '\u274C' : '\u2139\uFE0F';
        var platform = latestEvent.platform ? (' [' + latestEvent.platform + ']') : '';
        showDesktopNotification(
          statusIcon + ' ' + notifTitle.substring(0, 80),
          notifBody ? notifBody.substring(0, 120) : ('Channel: ' + (latestEvent.channel || '-') + platform),
          { tag: 'mkt-notif' }
        );
      }
    }
    
    notifHistoryCache = events;
    
    renderNotifTable(events);
  } catch (err) {
    console.error("Failed to load notification history:", err);
  }
}

// --- NOTIFICATION DETAILS MODAL ---
function openNotifDetails(event) {
  var title = event.title || event.message || 'Notification';
  var message = event.message || '';
  var channel = event.channel || '-';
  var status = event.status || 'info';
  var platform = event.platform || '-';
  var timestamp = event.timestamp ? new Date(event.timestamp).toLocaleString() : '-';
  
  var iconMap = { sent: '\u2705', error: '\u274C', info: '\u2139\uFE0F', warning: '\u26A0\uFE0F' };
  var iconBgMap = { sent: 'var(--success-soft)', error: 'rgba(248, 113, 113, 0.12)', info: 'var(--info-soft)', warning: 'var(--warning-soft)' };
  var statusBgMap = { sent: 'var(--success-soft)', error: 'rgba(248, 113, 113, 0.12)', info: 'var(--info-soft)', warning: 'var(--warning-soft)' };
  var statusColorMap = { sent: 'var(--success)', error: 'var(--danger)', info: 'var(--info)', warning: 'var(--warning)' };
  
  var icon = document.getElementById('notif-detail-icon');
  var titleEl = document.getElementById('notif-detail-title');
  var channelEl = document.getElementById('notif-detail-channel');
  var statusEl = document.getElementById('notif-detail-status');
  var timestampEl = document.getElementById('notif-detail-timestamp');
  var messageContainer = document.getElementById('notif-detail-msg-container');
  var messageEl = document.getElementById('notif-detail-message');
  var fieldsEl = document.getElementById('notif-detail-fields');
  var modal = document.getElementById('modal-notif-details');
  
  if (!modal) return;
  
  // Icon
  if (icon) {
    icon.textContent = iconMap[status] || '\u2139\uFE0F';
    icon.style.background = iconBgMap[status] || 'var(--info-soft)';
  }
  
  // Title
  if (titleEl) titleEl.textContent = title;
  
  // Channel badge
  if (channelEl) {
    channelEl.textContent = channel;
    channelEl.className = 'platform-badge';
    if (channel === 'fcm') channelEl.style.cssText = 'margin:0;font-size:0.7rem;background:rgba(255,204,0,0.1);color:#ffcc00;border-color:rgba(255,204,0,0.2);';
    else if (channel === 'telegram') channelEl.style.cssText = 'margin:0;font-size:0.7rem;background:rgba(0,136,204,0.1);color:#0088cc;border-color:rgba(0,136,204,0.2);';
    else if (channel === 'all') channelEl.style.cssText = 'margin:0;font-size:0.7rem;background:rgba(99,102,241,0.1);color:#a5b4fc;border-color:rgba(99,102,241,0.2);';
    else channelEl.style.cssText = 'margin:0;font-size:0.7rem;background:rgba(255,255,255,0.05);color:var(--text-secondary);border-color:rgba(255,255,255,0.1);';
  }
  
  // Status badge
  if (statusEl) {
    statusEl.textContent = status.toUpperCase();
    statusEl.style.background = statusBgMap[status] || 'var(--info-soft)';
    statusEl.style.color = statusColorMap[status] || 'var(--info)';
    statusEl.className = 'notification-card-status';
  }
  
  // Timestamp
  if (timestampEl) timestampEl.textContent = '\u{1F550} ' + timestamp;
  
  // Full message
  if (message && message !== title) {
    if (messageContainer) messageContainer.style.display = 'block';
    if (messageEl) messageEl.textContent = message;
  } else {
    if (messageContainer) messageContainer.style.display = 'none';
  }
  
  // Detail fields
  if (fieldsEl) {
    var fields = [];
    if (platform && platform !== '-') {
      fields.push({ label: 'Platform', value: platform, icon: '\u{1F4F1}' });
    }
    fields.push({ label: 'Channel', value: channel, icon: '\u{1F4E1}' });
    fields.push({ label: 'Status', value: status.toUpperCase(), icon: status === 'sent' ? '\u2705' : '\u274C' });
    if (event.timestamp) {
      var d = new Date(event.timestamp);
      var dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      fields.push({ label: 'Timestamp', value: dateStr, icon: '\u{1F550}' });
    }
    
    fieldsEl.innerHTML = fields.map(function(f) {
      return '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;">' +
        '<span style="font-size:1.2rem;">' + f.icon + '</span>' +
        '<div style="display:flex;flex-direction:column;">' +
          '<span style="font-size:0.68rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.3px;">' + f.label + '</span>' +
          '<span style="font-size:0.85rem;font-weight:600;color:white;margin-top:2px;">' + f.value + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }
  
  modal.classList.remove('hidden');
}

// Close notification detail modal
function setupNotifDetailClose() {
  var modal = document.getElementById('modal-notif-details');
  if (!modal) return;
  var closeBtn = document.getElementById('close-notif-detail-btn');
  var closeBtn2 = document.getElementById('close-notif-detail-close-btn');
  var closeHandler = function() { modal.classList.add('hidden'); };
  if (closeBtn) closeBtn.addEventListener('click', closeHandler);
  if (closeBtn2) closeBtn2.addEventListener('click', closeHandler);
}

// Call setup after DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupNotifDetailClose);
} else {
  setupNotifDetailClose();
}

async function testAllNotifications() {
  const btn = document.getElementById("test-all-notifications-btn");
  if (!btn) return;
  btn.disabled = true;
  btn.innerHTML = '<span class="loading-spinner"></span> <span>Sending...</span>';
  try {
    const result = await API.testNotification("all");
    if (result.success) {
      const details = result.details || {};
      let msg = "";
      if (details.fcm) msg += "FCM: " + (details.fcm.ok ? "\u2705" : "\u274C") + " ";
      if (details.telegram) msg += "Telegram: " + (details.telegram.ok ? "\u2705" : "\u274C");
      showToast({ type: "success", title: "Test notifications sent!", message: msg || "Check your channels.", duration: 6000 });
    } else {
      showToast({ type: "error", title: "Test failed", message: result.error || "Check notification configuration.", duration: 6000 });
    }
    await loadNotificationStatus();
    await loadNotificationHistory();
  } catch (err) {
    showToast({ type: "error", title: "Test failed", message: err.message, duration: 5000 });
  }
  btn.disabled = false;
  btn.innerHTML = '<span>\u{1F4E1}</span> <span>Test All Channels</span>';
}

// --- DOM Elements ---
const el = {
  loginOverlay: document.getElementById("login-overlay"),
  dashboard: document.getElementById("dashboard"),
  apiKeyInput: document.getElementById("api-key"),
  loginBtn: document.getElementById("login-btn"),
  logoutBtn: document.getElementById("logout-btn"),
  navBtns: document.querySelectorAll(".nav-btn"),
  tabPanes: document.querySelectorAll(".tab-pane"),
  searchesTbody: document.getElementById("searches-tbody"),
  addSearchBtn: document.getElementById("add-search-btn"),
  modalAddSearch: document.getElementById("modal-add-search"),
  saveSearchBtn: document.getElementById("save-search-btn"),
  cancelSearchBtn: document.getElementById("cancel-search-btn"),
  newPlatform: document.getElementById("new-platform"),
  fbAccountGroup: document.getElementById("fb-account-group"),
  newFbAccount: document.getElementById("new-fb-account"),
  accountsTbody: document.getElementById("accounts-tbody"),
  metricsTbody: document.getElementById("metrics-tbody"),
  latencyTbody: document.getElementById("latency-tbody"),
  logsContainer: document.getElementById("logs-container"),
  avgLatency: document.getElementById("avg-latency"),
  globalSuccessRate: document.getElementById("global-success-rate"),
  addProxyModalBtn: document.getElementById("add-proxy-modal-btn"),
  modalAddProxy: document.getElementById("modal-add-proxy"),
  cancelProxyBtn: document.getElementById("cancel-proxy-btn"),
  proxyManualView: document.getElementById("proxy-manual-view"),
  proxyBulkInput: document.getElementById("proxy-bulk-input"),
  proxyCountry: document.getElementById("proxy-country"),
  addProxyBtn: document.getElementById("add-proxy-btn"),
  proxiesTbody: document.getElementById("proxies-tbody"),
  cookiesList: document.getElementById("cookies-list"),
  cookieFile: document.getElementById("cookie-file"),
  cookieDropzone: document.getElementById("cookie-dropzone"),
  listingsGrid: document.getElementById("listings-grid"),
  refreshListingsBtn: document.getElementById("refresh-listings-btn"),
  filterListingsKeyword: document.getElementById("filter-listings-keyword"),
  filterListingsLocation: document.getElementById("filter-listings-location"),
  filterListingsPlatform: document.getElementById("filter-listings-platform"),
  filterListingsPrice: document.getElementById("filter-listings-price"),
  filterPriceDisplay: document.getElementById("filter-price-display"),
  filterListingsBrand: document.getElementById("filter-listings-brand"),
  sortListings: document.getElementById("sort-listings"),
  modalDetails: document.getElementById("modal-details"),
  closeDetailsBtn: document.getElementById("close-details-btn"),
  closeDetailsXBtn: document.getElementById("close-details-x-btn"),
  detailsTitle: document.getElementById("details-title"),
  detailsPlatformBadge: document.getElementById("details-platform-badge"),
  detailsImageCarousel: document.getElementById("details-image-carousel"),
  detailsPrice: document.getElementById("details-price"),
  detailsLocation: document.getElementById("details-location"),
  detailsSpecsGrid: document.getElementById("details-specs-grid"),
  detailsDescContainer: document.getElementById("details-desc-container"),
  detailsDescription: document.getElementById("details-description"),
  detailsListed: document.getElementById("details-listed"),
  detailsSeen: document.getElementById("details-seen"),
  detailsLink: document.getElementById("details-link"),
  testAllNotificationsBtn: document.getElementById("test-all-notifications-btn"),
};

// --- Authentication ---
async function checkAuth() {
  if (!apiKey) return showLogin();
  try {
    await loadSearches();
    showDashboard();
    await loadCountriesDropdown();
    loadProxies();
    loadCookies();
    loadListings();
    loadAccounts();
    loadMetrics();
  } catch (err) {
    if (err.message === "Unauthorized") {
      alert("Invalid API Key! Please check your .env file and try again.");
      apiKey = "";
      localStorage.removeItem("mkt-api-key");
      showLogin();
    } else {
      console.error(err);
      alert("Error connecting to server. Please check the console.");
    }
  }
}

function showLogin() {
  el.loginOverlay.classList.remove("hidden");
  setTimeout(() => el.loginOverlay.classList.add("active"), 10);
  el.dashboard.classList.add("hidden");
}

function showDashboard() {
  el.loginOverlay.classList.remove("active");
  setTimeout(() => el.loginOverlay.classList.add("hidden"), 500);
  el.dashboard.classList.remove("hidden");
}

el.loginBtn.onclick = () => {
  apiKey = el.apiKeyInput.value.trim();
  localStorage.setItem("mkt-api-key", apiKey);
  checkAuth();
};

el.logoutBtn.onclick = () => {
  apiKey = "";
  localStorage.removeItem("mkt-api-key");
  showLogin();
};

// --- Tabs ---
el.navBtns.forEach(btn => {
  btn.onclick = () => {
    el.navBtns.forEach(b => b.classList.remove("active"));
    el.tabPanes.forEach(p => p.classList.add("hidden"));
    btn.classList.add("active");
    const tabId = btn.dataset.tab;
    document.getElementById(tabId).classList.remove("hidden");

    if (tabId === "tab-listings") {
      unreadListingsCount = 0;
      const badge = document.getElementById("dashboard-badge");
      if (badge) badge.style.display = "none";
      loadListings();
    } else if (tabId === "tab-notifications") {
      unreadNotifCount = 0;
      updateNotifBadge(0);
      loadNotificationStatus();
      loadNotificationHistory();
    } else if (tabId === "tab-accounts") loadAccounts();
    else if (tabId === "tab-metrics") loadMetrics();
    else if (tabId === "tab-searches") loadSearches();
    else if (tabId === "tab-cookies") loadCookies();
    else if (tabId === "tab-proxies") loadProxies();
  };
});

// --- Searches ---
async function loadSearches() {
  const searches = await API.getSearches();
  el.searchesTbody.innerHTML = searches.map(s => `
    <tr>
      <td><span class="platform-badge platform-${s.platform}">${s.platform}</span></td>
      <td><strong>${s.keyword}</strong></td>
      <td><div style="display: flex; align-items: center; gap: 8px;">${getFlagImgHtml(s.location)}<span>${s.location || '-'}</span></div></td>
      <td>${s.minPrice != null ? '$' + s.minPrice : '-'}</td>
      <td>${s.maxPrice != null ? '$' + s.maxPrice : '-'}</td>
      <td><button class="danger-btn" onclick="deleteSearch(${s.id})">Delete</button></td>
    </tr>
  `).join("");
}

window.deleteSearch = async (id) => {
  if (!confirm("Delete this search monitor?")) return;
  await API.deleteSearch(id);
  loadSearches();
};

async function populateFbAccountsDropdown() {
  try {
    const accounts = await API.getAccounts();
    const activeAccounts = accounts.filter(a => a.status !== 'dead');
    el.newFbAccount.innerHTML = ['<option value="">-- Round-robin / Unassigned --</option>',
      ...activeAccounts.map(a => `<option value="${a.id}">${a.id} (${a.status.toUpperCase()})</option>`)
    ].join("");
  } catch (err) {
    console.error("Failed to populate FB accounts dropdown:", err);
  }
}

el.newPlatform.onchange = () => {
  el.fbAccountGroup.style.display = el.newPlatform.value === "facebook" ? "block" : "none";
  if (el.newPlatform.value === "facebook") populateFbAccountsDropdown();
};

el.addSearchBtn.onclick = () => {
  el.newPlatform.value = "ebay";
  el.fbAccountGroup.style.display = "none";
  el.newFbAccount.innerHTML = '<option value="">-- Round-robin / Unassigned --</option>';
  document.getElementById("new-keyword").value = "";
  document.getElementById("new-location").value = "";
  document.getElementById("new-min").value = "";
  document.getElementById("new-max").value = "";
  el.modalAddSearch.classList.remove("hidden");
};
el.cancelSearchBtn.onclick = () => el.modalAddSearch.classList.add("hidden");

el.saveSearchBtn.onclick = async () => {
  const data = {
    platform: el.newPlatform.value,
    keyword: document.getElementById("new-keyword").value.trim(),
    location: document.getElementById("new-location").value.trim() || null,
    minPrice: parseFloat(document.getElementById("new-min").value) || null,
    maxPrice: parseFloat(document.getElementById("new-max").value) || null,
  };
  if (!data.keyword) return alert("Keyword is required!");
  if (data.platform === "facebook") data.fbAccountId = el.newFbAccount.value || null;
  el.saveSearchBtn.textContent = "Saving...";
  await API.addSearch(data);
  el.saveSearchBtn.textContent = "Add Search";
  el.modalAddSearch.classList.add("hidden");
  document.getElementById("new-keyword").value = "";
  document.getElementById("new-location").value = "";
  document.getElementById("new-min").value = "";
  document.getElementById("new-max").value = "";
  loadSearches();
};

const seenListingsInSession = new Set();
let unreadListingsCount = 0;
let allListings = [];

async function loadListings() {
  try {
    const fetched = await API.getListings();
    if (seenListingsInSession.size === 0) {
      fetched.forEach(l => seenListingsInSession.add(String(l.id)));
    } else {
      const unread = fetched.filter(l => !seenListingsInSession.has(String(l.id)));
      if (unread.length > 0) {
        unread.forEach(l => seenListingsInSession.add(String(l.id)));
        const tabListingsHidden = document.getElementById("tab-listings")?.classList.contains("hidden");
        if (tabListingsHidden) {
          unreadListingsCount += unread.length;
          const badge = document.getElementById("dashboard-badge");
          if (badge) { badge.textContent = unreadListingsCount; badge.style.display = "inline-block"; }

          // Show desktop notification for new listings
          if (unread.length === 1) {
            var item = unread[0];
            showDesktopNotification(
              item.platform + ': New Listing Found',
              '$' + (item.price != null ? item.price : '?') + ' - ' + ((item.title || '').substring(0, 60))
            );
          } else if (unread.length > 1) {
            showDesktopNotification(
              '\u{1F3AF} ' + unread.length + ' New Listings',
              'Across ' + new Set(unread.map(function(i) { return i.platform; })).size + ' platform(s)'
            );
          }

          // Clickable toasts that navigate to Notifications tab on click
          if (unread.length === 1) {
            const item = unread[0];
            showToast({
              type: 'info',
              title: `New: ${item.title?.slice(0, 50) || 'Listing found'}`,
              message: item.price != null
                ? `${item.platform} · $${item.price}${item.location ? ' · ' + item.location : ''}`
                : `${item.platform}${item.location ? ' · ' + item.location : ''}`,
              duration: 4000,
              onClick: () => switchTab("tab-notifications")
            });
          } else if (unread.length <= 3) {
            unread.forEach(item => {
              showToast({
                type: 'info',
                title: `New: ${item.title?.slice(0, 40) || 'Listing found'}`,
                message: item.price != null
                  ? `${item.platform} · $${item.price}`
                  : item.platform,
                duration: 3500,
                onClick: () => switchTab("tab-notifications")
              });
            });
          } else {
            showToast({
              type: 'info',
              title: `\u{1F3AF} ${unread.length} new listings found!`,
              message: `Across ${new Set(unread.map(i => i.platform)).size} platform(s)`,
              duration: 5000,
              onClick: () => switchTab("tab-notifications")
            });
          }
        }
      }
    }
    const tabListingsHidden = document.getElementById("tab-listings")?.classList.contains("hidden");
    if (!tabListingsHidden) {
      unreadListingsCount = 0;
      const badge = document.getElementById("dashboard-badge");
      if (badge) badge.style.display = "none";
    }
    allListings = fetched;
    populateBrandDropdown();
    renderListings();
  } catch(err) {
    console.error(err);
  }
}

function populateBrandDropdown() {
  if (!el.filterListingsBrand) return;
  const currentSelected = el.filterListingsBrand.value;
  const brands = new Set();
  allListings.forEach(l => { if (l.make) brands.add(l.make); });
  const sortedBrands = Array.from(brands).sort();
  el.filterListingsBrand.innerHTML = `<option value="">All Brands</option>${sortedBrands.map(b => `<option value="${b}">${b}</option>`).join("")}`;
  if (sortedBrands.includes(currentSelected)) el.filterListingsBrand.value = currentSelected;
  else el.filterListingsBrand.value = "";
}

function renderListings() {
  const keywordFilter = el.filterListingsKeyword?.value.toLowerCase() || "";
  const locationFilter = el.filterListingsLocation?.value.toLowerCase() || "";
  const platformFilter = el.filterListingsPlatform?.value || "";
  const brandFilter = el.filterListingsBrand?.value || "";
  const maxPriceFilter = parseInt(el.filterListingsPrice?.value) || 10000;
  if (el.filterPriceDisplay) el.filterPriceDisplay.textContent = maxPriceFilter >= 10000 ? "Any" : maxPriceFilter;
  const sortOption = el.sortListings?.value || "latest";
  let filtered = allListings.filter(l => {
    if (platformFilter && l.platform !== platformFilter) return false;
    if (brandFilter && l.make !== brandFilter) return false;
    if (keywordFilter && (!l.title || !l.title.toLowerCase().includes(keywordFilter))) return false;
    if (locationFilter && (!l.location || !l.location.toLowerCase().includes(locationFilter))) return false;
    if (maxPriceFilter < 10000 && l.price != null && l.price > maxPriceFilter) return false;
    return true;
  });
  if (sortOption === "price_asc") filtered.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (sortOption === "price_desc") filtered.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
  else filtered.sort((a, b) => new Date(b.first_seen || 0) - new Date(a.first_seen || 0));

  if (filtered.length === 0) {
    el.listingsGrid.innerHTML = '<p style="color:var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 40px;">No recent listings found matching criteria.</p>';
    return;
  }

  el.listingsGrid.innerHTML = filtered.map(l => {
    const formattedPrice = l.price != null ? Number(l.price).toLocaleString() : '?';
    const listedTimeStr = l.listed_at ? new Date(l.listed_at).toLocaleString() : 'Waiting for fetch...';
    const scrapedTimeStr = l.first_seen ? new Date(l.first_seen).toLocaleString() : 'Recently';
    return `<div class="glass-panel listing-card" data-id="${l.id}">
      <div class="img-wrapper" style="background-image: url('${l.image || ''}'); position: relative; border-radius: 12px 12px 0 0;">
        <span class="platform-badge platform-${l.platform}" style="position: absolute; top: 12px; left: 12px; z-index: 10; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">${l.platform}</span>
      </div>
      <div class="details" style="padding: 16px; display: flex; flex-direction: column; justify-content: space-between; flex: 1; min-height: 260px; box-sizing: border-box;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            ${l.make ? `<span style="font-size:0.72rem;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);padding:2px 8px;border-radius:4px;font-weight:600;color:#a5b4fc;text-transform:uppercase;letter-spacing:0.5px;">${l.make}</span>` : '<span style="font-size:0.72rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:2px 8px;border-radius:4px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">Vehicle</span>'}
          </div>
          <h4 style="margin:0 0 10px 0;font-size:0.92rem;line-height:1.4;color:white;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:2.8em;font-weight:600;" title="${l.title}">${l.title}</h4>
          <div style="margin-bottom:12px;"><span style="color:#86efac;font-weight:700;font-size:1.4rem;">${l.currency || '$'}${formattedPrice}</span></div>
        </div>
        <div>
          <div style="color:var(--text-secondary);font-size:0.78rem;margin-bottom:16px;display:flex;flex-direction:column;gap:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;">
            <div style="display:flex;align-items:center;gap:6px;width:100%;overflow:hidden;"><svg style="width:12px;height:12px;flex-shrink:0;color:var(--text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;flex:1;">${l.location || 'Unknown Location'}</span></div>
            <div style="display:flex;align-items:center;gap:6px;"><svg style="width:12px;height:12px;flex-shrink:0;color:var(--text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg><span><strong>Listed:</strong> ${listedTimeStr}</span></div>
            <div style="display:flex;align-items:center;gap:6px;"><svg style="width:12px;height:12px;flex-shrink:0;color:var(--text-secondary);" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg><span><strong>Scraped:</strong> ${scrapedTimeStr}</span></div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="card-details-btn" title="View Details"><svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg><span>Details</span></button>
            <a href="${l.url}" target="_blank" onclick="event.stopPropagation();" class="secondary-btn" style="flex:0.8;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 12px;font-size:0.8rem;border-radius:6px;font-weight:600;text-align:center;"><svg style="width:14px;height:14px;" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg><span>Link</span></a>
          </div>
        </div>
      </div>
    </div>`;
  }).join("");

  el.listingsGrid.querySelectorAll('.listing-card').forEach(card => {
    const id = card.getAttribute('data-id');
    const listing = allListings.find(l => String(l.id) === String(id));
    if (!listing) return;
    const btn = card.querySelector('.card-details-btn');
    if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); openDetailsModal(listing); });
  });
}

function openDetailsModal(listing) {
  el.detailsTitle.textContent = listing.title || 'Unknown Title';
  if (el.detailsPlatformBadge) { el.detailsPlatformBadge.textContent = listing.platform; el.detailsPlatformBadge.className = `platform-badge platform-${listing.platform}`; }
  el.detailsPrice.textContent = `${listing.currency || '$'}${listing.price != null ? listing.price : '?'}`;
  el.detailsLocation.textContent = listing.location || 'Unknown Location';
  el.detailsListed.textContent = listing.listed_at ? new Date(listing.listed_at).toLocaleString() : 'Waiting for background fetch...';
  el.detailsSeen.textContent = listing.first_seen ? new Date(listing.first_seen).toLocaleString() : 'Recently';
  el.detailsLink.href = listing.url || '#';
  const images = Array.isArray(listing.images) && listing.images.length > 0 ? listing.images : (listing.image ? [listing.image] : []);
  el.detailsImageCarousel.innerHTML = images.length > 0 ? images.map(img => `<img src="${img}" style="height:250px;border-radius:8px;object-fit:contain;background:rgba(0,0,0,0.5);scroll-snap-align:start;" />`).join("") : '<div style="width:100%;height:250px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);border-radius:8px;color:var(--text-secondary);">No images available</div>';

  if (el.detailsSpecsGrid) {
    const extra = listing.extra || {};
    const specs = [];
    if (listing.make) specs.push({ label: 'Brand', value: listing.make, icon: '\u{1F3F7}\uFE0F' });
    if (extra.year) specs.push({ label: 'Year', value: extra.year, icon: '\u{1F4C5}' });
    if (extra.condition) specs.push({ label: 'Condition', value: extra.condition, icon: '\u2728' });
    if (extra.titleStatus) specs.push({ label: 'Title Status', value: extra.titleStatus, icon: '\u{1F4DD}' });
    if (extra.mileage) specs.push({ label: 'Mileage', value: extra.mileage, icon: '\u{1F6E3}\uFE0F' });
    if (extra.transmission) specs.push({ label: 'Transmission', value: extra.transmission, icon: '\u2699\uFE0F' });
    if (extra.color) specs.push({ label: 'Exterior Color', value: extra.color, icon: '\u{1F3A8}' });
    if (extra.fuelType) specs.push({ label: 'Fuel Type', value: extra.fuelType, icon: '\u26FD' });
    if (extra.sellerName) specs.push({ label: 'Seller', value: extra.sellerName, icon: '\u{1F464}' });
    if (extra.strikethroughPrice) specs.push({ label: 'Original Price', value: extra.strikethroughPrice, icon: '\u{1F3F7}\uFE0F' });
    if (extra.deliveryTypes && Array.isArray(extra.deliveryTypes)) specs.push({ label: 'Delivery', value: extra.deliveryTypes.join(', '), icon: '\u{1F4E6}' });
    if (specs.length > 0) {
      el.detailsSpecsGrid.innerHTML = specs.map(spec => `<div class="spec-pill" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:10px;min-width:130px;"><span style="font-size:1.4rem;">${spec.icon}</span><div style="display:flex;flex-direction:column;"><span style="font-size:0.7rem;color:var(--text-secondary);text-transform:uppercase;">${spec.label}</span><span style="font-size:0.88rem;font-weight:600;color:white;margin-top:2px;">${spec.value}</span></div></div>`).join("");
      document.getElementById('details-specs-container').style.display = 'block';
    } else { el.detailsSpecsGrid.innerHTML = ''; document.getElementById('details-specs-container').style.display = 'none'; }
  }
  if (el.detailsDescContainer && el.detailsDescription) {
    const desc = listing.extra?.description || null;
    if (desc) { el.detailsDescription.textContent = desc; el.detailsDescContainer.style.display = 'block'; }
    else { el.detailsDescription.textContent = ''; el.detailsDescContainer.style.display = 'none'; }
  }
  el.modalDetails.classList.remove('hidden');
}

if (el.closeDetailsBtn) el.closeDetailsBtn.addEventListener('click', () => el.modalDetails.classList.add('hidden'));
if (el.closeDetailsXBtn) el.closeDetailsXBtn.addEventListener('click', () => el.modalDetails.classList.add('hidden'));
if (el.filterListingsKeyword) el.filterListingsKeyword.addEventListener("input", renderListings);
if (el.filterListingsLocation) el.filterListingsLocation.addEventListener("input", renderListings);
if (el.filterListingsPlatform) el.filterListingsPlatform.addEventListener("change", renderListings);
if (el.filterListingsPrice) el.filterListingsPrice.addEventListener("input", renderListings);
if (el.filterListingsBrand) el.filterListingsBrand.addEventListener("change", renderListings);
if (el.sortListings) el.sortListings.addEventListener("change", renderListings);

el.refreshListingsBtn.onclick = async () => {
  el.refreshListingsBtn.textContent = "Refreshing...";
  await loadListings();
  setTimeout(() => el.refreshListingsBtn.textContent = "Refresh", 500);
};

// --- Country Flag Helpers ---
let countryFlagsData = {};
const ipCountryCache = JSON.parse(localStorage.getItem("mkt-ip-country-cache") || "{}");
const pendingLookups = new Set();

function triggerIpLookup(ip) {
  if (!ip || ip.includes("127.0.0.1") || ip.includes("localhost") || pendingLookups.has(ip)) return;
  pendingLookups.add(ip);
  fetch(`https://freeipapi.com/api/json/${ip}`)
    .then(res => res.json())
    .then(data => {
      if (data && data.countryCode) {
        ipCountryCache[ip] = data.countryCode;
        localStorage.setItem("mkt-ip-country-cache", JSON.stringify(ipCountryCache));
        if (typeof renderProxiesTable === "function") renderProxiesTable();
        if (typeof loadAccounts === "function") loadAccounts();
      }
    })
    .catch(e => console.error("GeoIP error:", e))
    .finally(() => pendingLookups.delete(ip));
}

function getFlagImgHtml(label, host) {
  let countryCode = "";
  if (label) {
    const cleaned = label.trim();
    const match = cleaned.match(/^([a-zA-Z]{2})(?:[_\s-]|$)/);
    if (match) countryCode = match[1].toLowerCase();
    else {
      const lower = cleaned.toLowerCase();
      if (countryFlagsData) {
        for (const [code, data] of Object.entries(countryFlagsData)) {
          if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) { countryCode = code.toLowerCase(); break; }
        }
      }
    }
  }
  if (!countryCode && host) {
    const ip = host.split(":")[0];
    if (ipCountryCache[ip]) countryCode = ipCountryCache[ip].toLowerCase();
    else triggerIpLookup(ip);
  }
  if (countryCode && /^[a-z]{2}$/.test(countryCode)) return `<span class="fi fi-${countryCode}" style="border-radius:2px;box-shadow:0 1px 2px rgba(0,0,0,0.2);width:20px;height:15px;display:inline-block;vertical-align:middle;"></span>`;
  return "";
}

async function loadCountriesDropdown() {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/country-flag-emoji-json@2.0.0/dist/by-code.json");
    countryFlagsData = await res.json();
    renderProxiesTable();
    const optionsContainer = document.getElementById("proxy-country-options");
    const selectTrigger = document.getElementById("proxy-country-trigger");
    const hiddenInput = el.proxyCountry;
    if (optionsContainer && selectTrigger && hiddenInput) {
      optionsContainer.innerHTML = `<div class="custom-option" data-value="" data-text="-- Select Country (Optional) --">-- Select Country (Optional) --</div>${Object.entries(countryFlagsData).map(([code, data]) => `<div class="custom-option" data-value="${code}" data-text="${data.name}"><span class="fi fi-${code.toLowerCase()}" style="border-radius:2px;width:20px;height:15px;display:inline-block;"></span><span>${data.name}</span></div>`).join("")}`;
      selectTrigger.onclick = (e) => { e.stopPropagation(); optionsContainer.classList.toggle("hidden"); };
      optionsContainer.querySelectorAll(".custom-option").forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value");
          const name = opt.getAttribute("data-text");
          hiddenInput.value = val;
          selectTrigger.querySelector("span").innerHTML = val ? `<span class="fi fi-${val.toLowerCase()}" style="border-radius:2px;width:20px;height:15px;display:inline-block;vertical-align:middle;margin-right:8px;"></span><span style="vertical-align:middle;">${name}</span>` : name;
          optionsContainer.classList.add("hidden");
        };
      });
      document.addEventListener("click", () => optionsContainer.classList.add("hidden"));
    }
    const filterOptionsContainer = document.getElementById("filter-proxy-country-options");
    const filterTrigger = document.getElementById("filter-proxy-country-trigger");
    const filterHiddenInput = document.getElementById("filter-proxy-country");
    if (filterOptionsContainer && filterTrigger && filterHiddenInput) {
      filterOptionsContainer.innerHTML = `<div class="custom-option" data-value="" data-text="-- All Countries --"><span>-- All Countries --</span></div><div class="custom-option" data-value="unassigned" data-text="-- No Country --"><span>-- No Country --</span></div>${Object.entries(countryFlagsData).map(([code, data]) => `<div class="custom-option" data-value="${code}" data-text="${data.name}"><span class="fi fi-${code.toLowerCase()}" style="border-radius:2px;width:20px;height:15px;display:inline-block;"></span><span>${data.name}</span></div>`).join("")}`;
      filterTrigger.onclick = (e) => {
        e.stopPropagation();
        const modalOpts = document.getElementById("proxy-country-options");
        if (modalOpts) modalOpts.classList.add("hidden");
        document.querySelectorAll(".row-select-options").forEach(opt => opt.classList.add("hidden"));
        filterOptionsContainer.classList.toggle("hidden");
      };
      filterOptionsContainer.querySelectorAll(".custom-option").forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value");
          const name = opt.getAttribute("data-text");
          filterHiddenInput.value = val;
          filterTrigger.querySelector("span").innerHTML = (val && val !== "unassigned") ? `<span class="fi fi-${val.toLowerCase()}" style="border-radius:2px;width:20px;height:15px;display:inline-block;vertical-align:middle;margin-right:8px;"></span><span style="vertical-align:middle;">${name}</span>` : name;
          filterOptionsContainer.classList.add("hidden");
          renderProxiesTable();
        };
      });
      document.addEventListener("click", () => filterOptionsContainer.classList.add("hidden"));
    }
  } catch (err) {
    console.error("Failed to load country list:", err);
  }
}

function getFlagEmoji(label) {
  if (!label) return "";
  const cleaned = label.trim();
  const match = cleaned.match(/^([a-zA-Z]{2})(?:[_\s-]|$)/);
  if (match) {
    const countryCode = match[1].toUpperCase();
    if (countryFlagsData && countryFlagsData[countryCode]) return countryFlagsData[countryCode].emoji;
    try { return String.fromCodePoint(...countryCode.split('').map(char => 127397 + char.charCodeAt(0))); } catch (e) { return ""; }
  }
  const lower = cleaned.toLowerCase();
  if (countryFlagsData) for (const [code, data] of Object.entries(countryFlagsData)) { if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) return data.emoji; }
  if (lower.includes("united states") || lower.includes("america") || lower.includes("usa")) return "\u{1F1FA}\u{1F1F8}";
  if (lower.includes("india")) return "\u{1F1EE}\u{1F1F3}";
  if (lower.includes("canada")) return "\u{1F1E8}\u{1F1E6}";
  if (lower.includes("germany")) return "\u{1F1E9}\u{1F1EA}";
  if (lower.includes("france")) return "\u{1F1EB}\u{1F1F7}";
  if (lower.includes("uk") || lower.includes("united kingdom") || lower.includes("england")) return "\u{1F1EC}\u{1F1E7}";
  if (lower.includes("australia")) return "\u{1F1E6}\u{1F1FA}";
  if (lower.includes("singapore")) return "\u{1F1F8}\u{1F1EC}";
  if (lower.includes("netherlands")) return "\u{1F1F3}\u{1F1F1}";
  if (lower.includes("ukraine")) return "\u{1F1FA}\u{1F1E6}";
  if (lower.includes("italy")) return "\u{1F1EE}\u{1F1F9}";
  if (lower.includes("spain")) return "\u{1F1EA}\u{1F1F8}";
  if (lower.includes("japan")) return "\u{1F1EF}\u{1F1F5}";
  if (lower.includes("china")) return "\u{1F1E8}\u{1F1F3}";
  if (lower.includes("brazil")) return "\u{1F1E7}\u{1F1F7}";
  return "";
}

// --- Proxies ---
let currentProxiesList = [];

async function loadProxies() {
  const data = await API.getProxies();
  const proxyLines = (data.proxies || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  currentProxiesList = proxyLines.map(line => {
    const [proxyPart, label] = line.split("#");
    const parts = proxyPart.split(":");
    return { host: parts[0] || "", port: parts[1] || "", username: parts[2] || "", password: parts[3] || "", label: label ? label.trim() : "", rawLine: line };
  }).filter(p => p.host && p.port);
  renderProxiesTable();
}

function renderProxiesTable() {
  const filterVal = document.getElementById("filter-proxy-country")?.value || "";
  let filteredList = currentProxiesList;
  if (filterVal === "unassigned") filteredList = currentProxiesList.filter(p => !p.label);
  else if (filterVal) filteredList = currentProxiesList.filter(p => p.label === filterVal);
  if (filteredList.length === 0) { el.proxiesTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:20px;">No proxies found matching filter.</td></tr>'; return; }
  el.proxiesTbody.innerHTML = filteredList.map(p => {
    const originalIndex = currentProxiesList.indexOf(p);
    const labelVal = p.label || "";
    const countryName = labelVal ? (countryFlagsData[labelVal]?.name || labelVal) : "-- No Country --";
    const customSelect = `<div class="row-select"><div class="row-select-trigger" onclick="toggleRowSelect(${originalIndex}, event)">${getFlagImgHtml(p.label, p.host)}<span>${countryName}</span><span style="font-size:0.75rem;color:var(--text-secondary);">\u25BC</span></div><div class="row-select-options hidden" id="row-select-options-${originalIndex}"><div class="row-option" onclick="changeProxyCountry(${originalIndex}, '')"><span style="display:inline-block;width:20px;height:15px;margin-right:4px;"></span><span>-- No Country --</span></div>${Object.entries(countryFlagsData || {}).map(([code, data]) => `<div class="row-option" onclick="changeProxyCountry(${originalIndex}, '${code}')"><span class="fi fi-${code.toLowerCase()}" style="border-radius:2px;width:20px;height:15px;display:inline-block;"></span><span>${data.name}</span></div>`).join("")}</div></div>`;
    return `<tr><td><strong style="color:#60a5fa">${p.host}:${p.port}</strong></td><td><code>${p.username || '-'}</code></td><td><code>${p.password ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : '-'}</code></td><td>${customSelect}</td><td><button class="danger-btn" onclick="deleteProxyAtIndex(${originalIndex})">Delete</button></td></tr>`;
  }).join("");
}

async function saveProxiesList() {
  const rawText = currentProxiesList.map(p => {
    let line = `${p.host}:${p.port}`;
    if (p.username || p.password) line += `:${p.username}`;
    if (p.password) line += `:${p.password}`;
    if (p.label) line += `#${p.label}`;
    return line;
  }).join("\n");
  await API.saveProxies(rawText);
}

window.toggleRowSelect = (index, event) => {
  event.stopPropagation();
  document.querySelectorAll(".row-select-options").forEach(opt => { if (opt.id !== `row-select-options-${index}`) opt.classList.add("hidden"); });
  const opt = document.getElementById(`row-select-options-${index}`);
  if (opt) opt.classList.toggle("hidden");
};

document.addEventListener("click", () => { document.querySelectorAll(".row-select-options").forEach(opt => opt.classList.add("hidden")); });

window.changeProxyCountry = async (index, countryCode) => {
  currentProxiesList[index].label = countryCode;
  await saveProxiesList();
  renderProxiesTable();
  loadAccounts();
};

window.deleteProxyAtIndex = async (index) => {
  if (!confirm("Are you sure you want to delete this proxy?")) return;
  currentProxiesList.splice(index, 1);
  await saveProxiesList();
  renderProxiesTable();
  loadAccounts();
};

el.addProxyModalBtn.onclick = () => {
  el.proxyBulkInput.value = "";
  el.proxyCountry.value = "";
  const triggerSpan = document.querySelector("#proxy-country-trigger span");
  if (triggerSpan) triggerSpan.innerHTML = "-- Select Country (Optional) --";
  el.modalAddProxy.classList.remove("hidden");
};
el.cancelProxyBtn.onclick = () => el.modalAddProxy.classList.add("hidden");

el.addProxyBtn.onclick = async () => {
  const rawText = el.proxyBulkInput.value.trim();
  const selectedCountry = el.proxyCountry.value;
  if (!rawText) return alert("Please enter at least one proxy!");
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let addedCount = 0;
  lines.forEach(line => {
    const [proxyPart, labelPart] = line.split("#");
    const parts = proxyPart.split(":");
    const host = parts[0] || "", port = parts[1] || "", username = parts[2] || "", password = parts[3] || "";
    if (host && port) {
      let label = labelPart ? labelPart.trim() : selectedCountry;
      if (label) {
        const match = label.match(/^([a-zA-Z]{2})(?:[_\s-]|$)/);
        if (match) label = match[1].toUpperCase();
        else {
          const lower = label.toLowerCase();
          if (countryFlagsData) for (const [code, data] of Object.entries(countryFlagsData)) { if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) { label = code.toUpperCase(); break; } }
        }
      }
      currentProxiesList.push({ host, port, username, password, label });
      addedCount++;
    }
  });
  if (addedCount === 0) return alert("No valid proxies found. Format: host:port:username:password#label");
  el.addProxyBtn.textContent = "Adding...";
  await saveProxiesList();
  renderProxiesTable();
  loadAccounts();
  el.proxyBulkInput.value = "";
  el.proxyCountry.value = "";
  const triggerSpan = document.querySelector("#proxy-country-trigger span");
  if (triggerSpan) triggerSpan.innerHTML = "-- Select Country (Optional) --";
  el.addProxyBtn.textContent = "Add Proxy";
  el.modalAddProxy.classList.add("hidden");
};

// --- Cookies ---
async function loadCookies() {
  const data = await API.getCookies();
  el.cookiesList.innerHTML = data.cookies.map(c => `<li><div class="cookie-file-details"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent-color);flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span class="cookie-filename" title="${c}">${c}</span></div><button class="danger-btn" onclick="deleteCookie('${c}')" style="padding:6px 12px;font-size:0.8rem;margin:0;">Remove</button></li>`).join("");
  if (data.cookies.length === 0) el.cookiesList.innerHTML = '<li style="grid-column:1/-1;justify-content:center;padding:20px;"><span style="color:var(--text-secondary)">No cookies uploaded yet.</span></li>';
}

window.deleteCookie = async (filename) => { if (!confirm(`Delete ${filename}?`)) return; await API.deleteCookie(filename); loadCookies(); };

el.cookieDropzone.onclick = () => el.cookieFile.click();
el.cookieDropzone.ondragover = (e) => { e.preventDefault(); el.cookieDropzone.classList.add("dragover"); };
el.cookieDropzone.ondragleave = () => el.cookieDropzone.classList.remove("dragover");
el.cookieDropzone.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); el.cookieDropzone.classList.remove("dragover"); if (e.dataTransfer.files[0]) handleCookieFile(e.dataTransfer.files[0]); };
el.cookieFile.onchange = (e) => { if (e.target.files[0]) handleCookieFile(e.target.files[0]); el.cookieFile.value = ""; };

function handleCookieFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try { const content = JSON.parse(e.target.result); const res = await API.uploadCookie(file.name, content); if (res.error) throw new Error(res.error); loadCookies(); }
    catch (err) { alert("Upload failed: " + err.message); console.error(err); }
  };
  reader.readAsText(file);
}

// --- Accounts ---
async function loadAccounts() {
  try {
    const [searches, accounts, proxyData] = await Promise.all([API.getSearches(), API.getAccounts(), API.getProxies()]);
    const fbSearches = searches.filter(s => s.platform === "facebook");
    if (accounts.length === 0) { el.accountsTbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-secondary);padding:20px;">No accounts synced. Please upload a cookie file in the FB Cookies tab.</td></tr>'; return; }
    el.accountsTbody.innerHTML = accounts.map(a => {
      const options = ['<option value="">-- Round-robin / Unassigned --</option>', ...fbSearches.map(s => `<option value="${s.id}" ${a.assigned_search_id === s.id ? 'selected' : ''}>${s.keyword} (${s.location || 'default'})</option>`)].join("");
      const lastUsedText = a.last_used ? new Date(a.last_used).toLocaleString() : 'Never';
      const statuses = ["healthy", "flagged", "cooling_down", "dead"];
      const statusSelect = `<select class="status-select status-${a.status}" onchange="changeAccountStatus('${a.id}', this.value)">${statuses.map(st => `<option value="${st}" ${a.status === st ? 'selected' : ''}>${st.toUpperCase()}</option>`).join("")}</select>`;
      const fallbackOptions = ['<option value="">-- No Fallback --</option>', ...accounts.filter(acc => acc.id !== a.id).map(acc => `<option value="${acc.id}" ${a.fallback_for_account_id === acc.id ? 'selected' : ''}>${acc.id}</option>`)].join("");
      return `<tr><td><code style="color:#60a5fa">${a.id}</code></td><td>${statusSelect}</td><td><select class="assignment-select" onchange="changeAccountAssignment('${a.id}', this.value)">${options}</select></td><td><select class="assignment-select" onchange="changeAccountFallback('${a.id}', this.value)" style="max-width:150px;">${fallbackOptions}</select></td><td><strong style="color:#4ade80">${a.success_count}</strong></td><td><strong style="color:#f87171">${a.error_count}</strong></td><td><span style="font-size:0.85rem;color:var(--text-secondary);">${lastUsedText}</span></td><td><button class="danger-btn" onclick="deleteCookieAndReload('${a.id}')">Delete</button></td></tr>`;
    }).join("");
  } catch (err) { console.error("Failed to load accounts:", err); }
}

window.changeAccountStatus = async (id, status) => { try { await API.updateAccountStatus(id, status); loadAccounts(); } catch (err) { alert("Failed: " + err.message); } };
window.changeAccountAssignment = async (id, searchId) => { try { await API.assignAccount(id, searchId || null); loadAccounts(); } catch (err) { alert("Failed: " + err.message); } };
window.changeAccountFallback = async (id, fallbackId) => { try { await API.assignFallback(id, fallbackId || null); loadAccounts(); } catch (err) { alert("Failed: " + err.message); } };
window.changeAccountProxy = async (id, proxy) => { try { await API.assignProxy(id, proxy || null); loadAccounts(); } catch (err) { alert("Failed: " + err.message); } };
window.deleteCookieAndReload = async (filename) => { if (!confirm(`Delete ${filename}?`)) return; await API.deleteCookie(filename); loadCookies(); loadAccounts(); };

// --- Metrics & Logs ---
async function loadMetrics() {
  try {
    const [searches, data, logData] = await Promise.all([API.getSearches(), API.getMetrics(), API.getLogs()]);
    const { metrics, listings } = data;
    const latencyMap = {};
    let totalLatency = 0, latencyCount = 0;
    listings.forEach(l => {
      try {
        const payload = JSON.parse(l.payload);
        if (payload.listed_at && l.first_seen) {
          const delaySec = (new Date(l.first_seen) - new Date(payload.listed_at)) / 1000;
          if (delaySec >= 0 && delaySec < 86400 * 7) {
            const location = payload.location || 'default';
            const key = `${l.platform}::${location}`;
            if (!latencyMap[key]) latencyMap[key] = { total: 0, count: 0, platform: l.platform, location: location };
            latencyMap[key].total += delaySec; latencyMap[key].count++;
            totalLatency += delaySec; latencyCount++;
          }
        }
      } catch (e) {}
    });
    const avgLatencySec = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null;
    el.avgLatency.textContent = avgLatencySec !== null ? `${avgLatencySec} s` : '--';
    const latencyRows = Object.values(latencyMap);
    el.latencyTbody.innerHTML = latencyRows.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-secondary);padding:15px;">No latency metrics recorded yet.</td></tr>' : latencyRows.map(row => `<tr><td><span class="platform-badge platform-${row.platform}">${row.platform}</span></td><td><strong>${row.location}</strong></td><td><strong style="color:#60a5fa">${Math.round(row.total / row.count)} seconds</strong></td></tr>`).join("");
    const successRates = {};
    let globalSuccessCount = 0, globalTotalCount = 0;
    metrics.forEach(m => {
      if (!successRates[m.search_id]) successRates[m.search_id] = { success: 0, total: 0, totalDuration: 0 };
      if (m.success) successRates[m.search_id].success++;
      successRates[m.search_id].total++;
      successRates[m.search_id].totalDuration += m.duration_ms;
      globalTotalCount++;
      if (m.success) globalSuccessCount++;
    });
    const globalRate = globalTotalCount > 0 ? Math.round((globalSuccessCount / globalTotalCount) * 100) : null;
    el.globalSuccessRate.textContent = globalRate !== null ? `${globalRate}%` : '--';
    el.metricsTbody.innerHTML = searches.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-secondary);padding:15px;">No search monitors defined.</td></tr>' : searches.map(s => {
      const stats = successRates[s.id];
      const rate = stats && stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : null;
      const avgDur = stats && stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : null;
      const rateText = rate !== null ? `${rate}% (${stats.success}/${stats.total})` : 'No data';
      const rateColor = rate !== null ? (rate > 80 ? '#4ade80' : rate > 40 ? '#facc15' : '#f87171') : 'var(--text-secondary)';
      return `<tr><td><span class="platform-badge platform-${s.platform}">${s.platform}</span></td><td><strong>${s.keyword}</strong></td><td>${s.location || '-'}</td><td><span style="color:${rateColor};font-weight:600;">${rateText}</span></td><td>${avgDur !== null ? `${(avgDur/1000).toFixed(1)}s` : '-'}</td></tr>`;
    }).join("");
    const systemLogs = logData.logs || [];
    el.logsContainer.innerHTML = systemLogs.length === 0 ? '<p style="color:var(--text-secondary);text-align:center;margin:0;padding:20px;">No console logs yet.</p>' : systemLogs.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString();
      const typeClass = `log-type-${l.type === 'error' ? 'error' : l.type === 'warn' ? 'alert' : 'info'}`;
      return `<div class="log-line ${typeClass}" style="border-bottom:none;padding:4px 8px;font-family:monospace;font-size:0.85rem;line-height:1.4;"><span class="log-time" style="color:#71717a;margin-right:6px;">[${time}]</span><span class="log-type" style="margin-right:6px;">[${l.type.toUpperCase()}]</span><span class="log-msg">${l.message}</span></div>`;
    }).join("");
    el.logsContainer.scrollTop = el.logsContainer.scrollHeight;
  } catch (err) { console.error("Failed to load metrics:", err); }
}

// --- Mobile Sidebar ---
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");
if (menuToggle && sidebar && sidebarOverlay) {
  const toggleMenu = () => { sidebar.classList.toggle("active"); sidebarOverlay.classList.toggle("hidden"); };
  menuToggle.onclick = toggleMenu;
  sidebarOverlay.onclick = toggleMenu;
  el.navBtns.forEach(btn => { btn.addEventListener("click", () => { if (window.innerWidth < 768) { sidebar.classList.remove("active"); sidebarOverlay.classList.add("hidden"); } }); });
}

// ============================================================
// DESKTOP NOTIFICATIONS (Web Notification API)
// ============================================================

// Request permission for browser desktop notifications
function requestDesktopNotifPermission() {
  if (!("Notification" in window)) {
    console.log('[Desktop Notif] Not supported in this browser');
    return;
  }
  if (Notification.permission === "granted") return;
  if (Notification.permission === "denied") {
    console.log('[Desktop Notif] Permission denied by user');
    return;
  }
  // Request permission
  Notification.requestPermission().then(function(perm) {
    if (perm === 'granted') {
      console.log('[Desktop Notif] Permission granted!');
    }
  }).catch(function(err) {
    console.error('[Desktop Notif] Permission request failed:', err);
  });
}

// Show a desktop notification
function showDesktopNotification(title, body, opts) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  
  try {
    var notif = new Notification(title, {
      body: body || '',
      icon: '/favicon.ico',
      tag: 'mkt-alert-' + Date.now(),
      ...opts
    });
    
    // Bring tab to focus when clicked
    notif.onclick = function() {
      window.focus();
      this.close();
    };
    
    // Auto-close after 10 seconds
    setTimeout(function() { notif.close(); }, 10000);
    
    return notif;
  } catch(e) {
    console.error('[Desktop Notif] Error:', e);
  }
}

// ============================================================
// NOTIFICATION BELL DROPDOWN (Dashboard header)
// ============================================================
let notifDropdownData = [];
var lastNotifPollCount = 0; // tracks last known count for bell badge

function populateNotifDropdown(events) {
  const list = document.getElementById('notif-dropdown-list');
  const countEl = document.getElementById('notif-dropdown-count');
  if (!list) return;
  
  const latest = events.slice(0, 5);
  notifDropdownData = events;
  
  if (countEl) {
    countEl.textContent = events.length > 99 ? '99+' : events.length;
  }
  
  if (latest.length === 0) {
    list.innerHTML = '<div class="notif-dropdown-empty">No notifications yet</div>';
    return;
  }
  
  list.innerHTML = latest.map(function(e) {
    var iconType = e.status === 'sent' ? 'success' : 'error';
    var icon = e.status === 'sent' ? '\u2705' : '\u274C';
    var time = new Date(e.timestamp).toLocaleString();
    var title = esc(e.title || e.message || 'Notification');
    var channel = esc(e.channel || '-');
    return '<div class="notif-dropdown-item">' +
      '<div class="notif-dropdown-item-icon ' + iconType + '">' + icon + '</div>' +
      '<div class="notif-dropdown-item-content">' +
        '<div class="notif-dropdown-item-title" title="' + title.replace(/"/g, '&quot;') + '">' + title + '</div>' +
        '<div class="notif-dropdown-item-time">' + time + ' \u00B7 ' + channel + '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function loadNotifDropdown() {
  try {
    var data = await API.getNotificationHistory();
    var events = data.events || [];
    populateNotifDropdown(events);
    
    // Update bell badge using own counter (no dependency on notifHistoryCache)
    var badge = document.getElementById('notif-bell-badge');
    if (badge) {
      if (lastNotifPollCount > 0 && events.length > lastNotifPollCount) {
        var newCount = events.length - lastNotifPollCount;
        badge.textContent = newCount > 99 ? '99+' : newCount;
        badge.style.display = 'inline-flex';
      }
      // Store current count for next comparison
      lastNotifPollCount = events.length;
    }
  } catch (err) {
    // Silently fail - dropdown just won't update
  }
}

// Bell button toggle
var notifBellBtn = document.getElementById('notif-bell-btn');
var notifDropdown = document.getElementById('notif-dropdown');

if (notifBellBtn && notifDropdown) {
  notifBellBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var isHidden = notifDropdown.classList.contains('hidden');
    // Close other dropdowns
    document.querySelectorAll('.row-select-options, .custom-select-options').forEach(function(el) {
      el.classList.add('hidden');
    });
    if (isHidden) {
      notifDropdown.classList.remove('hidden');
      notifBellBtn.classList.add('active');
      // Reset bell badge when opening
      var badge = document.getElementById('notif-bell-badge');
      if (badge) badge.style.display = 'none';
      // Load fresh data on open
      loadNotifDropdown();
    } else {
      notifDropdown.classList.add('hidden');
      notifBellBtn.classList.remove('active');
    }
  });
  
  // Close on click outside
  document.addEventListener('click', function() {
    notifDropdown.classList.add('hidden');
    notifBellBtn.classList.remove('active');
  });
}

// View All button
var viewAllBtn = document.getElementById('notif-view-all-btn');
if (viewAllBtn) {
  viewAllBtn.addEventListener('click', function() {
    notifDropdown.classList.add('hidden');
    notifBellBtn.classList.remove('active');
    switchTab('tab-notifications');
  });
}

// Also load bell dropdown with notification history
var _origLoadNotifHistory = loadNotificationHistory;
loadNotificationHistory = function() {
  return _origLoadNotifHistory().then(function() {
    // Also update dropdown if it's open
    if (notifDropdown && !notifDropdown.classList.contains('hidden')) {
      loadNotifDropdown();
    }
  }).catch(function() {});
};

// Notification test button
if (el.testAllNotificationsBtn) el.testAllNotificationsBtn.addEventListener('click', testAllNotifications);

// Periodically refresh notification badge in background (every 30s)
setInterval(function() {
  // Always refresh badge in background, regardless of dropdown state
  if (notifDropdown) {
    loadNotifDropdown();
  }
}, 30000);

// Also periodically load full notification history for desktop notifications (every 60s)
setInterval(function() {
  loadNotificationHistory();
}, 60000);

// Boot with error logging
checkAuth().catch(function(err) {
  console.error('[Boot] checkAuth failed:', err);
  // Fallback: show login if something goes wrong
  var overlay = document.getElementById('login-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('active');
  }
  var dash = document.getElementById('dashboard');
  if (dash) dash.classList.add('hidden');
});

// Global error handler to catch all JS errors
window.addEventListener('error', function(e) {
  console.error('[Global Error]', e.message, 'at', e.filename + ':' + e.lineno);
  // Optional: show a small debug toast
  var container = document.getElementById('toast-container');
  if (container) {
    var errToast = document.createElement('div');
    errToast.style.cssText = 'background:rgba(220,38,38,0.9);color:white;padding:10px 16px;border-radius:8px;margin-bottom:8px;font-size:0.8rem;max-width:400px;word-break:break-word;';
    errToast.textContent = 'JS Error: ' + e.message;
    container.prepend(errToast);
    setTimeout(function() { if (errToast.parentNode) errToast.parentNode.removeChild(errToast); }, 8000);
  }
});

// --- Auto-Refresh Polling ---
let autoRefreshInterval = null;
function startAutoRefresh() {
  if (autoRefreshInterval) return;
  let tick = 0;
  autoRefreshInterval = setInterval(async () => {
    if (el.dashboard.classList.contains("hidden")) return;
    tick++;
    try { await loadListings(); } catch (e) {}
    try { await loadNotifDropdown(); } catch (e) {}
    if (tick % 2 === 0) { try { await loadSearches(); } catch (e) {} try { await loadAccounts(); } catch (e) {} }
    if (tick % 10 === 0) { try { await loadMetrics(); } catch (e) {} }
  }, 30000);
}
function stopAutoRefresh() { if (autoRefreshInterval) { clearInterval(autoRefreshInterval); autoRefreshInterval = null; } }

const _origShowDashboard = showDashboard;
window.showDashboard = function() { _origShowDashboard(); startAutoRefresh(); loadNotifDropdown(); requestDesktopNotifPermission(); };
const _origShowLogin = showLogin;
window.showLogin = function() { _origShowLogin(); stopAutoRefresh(); };
