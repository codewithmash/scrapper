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
  getListings: async () => {
    const res = await fetch("/api/listings/new", { headers: { "x-api-key": apiKey } });
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
    document.getElementById(btn.dataset.tab).classList.remove("hidden");
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

// Boot
checkAuth();
