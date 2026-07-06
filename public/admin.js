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
  getMetrics: () => API.req("/metrics"),
  
  getListings: async () => {
    // Fetch listings from the last 24 hours (86400 seconds) so they stay visible
    const res = await fetch("/api/listings/new?sinceSeconds=86400", { headers: { "x-api-key": apiKey } });
    if (res.status === 401) throw new Error("Unauthorized");
    return res.json();
  }
};

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
  
  accountsTbody: document.getElementById("accounts-tbody"),
  
  metricsTbody: document.getElementById("metrics-tbody"),
  latencyTbody: document.getElementById("latency-tbody"),
  logsContainer: document.getElementById("logs-container"),
  avgLatency: document.getElementById("avg-latency"),
  globalSuccessRate: document.getElementById("global-success-rate"),
  
  proxiesTextarea: document.getElementById("proxies-textarea"),
  saveProxiesBtn: document.getElementById("save-proxies-btn"),
  
  cookiesList: document.getElementById("cookies-list"),
  cookieFile: document.getElementById("cookie-file"),
  cookieDropzone: document.getElementById("cookie-dropzone"),
  
  listingsGrid: document.getElementById("listings-grid"),
  refreshListingsBtn: document.getElementById("refresh-listings-btn")
};

// --- Authentication ---
async function checkAuth() {
  if (!apiKey) return showLogin();
  try {
    await loadSearches();
    showDashboard();
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
    if (tabId === "tab-accounts") loadAccounts();
    else if (tabId === "tab-metrics") loadMetrics();
    else if (tabId === "tab-searches") loadSearches();
    else if (tabId === "tab-listings") loadListings();
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
      <td>${s.location || '-'}</td>
      <td>${s.minPrice || '-'}</td>
      <td>${s.maxPrice || '-'}</td>
      <td><button class="danger-btn" onclick="deleteSearch(${s.id})">Delete</button></td>
    </tr>
  `).join("");
}

window.deleteSearch = async (id) => {
  if (!confirm("Delete this search monitor?")) return;
  await API.deleteSearch(id);
  loadSearches();
};

el.addSearchBtn.onclick = () => el.modalAddSearch.classList.remove("hidden");
el.cancelSearchBtn.onclick = () => el.modalAddSearch.classList.add("hidden");

el.saveSearchBtn.onclick = async () => {
  const data = {
    platform: document.getElementById("new-platform").value,
    keyword: document.getElementById("new-keyword").value.trim(),
    location: document.getElementById("new-location").value.trim() || null,
    minPrice: parseFloat(document.getElementById("new-min").value) || null,
    maxPrice: parseFloat(document.getElementById("new-max").value) || null,
  };
  if (!data.keyword) return alert("Keyword is required!");
  
  el.saveSearchBtn.textContent = "Saving...";
  await API.addSearch(data);
  el.saveSearchBtn.textContent = "Add Search";
  el.modalAddSearch.classList.add("hidden");
  
  document.getElementById("new-keyword").value = "";
  loadSearches();
};

// --- Listings ---
async function loadListings() {
  try {
    const listings = await API.getListings();
    if (listings.length === 0) {
      el.listingsGrid.innerHTML = '<p style="color:var(--text-secondary); grid-column: 1/-1; text-align: center; padding: 40px;">No recent listings found. Ensure your scrapers are running.</p>';
      return;
    }
    el.listingsGrid.innerHTML = listings.map(l => `
      <div class="glass-panel listing-card">
        <div class="img-wrapper" style="background-image: url('${l.image || ''}');"></div>
        <div class="details">
          <span class="platform-badge platform-${l.platform}">${l.platform}</span>
          <h4><a href="${l.url}" target="_blank" style="color: white; text-decoration: none;">${l.title}</a></h4>
          <p class="price" style="color: #86efac; font-weight: bold; font-size: 1.2rem; margin: 8px 0;">$${l.price != null ? l.price : '?'}</p>
          <p style="color: var(--text-secondary); font-size: 0.8rem;">${l.location || 'Unknown Location'} • ${new Date(l.listed_at).toLocaleString()}</p>
        </div>
      </div>
    `).join("");
  } catch(err) {
    console.error(err);
  }
}

el.refreshListingsBtn.onclick = async () => {
  el.refreshListingsBtn.textContent = "Refreshing...";
  await loadListings();
  setTimeout(() => el.refreshListingsBtn.textContent = "Refresh", 500);
};

// --- Proxies ---
async function loadProxies() {
  const data = await API.getProxies();
  el.proxiesTextarea.value = data.proxies;
}

el.saveProxiesBtn.onclick = async () => {
  el.saveProxiesBtn.textContent = "Saving...";
  await API.saveProxies(el.proxiesTextarea.value);
  setTimeout(() => el.saveProxiesBtn.textContent = "Save Proxies", 1000);
};

// --- Cookies ---
async function loadCookies() {
  const data = await API.getCookies();
  el.cookiesList.innerHTML = data.cookies.map(c => `
    <li>
      <span>${c}</span>
      <button class="danger-btn" onclick="deleteCookie('${c}')">Remove</button>
    </li>
  `).join("");
  if(data.cookies.length === 0) {
    el.cookiesList.innerHTML = '<li><span style="color:var(--text-secondary)">No cookies uploaded yet.</span></li>';
  }
}

window.deleteCookie = async (filename) => {
  if (!confirm(`Delete ${filename}?`)) return;
  await API.deleteCookie(filename);
  loadCookies();
};

// Drag & Drop / File Input
el.cookieDropzone.ondragover = (e) => { e.preventDefault(); el.cookieDropzone.classList.add("dragover"); };
el.cookieDropzone.ondragleave = () => el.cookieDropzone.classList.remove("dragover");
el.cookieDropzone.ondrop = (e) => {
  e.preventDefault();
  el.cookieDropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handleCookieFile(e.dataTransfer.files[0]);
};
el.cookieFile.onchange = (e) => {
  if (e.target.files[0]) handleCookieFile(e.target.files[0]);
  el.cookieFile.value = "";
};

function handleCookieFile(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const content = JSON.parse(e.target.result);
      const res = await API.uploadCookie(file.name, content);
      if (res.error) throw new Error(res.error);
      loadCookies();
    } catch (err) {
      alert("Upload failed: " + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

// --- Accounts & Rotation UI ---
async function loadAccounts() {
  try {
    const [searches, accounts] = await Promise.all([
      API.getSearches(),
      API.getAccounts()
    ]);
    
    const fbSearches = searches.filter(s => s.platform === "facebook");
    
    if (accounts.length === 0) {
      el.accountsTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">No accounts synced. Please upload a cookie file in the FB Cookies tab.</td></tr>`;
      return;
    }
    
    el.accountsTbody.innerHTML = accounts.map(a => {
      // Assignment select dropdown
      const options = [
        '<option value="">-- Round-robin / Unassigned --</option>',
        ...fbSearches.map(s => `
          <option value="${s.id}" ${a.assigned_search_id === s.id ? 'selected' : ''}>
            ${s.keyword} (${s.location || 'default'})
          </option>
        `)
      ].join("");
      
      const lastUsedText = a.last_used ? new Date(a.last_used).toLocaleString() : 'Never';
      
      // Status color/badges and manually update dropdown
      const statuses = ["healthy", "flagged", "cooling_down", "dead"];
      const statusSelect = `
        <select class="status-select status-${a.status}" onchange="changeAccountStatus('${a.id}', this.value)">
          ${statuses.map(st => `<option value="${st}" ${a.status === st ? 'selected' : ''}>${st.toUpperCase()}</option>`).join("")}
        </select>
      `;

      return `
        <tr>
          <td><code style="color: #60a5fa">${a.id}</code></td>
          <td>${statusSelect}</td>
          <td>
            <select class="assignment-select" onchange="changeAccountAssignment('${a.id}', this.value)">
              ${options}
            </select>
          </td>
          <td><strong style="color: #4ade80">${a.success_count}</strong></td>
          <td><strong style="color: #f87171">${a.error_count}</strong></td>
          <td><span style="font-size: 0.85rem; color: var(--text-secondary);">${lastUsedText}</span></td>
          <td>
            <button class="danger-btn" onclick="deleteCookieAndReload('${a.id}')">Delete</button>
          </td>
        </tr>
      `;
    }).join("");

  } catch (err) {
    console.error("Failed to load accounts:", err);
  }
}

window.changeAccountStatus = async (id, status) => {
  try {
    await API.updateAccountStatus(id, status);
    loadAccounts();
  } catch (err) {
    alert("Failed to update status: " + err.message);
  }
};

window.changeAccountAssignment = async (id, searchId) => {
  try {
    await API.assignAccount(id, searchId || null);
    loadAccounts();
  } catch (err) {
    alert("Failed to assign search: " + err.message);
  }
};

window.deleteCookieAndReload = async (filename) => {
  if (!confirm(`Delete ${filename}?`)) return;
  await API.deleteCookie(filename);
  loadCookies();
  loadAccounts();
};

// --- Metrics & Logs UI ---
async function loadMetrics() {
  try {
    const [searches, data] = await Promise.all([
      API.getSearches(),
      API.getMetrics()
    ]);
    
    const { metrics, logs, listings } = data;
    
    // 1. Calculate Latency per Location/Platform
    // Latency = average of (first_seen - listed_at) in seconds
    const latencyMap = {};
    let totalLatency = 0;
    let latencyCount = 0;
    
    listings.forEach(l => {
      try {
        const payload = JSON.parse(l.payload);
        if (payload.listed_at && l.first_seen) {
          const delaySec = (new Date(l.first_seen) - new Date(payload.listed_at)) / 1000;
          if (delaySec >= 0 && delaySec < 86400 * 7) { // filter outliers
            const key = `${l.platform}::${l.location || 'default'}`;
            if (!latencyMap[key]) latencyMap[key] = { total: 0, count: 0, platform: l.platform, location: l.location || 'default' };
            latencyMap[key].total += delaySec;
            latencyMap[key].count++;
            
            totalLatency += delaySec;
            latencyCount++;
          }
        }
      } catch (e) {}
    });
    
    const avgLatencySec = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : null;
    el.avgLatency.textContent = avgLatencySec !== null ? `${avgLatencySec} s` : '--';
    
    const latencyRows = Object.values(latencyMap);
    if (latencyRows.length === 0) {
      el.latencyTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-secondary); padding: 15px;">No latency metrics recorded yet. Delay will show once new items are scraped.</td></tr>`;
    } else {
      el.latencyTbody.innerHTML = latencyRows.map(row => `
        <tr>
          <td><span class="platform-badge platform-${row.platform}">${row.platform}</span></td>
          <td><strong>${row.location}</strong></td>
          <td><strong style="color: #60a5fa">${Math.round(row.total / row.count)} seconds</strong></td>
        </tr>
      `).join("");
    }
    
    // 2. Success Rates per Search Monitor (24h)
    // Group metrics by search_id
    const successRates = {};
    let globalSuccessCount = 0;
    let globalTotalCount = 0;
    
    metrics.forEach(m => {
      if (!successRates[m.search_id]) successRates[m.search_id] = { success: 0, total: 0, totalDuration: 0 };
      if (m.success) {
        successRates[m.search_id].success++;
        globalSuccessCount++;
      }
      successRates[m.search_id].total++;
      successRates[m.search_id].totalDuration += m.duration_ms;
      globalTotalCount++;
    });
    
    const globalRate = globalTotalCount > 0 ? Math.round((globalSuccessCount / globalTotalCount) * 100) : null;
    el.globalSuccessRate.textContent = globalRate !== null ? `${globalRate}%` : '--';
    
    if (searches.length === 0) {
      el.metricsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 15px;">No search monitors defined.</td></tr>`;
    } else {
      el.metricsTbody.innerHTML = searches.map(s => {
        const stats = successRates[s.id];
        const rate = stats && stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : null;
        const avgDur = stats && stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : null;
        
        const rateText = rate !== null ? `${rate}% (${stats.success}/${stats.total})` : 'No data';
        const rateColor = rate !== null ? (rate > 80 ? '#4ade80' : rate > 40 ? '#facc15' : '#f87171') : 'var(--text-secondary)';
        
        return `
          <tr>
            <td><span class="platform-badge platform-${s.platform}">${s.platform}</span></td>
            <td><strong>${s.keyword}</strong></td>
            <td>${s.location || '-'}</td>
            <td><span style="color: ${rateColor}; font-weight: 600;">${rateText}</span></td>
            <td>${avgDur !== null ? `${(avgDur/1000).toFixed(1)}s` : '-'}</td>
          </tr>
        `;
      }).join("");
    }
    
    // 3. Health console logs
    if (logs.length === 0) {
      el.logsContainer.innerHTML = `<p style="color: var(--text-secondary); text-align: center; margin: 0; padding: 20px;">No console logs yet.</p>`;
    } else {
      el.logsContainer.innerHTML = logs.map(l => {
        const time = new Date(l.timestamp).toLocaleTimeString();
        const typeClass = `log-type-${l.type}`;
        return `
          <div class="log-line ${typeClass}">
            <span class="log-time">[${time}]</span>
            <span class="log-account">&lt;${l.account_id || 'system'}&gt;</span>
            <span class="log-type">[${l.type.toUpperCase()}]</span>
            <span class="log-msg">${l.message}</span>
          </div>
        `;
      }).join("");
      el.logsContainer.scrollTop = 0; // scroll to top
    }

  } catch (err) {
    console.error("Failed to load metrics:", err);
  }
}

// --- Mobile Sidebar Toggle ---
const menuToggle = document.getElementById("menu-toggle");
const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebar-overlay");

if (menuToggle && sidebar && sidebarOverlay) {
  const toggleMenu = () => {
    sidebar.classList.toggle("active");
    sidebarOverlay.classList.toggle("hidden");
  };
  menuToggle.onclick = toggleMenu;
  sidebarOverlay.onclick = toggleMenu;
  
  // Close menu when clicking navigation links on mobile
  el.navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      if (window.innerWidth < 768) {
        sidebar.classList.remove("active");
        sidebarOverlay.classList.add("hidden");
      }
    });
  });
}

// Boot
checkAuth();
