import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getFirestore, collection, query, orderBy, getDocs, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { initializeFirestore, persistentLocalCache } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);


const db = initializeFirestore(app, {
    localCache: persistentLocalCache()
});

// ================================================
// CONSTANTS & STATE
// ================================================
const LOGS_CACHE_KEY = 'activity_logs_cache';
const PAGE_SIZE      = 10;

let allLogs      = [];   // full cached dataset
let filteredLogs = [];   // after search filter applied
let currentPage  = 1;
let sortDir      = 'desc';
let isLogsLoading = true;

// ================================================
// USER DATA CACHE (shared pattern)
// ================================================
async function getCachedUserData(uid) {
    const key    = `user_data_${uid}`;
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached);

    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            sessionStorage.setItem(key, JSON.stringify(snap.data()));
            return snap.data();
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

async function displayUserName(uid) {
    const nameEl = document.getElementById('userNameDisplay');
    if (!nameEl) return;

    const userData = await getCachedUserData(uid);
    const name = userData?.name || "User";
    
    nameEl.textContent = name;
}


async function checkAdminRole(uid) {
    const data = await getCachedUserData(uid);
    return data?.role?.toLowerCase() === 'admin';
}

// ================================================
// LOG CACHE HELPERS
// ================================================
function saveLogsCache(logs) {
    sessionStorage.setItem(LOGS_CACHE_KEY, JSON.stringify(logs));
}

function loadLogsCache() {
    try {
        const raw = sessionStorage.getItem(LOGS_CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// ================================================
// AUTH
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }

    await displayUserName(user.uid);
    document.documentElement.style.visibility = "visible";

    await initLogs();
    // =======================================================
    // Logout Confirmation Modal (shared pattern with Dashboard)
    // =======================================================
    const doSignOut = () => {
        localStorage.removeItem("user_session"); localStorage.removeItem("user_uid"); localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };
});

// ================================================
// CORE: INIT & FETCH
// ================================================
async function initLogs(forceRefresh = false) {
    setLogsLoading(true);
    const cached = loadLogsCache();

    if (!forceRefresh && cached) {
        allLogs = cached;
        setLogsLoading(false);
        applyFilterAndRender();
        return;
    }

    await fetchAndCacheLogs();
}

async function fetchAndCacheLogs() {
    setRefreshLoading(true);

    try {
        // Fetch ALL logs ordered by timestamp — we handle pagination client-side
        const q        = query(collection(db, "activities"), orderBy("timestamp", "desc"));
        const snapshot = await getDocs(q);

        allLogs = [];
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            allLogs.push({
                id:        docSnap.id,
                action:    data.action    || '',
                target:    data.target    || '',
                user:      data.user      || 'Admin',
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            });
        });

        saveLogsCache(allLogs);

    } catch (err) {
        console.error("Error fetching logs:", err);
        allLogs = [];
    } finally {
        setRefreshLoading(false);
        setLogsLoading(false);
        applyFilterAndRender();
    }
}

function setLogsLoading(loading) {
    isLogsLoading = loading;

    const skeleton = document.getElementById('logsSkeleton');
    const tableWrapper = document.getElementById('logsTableWrapper');
    const paginationBar = document.getElementById('paginationBar');

    skeleton?.classList.toggle('visible', loading);
    tableWrapper?.classList.toggle('hidden', loading);
    paginationBar?.classList.toggle('hidden', loading);
}

// ================================================
// FILTER + SORT + RENDER
// ================================================
function applyFilterAndRender() {
    const search = (document.getElementById('logSearch')?.value || '').toLowerCase();

    // 1. Filter
    filteredLogs = allLogs.filter(log => {
        // Build searchable date string from stored ISO timestamp
        let logDate = "";
        if (log.timestamp) {
            const d = new Date(log.timestamp);
            logDate  = d.toLocaleString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            }).toLowerCase();
            // Also add short month so "mar" matches "March"
            logDate += " " + d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            // Also add numeric format so "3/17" or "2026" matches
            logDate += " " + d.toLocaleDateString('en-US');
        }
    
        return log.action.toLowerCase().includes(search) ||
               log.target.toLowerCase().includes(search) ||
               log.user.toLowerCase().includes(search)   ||
               logDate.includes(search);
    });

    // 2. Sort (allLogs comes from Firestore already desc, but re-sort after filter)
    filteredLogs.sort((a, b) => {
        const tA = a.timestamp ? new Date(a.timestamp) : 0;
        const tB = b.timestamp ? new Date(b.timestamp) : 0;
        return sortDir === 'desc' ? tB - tA : tA - tB;
    });

    // 3. Reset to page 1 on any filter/sort change
    currentPage = 1;

    renderPage();
}

function renderPage() {
    const table = document.getElementById('logTable');
    if (!table) return;
    if (isLogsLoading) return;

    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start    = (currentPage - 1) * PAGE_SIZE;
    const end      = start + PAGE_SIZE;
    const pageRows = filteredLogs.slice(start, end);

    // --- Table rows ---
    if (filteredLogs.length === 0) {
        table.innerHTML = `
            <tr class="log-empty-row">
                <td colspan="4">No activity logs found.</td>
            </tr>`;
    } else {
        table.innerHTML = pageRows.map(log => {
            const dateStr = log.timestamp
                ? new Date(log.timestamp).toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                  })
                : '—';

            const action = log.action.toLowerCase();
            let badgeClass = 'blue';
            if (action.includes('add'))    badgeClass = 'green';
            if (action.includes('delete')) badgeClass = 'red';
            if (action.includes('archive') || action.includes('restore')) badgeClass = 'orange';

            return `
                <tr>
                    <td>${dateStr}</td>
                    <td><span class="badge ${badgeClass}">${log.action}</span></td>
                    <td>${log.target}</td>
                    <td>${log.user}</td>
                </tr>`;
        }).join('');
    }

    // --- Total label ---
    const totalLabel = document.getElementById('logsTotalLabel');
    if (totalLabel) {
        totalLabel.textContent = filteredLogs.length > 0
            ? `${filteredLogs.length} log${filteredLogs.length !== 1 ? 's' : ''} found`
            : '';
    }

    // --- Pagination controls ---
    const pageInfo   = document.getElementById('pageInfo');
    const prevBtn    = document.getElementById('prevPageBtn');
    const nextBtn    = document.getElementById('nextPageBtn');

    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    if (prevBtn)  prevBtn.disabled = currentPage <= 1;
    if (nextBtn)  nextBtn.disabled = currentPage >= totalPages;
}

// ================================================
// REFRESH LOADING STATE
// ================================================
function setRefreshLoading(isLoading) {
    const btn = document.getElementById('refreshLogsBtn');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.classList.toggle('loading', isLoading);
}

// ================================================
// TIME FORMATTER
// ================================================
function formatTimeAgo(date) {
    const diffInSeconds = Math.floor((new Date() - date) / 1000);
    if (diffInSeconds < 60) return "Just now";
    const mins = Math.floor(diffInSeconds / 60);
    if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`;
    return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ================================================
// EVENT LISTENERS
// ================================================
document.addEventListener("DOMContentLoaded", () => {

    // --- Sort by date ---
    document.getElementById('dateHeader')?.addEventListener('click', () => {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        const icon = document.getElementById('sortIcon');
        if (icon) {
            icon.className = sortDir === 'desc'
                ? 'fas fa-sort-down'
                : 'fas fa-sort-up';
        }
        applyFilterAndRender();
    });

    // --- Search (filters cached data, no Firestore call) ---
    document.getElementById('logSearch')?.addEventListener('input', () => {
        applyFilterAndRender();
    });

    // --- Refresh button (force fetch from Firestore) ---
    document.getElementById('refreshLogsBtn')?.addEventListener('click', () => {
        initLogs(true);
    });

    // --- Pagination ---
    document.getElementById('prevPageBtn')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            renderPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    document.getElementById('nextPageBtn')?.addEventListener('click', () => {
        const totalPages = Math.ceil(filteredLogs.length / PAGE_SIZE);
        if (currentPage < totalPages) {
            currentPage++;
            renderPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    // --- Sidebar ---
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn     = document.getElementById('closeBtn');
    const sidebar      = document.getElementById('sidebar');
    const overlay      = document.getElementById('overlay');

    function toggleSidebar() { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); }
    function closeSidebar()  { sidebar.classList.remove('open'); overlay.classList.remove('show'); }

    hamburgerBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
    closeBtn?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
});

