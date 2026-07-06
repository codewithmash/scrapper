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
  assignProxy: (id, proxy) => API.req("/accounts/proxy", { method: "POST", body: JSON.stringify({ id, proxy }) }),
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
  refreshListingsBtn: document.getElementById("refresh-listings-btn")
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
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${getFlagImgHtml(s.location)}
          <span style="vertical-align: middle;">${s.location || '-'}</span>
        </div>
      </td>
      <td>${s.minPrice !== null && s.minPrice !== undefined ? `$${s.minPrice}` : '-'}</td>
      <td>${s.maxPrice !== null && s.maxPrice !== undefined ? `$${s.maxPrice}` : '-'}</td>
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
    el.newFbAccount.innerHTML = [
      '<option value="">-- Round-robin / Unassigned --</option>',
      ...activeAccounts.map(a => `<option value="${a.id}">${a.id} (${a.status.toUpperCase()})</option>`)
    ].join("");
  } catch (err) {
    console.error("Failed to populate FB accounts dropdown:", err);
  }
}

el.newPlatform.onchange = () => {
  if (el.newPlatform.value === "facebook") {
    el.fbAccountGroup.style.display = "block";
    populateFbAccountsDropdown();
  } else {
    el.fbAccountGroup.style.display = "none";
  }
};

el.addSearchBtn.onclick = () => {
  el.newPlatform.value = "ebay";
  el.fbAccountGroup.style.display = "none";
  el.newFbAccount.innerHTML = '<option value="">-- Round-robin / Unassigned --</option>';
  
  document.getElementById("new-keyword").value = "";
  document.getElementById("new-location").value = "";
  document.getElementById("new-min").value = "";
  document.getElementById("new-max").value = "";
  
  const triggerSpan = document.querySelector("#new-country-trigger span");
  if (triggerSpan) triggerSpan.innerHTML = "-- Select Country (Optional) --";
  
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
  
  if (data.platform === "facebook") {
    data.fbAccountId = el.newFbAccount.value || null;
  }
  
  el.saveSearchBtn.textContent = "Saving...";
  await API.addSearch(data);
  el.saveSearchBtn.textContent = "Add Search";
  el.modalAddSearch.classList.add("hidden");
  
  document.getElementById("new-keyword").value = "";
  document.getElementById("new-location").value = "";
  document.getElementById("new-min").value = "";
  document.getElementById("new-max").value = "";
  
  const triggerSpan = document.querySelector("#new-country-trigger span");
  if (triggerSpan) triggerSpan.innerHTML = "-- Select Country (Optional) --";
  
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

// --- Helper to get country flag emoji/image from label ---
let countryFlagsData = {};
const ipCountryCache = JSON.parse(localStorage.getItem("mkt-ip-country-cache") || "{}");
const pendingLookups = new Set();

function triggerIpLookup(ip) {
  if (!ip || ip.includes("127.0.0.1") || ip.includes("localhost") || pendingLookups.has(ip)) {
    return;
  }
  pendingLookups.add(ip);
  
  fetch(`https://freeipapi.com/api/json/${ip}`)
    .then(res => res.json())
    .then(data => {
      if (data && data.countryCode) {
        ipCountryCache[ip] = data.countryCode;
        localStorage.setItem("mkt-ip-country-cache", JSON.stringify(ipCountryCache));
        // Re-render proxy components to show the newly resolved flag
        if (typeof renderProxiesTable === "function") renderProxiesTable();
        if (typeof loadAccounts === "function") loadAccounts();
      }
    })
    .catch(e => console.error("GeoIP error:", e))
    .finally(() => {
      pendingLookups.delete(ip);
    });
}

function getFlagImgHtml(label, host) {
  let countryCode = "";
  
  // 1. Try resolving from label
  if (label) {
    const cleaned = label.trim();
    const match = cleaned.match(/^([a-zA-Z]{2})(?:[_-\s]|$)/);
    if (match) {
      countryCode = match[1].toLowerCase();
    } else {
      const lower = cleaned.toLowerCase();
      if (countryFlagsData) {
        for (const [code, data] of Object.entries(countryFlagsData)) {
          if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) {
            countryCode = code.toLowerCase();
            break;
          }
        }
      }
    }
  }
  
  // 2. If no label country resolved, use host IP lookup
  if (!countryCode && host) {
    const ip = host.split(":")[0];
    if (ipCountryCache[ip]) {
      countryCode = ipCountryCache[ip].toLowerCase();
    } else {
      triggerIpLookup(ip);
    }
  }
  
  if (countryCode && /^[a-z]{2}$/.test(countryCode)) {
    return `<span class="fi fi-${countryCode}" style="border-radius: 2px; box-shadow: 0 1px 2px rgba(0,0,0,0.2); width: 20px; height: 15px; display: inline-block; vertical-align: middle;"></span>`;
  }
  
  return "";
}

async function loadCountriesDropdown() {
  try {
    const res = await fetch("https://cdn.jsdelivr.net/npm/country-flag-emoji-json@2.0.0/dist/by-code.json");
    countryFlagsData = await res.json();
    
    // 1. Populate the table list dropdowns
    renderProxiesTable();
    
    // 2. Populate the modal country select dropdown
    const optionsContainer = document.getElementById("proxy-country-options");
    const selectTrigger = document.getElementById("proxy-country-trigger");
    const hiddenInput = el.proxyCountry;
    
    if (optionsContainer && selectTrigger && hiddenInput) {
      optionsContainer.innerHTML = `
        <div class="custom-option" data-value="" data-text="-- Select Country (Optional) --">
          -- Select Country (Optional) --
        </div>
        ${Object.entries(countryFlagsData).map(([code, data]) => `
          <div class="custom-option" data-value="${code}" data-text="${data.name}">
            <span class="fi fi-${code.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block;"></span>
            <span>${data.name}</span>
          </div>
        `).join("")}
      `;
      
      // Trigger toggle
      selectTrigger.onclick = (e) => {
        e.stopPropagation();
        optionsContainer.classList.toggle("hidden");
      };
      
      // Option select
      optionsContainer.querySelectorAll(".custom-option").forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value");
          const name = opt.getAttribute("data-text");
          hiddenInput.value = val;
          
          if (val) {
            selectTrigger.querySelector("span").innerHTML = `
              <span class="fi fi-${val.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block; vertical-align: middle; margin-right: 8px;"></span>
              <span style="vertical-align: middle;">${name}</span>
            `;
          } else {
            selectTrigger.querySelector("span").innerHTML = name;
          }
          optionsContainer.classList.add("hidden");
        };
      });
      
      // Close dropdown when clicking outside
      document.addEventListener("click", () => {
        optionsContainer.classList.add("hidden");
      });
    }

    // 3. Populate and wire up header filter dropdown
    const filterOptionsContainer = document.getElementById("filter-proxy-country-options");
    const filterTrigger = document.getElementById("filter-proxy-country-trigger");
    const filterHiddenInput = document.getElementById("filter-proxy-country");
    
    if (filterOptionsContainer && filterTrigger && filterHiddenInput) {
      filterOptionsContainer.innerHTML = `
        <div class="custom-option" data-value="" data-text="-- All Countries --">
          <span>-- All Countries --</span>
        </div>
        <div class="custom-option" data-value="unassigned" data-text="-- No Country --">
          <span>-- No Country --</span>
        </div>
        ${Object.entries(countryFlagsData).map(([code, data]) => `
          <div class="custom-option" data-value="${code}" data-text="${data.name}">
            <span class="fi fi-${code.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block;"></span>
            <span>${data.name}</span>
          </div>
        `).join("")}
      `;
      
      // Toggle display
      filterTrigger.onclick = (e) => {
        e.stopPropagation();
        // Close others
        const modalOpts = document.getElementById("proxy-country-options");
        if (modalOpts) modalOpts.classList.add("hidden");
        document.querySelectorAll(".row-select-options").forEach(opt => opt.classList.add("hidden"));
        
        filterOptionsContainer.classList.toggle("hidden");
      };
      
      // Select option
      filterOptionsContainer.querySelectorAll(".custom-option").forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value");
          const name = opt.getAttribute("data-text");
          filterHiddenInput.value = val;
          
          if (val && val !== "unassigned") {
            filterTrigger.querySelector("span").innerHTML = `
              <span class="fi fi-${val.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block; vertical-align: middle; margin-right: 8px;"></span>
              <span style="vertical-align: middle;">${name}</span>
            `;
          } else {
            filterTrigger.querySelector("span").innerHTML = name;
          }
          filterOptionsContainer.classList.add("hidden");
          renderProxiesTable();
        };
      });
      
      // Close when clicking outside
      document.addEventListener("click", () => {
        filterOptionsContainer.classList.add("hidden");
      });
    }

    // 4. Populate and wire up Add Search Monitor country select dropdown
    const searchOptionsContainer = document.getElementById("new-country-options");
    const searchSelectTrigger = document.getElementById("new-country-trigger");
    const searchHiddenInput = document.getElementById("new-location");
    
    if (searchOptionsContainer && searchSelectTrigger && searchHiddenInput) {
      searchOptionsContainer.innerHTML = `
        <div class="custom-option" data-value="" data-text="-- Select Country (Optional) --">
          -- Select Country (Optional) --
        </div>
        ${Object.entries(countryFlagsData).map(([code, data]) => `
          <div class="custom-option" data-value="${code}" data-text="${data.name}">
            <span class="fi fi-${code.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block;"></span>
            <span>${data.name}</span>
          </div>
        `).join("")}
      `;
      
      // Toggle display
      searchSelectTrigger.onclick = (e) => {
        e.stopPropagation();
        // Close others
        const proxyOpts = document.getElementById("proxy-country-options");
        if (proxyOpts) proxyOpts.classList.add("hidden");
        const filterOpts = document.getElementById("filter-proxy-country-options");
        if (filterOpts) filterOpts.classList.add("hidden");
        document.querySelectorAll(".row-select-options").forEach(opt => opt.classList.add("hidden"));
        
        searchOptionsContainer.classList.toggle("hidden");
      };
      
      // Select option
      searchOptionsContainer.querySelectorAll(".custom-option").forEach(opt => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute("data-value");
          const name = opt.getAttribute("data-text");
          searchHiddenInput.value = val;
          
          if (val) {
            searchSelectTrigger.querySelector("span").innerHTML = `
              <span class="fi fi-${val.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block; vertical-align: middle; margin-right: 8px;"></span>
              <span style="vertical-align: middle;">${name}</span>
            `;
          } else {
            searchSelectTrigger.querySelector("span").innerHTML = name;
          }
          searchOptionsContainer.classList.add("hidden");
        };
      });
      
      // Close dropdown when clicking outside
      document.addEventListener("click", () => {
        searchOptionsContainer.classList.add("hidden");
      });
    }
  } catch (err) {
    console.error("Failed to load country list:", err);
  }
}

function getFlagEmoji(label) {
  if (!label) return "";
  const cleaned = label.trim();
  
  // Match 2-letter country code at start of label (e.g. US_Chicago, CA-Toronto, IN)
  const match = cleaned.match(/^([a-zA-Z]{2})(?:[_-\s]|$)/);
  if (match) {
    const countryCode = match[1].toUpperCase();
    if (countryFlagsData && countryFlagsData[countryCode]) {
      return countryFlagsData[countryCode].emoji;
    }
    try {
      const codePoints = countryCode
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
      return String.fromCodePoint(...codePoints);
    } catch (e) {
      return "";
    }
  }
  
  // Fallbacks for full country names
  const lower = cleaned.toLowerCase();
  
  // Try to match name from loaded library
  if (countryFlagsData) {
    for (const [code, data] of Object.entries(countryFlagsData)) {
      if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) {
        return data.emoji;
      }
    }
  }
  
  if (lower.includes("united states") || lower.includes("america") || lower.includes("usa")) return "🇺🇸";
  if (lower.includes("canada")) return "🇨🇦";
  if (lower.includes("germany")) return "🇩🇪";
  if (lower.includes("france")) return "🇫🇷";
  if (lower.includes("india")) return "🇮🇳";
  if (lower.includes("united kingdom") || lower.includes("england") || lower.includes("uk")) return "🇬🇧";
  if (lower.includes("australia")) return "🇦🇺";
  if (lower.includes("singapore")) return "🇸🇬";
  if (lower.includes("netherlands")) return "🇳🇱";
  if (lower.includes("ukraine")) return "🇺🇦";
  if (lower.includes("italy")) return "🇮🇹";
  if (lower.includes("spain")) return "🇪🇸";
  if (lower.includes("japan")) return "🇯🇵";
  if (lower.includes("china")) return "🇨🇳";
  if (lower.includes("brazil")) return "🇧🇷";
  
  return "";
}

// --- Proxies ---
let currentProxiesList = []; // stores parsed proxy objects for easy addition/deletion

async function loadProxies() {
  const data = await API.getProxies();
  
  // Parse raw proxies to currentProxiesList
  const proxyLines = (data.proxies || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  
  currentProxiesList = proxyLines.map(line => {
    const [proxyPart, label] = line.split("#");
    const parts = proxyPart.split(":");
    return {
      host: parts[0] || "",
      port: parts[1] || "",
      username: parts[2] || "",
      password: parts[3] || "",
      label: label ? label.trim() : "",
      rawLine: line
    };
  }).filter(p => p.host && p.port);
  
  renderProxiesTable();
}

function renderProxiesTable() {
  const filterVal = document.getElementById("filter-proxy-country")?.value || "";
  
  let filteredList = currentProxiesList;
  if (filterVal === "unassigned") {
    filteredList = currentProxiesList.filter(p => !p.label);
  } else if (filterVal) {
    filteredList = currentProxiesList.filter(p => p.label === filterVal);
  }
  
  if (filteredList.length === 0) {
    el.proxiesTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 20px;">No proxies found matching filter.</td></tr>`;
    return;
  }
  
  el.proxiesTbody.innerHTML = filteredList.map(p => {
    const originalIndex = currentProxiesList.indexOf(p);
    const labelVal = p.label || "";
    const countryName = labelVal ? (countryFlagsData[labelVal]?.name || labelVal) : "-- No Country --";
    
    // Generate custom dropdown list containing CSS flags for each row
    const customSelect = `
      <div class="row-select">
        <div class="row-select-trigger" onclick="toggleRowSelect(${originalIndex}, event)">
          ${getFlagImgHtml(p.label, p.host)}
          <span>${countryName}</span>
          <span style="font-size: 0.75rem; color: var(--text-secondary);">▼</span>
        </div>
        <div class="row-select-options hidden" id="row-select-options-${originalIndex}">
          <div class="row-option" onclick="changeProxyCountry(${originalIndex}, '')">
            <span style="display:inline-block; width:20px; height:15px; margin-right:4px;"></span>
            <span>-- No Country --</span>
          </div>
          ${Object.entries(countryFlagsData || {}).map(([code, data]) => `
            <div class="row-option" onclick="changeProxyCountry(${originalIndex}, '${code}')">
              <span class="fi fi-${code.toLowerCase()}" style="border-radius: 2px; width: 20px; height: 15px; display: inline-block;"></span>
              <span>${data.name}</span>
            </div>
          `).join("")}
        </div>
      </div>
    `;
    
    return `
      <tr>
        <td><strong style="color: #60a5fa">${p.host}:${p.port}</strong></td>
        <td><code>${p.username || '-'}</code></td>
        <td><code>${p.password ? '••••••••' : '-'}</code></td>
        <td>
          ${customSelect}
        </td>
        <td><button class="danger-btn" onclick="deleteProxyAtIndex(${originalIndex})">Delete</button></td>
      </tr>
    `;
  }).join("");
}

// Function to save the current currentProxiesList back as raw text
async function saveProxiesList() {
  const rawText = currentProxiesList.map(p => {
    let line = `${p.host}:${p.port}`;
    if (p.username || p.password) {
      line += `:${p.username}`;
    }
    if (p.password) {
      line += `:${p.password}`;
    }
    if (p.label) {
      line += `#${p.label}`;
    }
    return line;
  }).join("\n");
  
  await API.saveProxies(rawText);
}

// Handler to toggle row country select dropdown
window.toggleRowSelect = (index, event) => {
  event.stopPropagation();
  // Close any other open dropdowns first
  document.querySelectorAll(".row-select-options").forEach(opt => {
    if (opt.id !== `row-select-options-${index}`) {
      opt.classList.add("hidden");
    }
  });
  const opt = document.getElementById(`row-select-options-${index}`);
  if (opt) opt.classList.toggle("hidden");
};

// Close all row dropdowns when clicking outside
document.addEventListener("click", () => {
  document.querySelectorAll(".row-select-options").forEach(opt => {
    opt.classList.add("hidden");
  });
});

// Handler to update country from table dropdown
window.changeProxyCountry = async (index, countryCode) => {
  currentProxiesList[index].label = countryCode;
  await saveProxiesList();
  renderProxiesTable();
  loadAccounts(); // Sync account dropdown labels
};

// Handler to delete a proxy
window.deleteProxyAtIndex = async (index) => {
  if (!confirm("Are you sure you want to delete this proxy?")) return;
  currentProxiesList.splice(index, 1);
  await saveProxiesList();
  renderProxiesTable();
  // Reload accounts table too since the available proxies list has changed
  loadAccounts();
};

// Modal events for Add Proxy
el.addProxyModalBtn.onclick = () => {
  el.proxyBulkInput.value = "";
  el.proxyCountry.value = "";
  const triggerSpan = document.querySelector("#proxy-country-trigger span");
  if (triggerSpan) triggerSpan.innerHTML = "-- Select Country (Optional) --";
  el.modalAddProxy.classList.remove("hidden");
};
el.cancelProxyBtn.onclick = () => el.modalAddProxy.classList.add("hidden");

// Handler to add new proxies via form (multi-line bulk support with optional country override)
el.addProxyBtn.onclick = async () => {
  const rawText = el.proxyBulkInput.value.trim();
  const selectedCountry = el.proxyCountry.value; // Get selected country from modal dropdown
  
  if (!rawText) return alert("Please enter at least one proxy!");
  
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let addedCount = 0;
  
  lines.forEach(line => {
    const [proxyPart, labelPart] = line.split("#");
    const parts = proxyPart.split(":");
    const host = parts[0] || "";
    const port = parts[1] || "";
    const username = parts[2] || "";
    const password = parts[3] || "";
    
    if (host && port) {
      // Use line label if present, otherwise default to selected country
      let label = labelPart ? labelPart.trim() : selectedCountry;
      
      // Auto-detect country code from label prefix if provided
      if (label) {
        const match = label.match(/^([a-zA-Z]{2})(?:[_-\s]|$)/);
        if (match) {
          label = match[1].toUpperCase();
        } else {
          // Match full name
          const lower = label.toLowerCase();
          if (countryFlagsData) {
            for (const [code, data] of Object.entries(countryFlagsData)) {
              if (lower === data.name.toLowerCase() || lower.includes(data.name.toLowerCase())) {
                label = code.toUpperCase();
                break;
              }
            }
          }
        }
      }
      
      currentProxiesList.push({ host, port, username, password, label });
      addedCount++;
    }
  });
  
  if (addedCount === 0) {
    return alert("No valid proxies found. Format: host:port:username:password#label");
  }
  
  el.addProxyBtn.textContent = "Adding...";
  await saveProxiesList();
  renderProxiesTable();
  loadAccounts(); // Update assignments dropdown
  
  // Clear inputs
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
  el.cookiesList.innerHTML = data.cookies.map(c => `
    <li>
      <div class="cookie-file-details">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-color); flex-shrink: 0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
        <span class="cookie-filename" title="${c}">${c}</span>
      </div>
      <button class="danger-btn" onclick="deleteCookie('${c}')" style="padding: 6px 12px; font-size: 0.8rem; margin: 0;">Remove</button>
    </li>
  `).join("");
  if(data.cookies.length === 0) {
    el.cookiesList.innerHTML = '<li style="grid-column: 1 / -1; justify-content: center; padding: 20px;"><span style="color:var(--text-secondary)">No cookies uploaded yet.</span></li>';
  }
}

window.deleteCookie = async (filename) => {
  if (!confirm(`Delete ${filename}?`)) return;
  await API.deleteCookie(filename);
  loadCookies();
};

// Drag & Drop / File Input
el.cookieDropzone.onclick = () => {
  el.cookieFile.click();
};
el.cookieDropzone.ondragover = (e) => { e.preventDefault(); el.cookieDropzone.classList.add("dragover"); };
el.cookieDropzone.ondragleave = () => el.cookieDropzone.classList.remove("dragover");
el.cookieDropzone.ondrop = (e) => {
  e.preventDefault();
  e.stopPropagation();
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
    const [searches, accounts, proxyData] = await Promise.all([
      API.getSearches(),
      API.getAccounts(),
      API.getProxies()
    ]);
    
    const fbSearches = searches.filter(s => s.platform === "facebook");
    
    // Parse proxies to show in dropdown
    const proxyLines = (proxyData.proxies || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
    const parsedProxies = proxyLines.map(line => {
      const [proxyPart, label] = line.split("#");
      const [host, port] = proxyPart.split(":");
      
      let flag = "";
      let labelText = label ? label.trim() : "";
      
      if (labelText) {
        flag = getFlagEmoji(labelText);
      } else {
        const ip = host;
        if (ipCountryCache[ip]) {
          const code = ipCountryCache[ip].toUpperCase();
          if (countryFlagsData && countryFlagsData[code]) {
            flag = countryFlagsData[code].emoji;
          }
        } else {
          triggerIpLookup(ip);
        }
      }
      
      const displayText = labelText 
        ? `${flag ? flag + ' ' : ''}${host}:${port} (${labelText})` 
        : `${flag ? flag + ' ' : ''}${host}:${port}`;
      return {
        key: `${host}:${port}`,
        label: labelText,
        displayText: displayText
      };
    }).filter(p => p.key);
    
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

window.changeAccountProxy = async (id, proxy) => {
  try {
    await API.assignProxy(id, proxy || null);
    loadAccounts();
  } catch (err) {
    alert("Failed to assign proxy: " + err.message);
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
            const location = payload.location || 'default';
            const key = `${l.platform}::${location}`;
            if (!latencyMap[key]) latencyMap[key] = { total: 0, count: 0, platform: l.platform, location: location };
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
