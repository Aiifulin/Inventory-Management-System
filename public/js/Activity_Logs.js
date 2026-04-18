import {
    collection, query, orderBy, getDocs, doc, getDoc, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


// ================================================
// CONSTANTS & STATE
// ================================================
const LOGS_CACHE_KEY = 'activity_logs_cache';
const CACHE_TTL_MS   = 5 * 60 * 1000;
const FETCH_LIMIT    = 200;
const PAGE_SIZE      = 10;

let allLogs       = [];
let filteredLogs  = [];
let currentPage   = 1;
let sortDir       = 'desc';
let isLogsLoading = true;

// ================================================
// CACHE HELPERS
// ================================================
function saveLogsCache(logs) {
    try {
        localStorage.setItem(LOGS_CACHE_KEY, JSON.stringify({ logs, cachedAt: Date.now() }));
    } catch (e) {
        console.warn("Could not save logs cache:", e);
    }
}

function loadLogsCache() {
    try {
        const raw = localStorage.getItem(LOGS_CACHE_KEY);
        if (!raw) return null;
        const { logs, cachedAt } = JSON.parse(raw);
        if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
        return logs;
    } catch {
        return null;
    }
}

// ================================================
// USER DATA CACHE
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

// ================================================
// AUTH — parallel: user data + logs fire at the same time
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    // 🔥 Fire user data AND logs fetch simultaneously
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        initLogs()
    ]);

    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) nameEl.textContent = userData?.name || "User";

    document.querySelector('.main-content').style.visibility = 'visible';

    // Logout modal
    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
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

    if (!forceRefresh) {
        const cached = loadLogsCache();
        if (cached) {
            allLogs = cached;
            setLogsLoading(false);
            applyFilterAndRender();
            return;
        }
    }

    await fetchAndCacheLogs();
}

async function fetchAndCacheLogs() {
    setRefreshLoading(true);
    try {
        const q = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            limit(FETCH_LIMIT)
        );
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
    document.getElementById('logsSkeleton')?.classList.toggle('visible', loading);
    document.getElementById('logsTableWrapper')?.classList.toggle('hidden', loading);
    document.getElementById('paginationBar')?.classList.toggle('hidden', loading);
}

// ================================================
// FILTER + SORT + RENDER
// ================================================
function applyFilterAndRender() {
    const search = (document.getElementById('logSearch')?.value || '').toLowerCase();

    filteredLogs = allLogs.filter(log => {
        let logDate = "";
        if (log.timestamp) {
            const d = new Date(log.timestamp);
            logDate  = d.toLocaleString('en-US', {
                month: 'long', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            }).toLowerCase();
            logDate += " " + d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
            logDate += " " + d.toLocaleDateString('en-US');
        }
        return log.action.toLowerCase().includes(search) ||
               log.target.toLowerCase().includes(search) ||
               log.user.toLowerCase().includes(search)   ||
               logDate.includes(search);
    });

    filteredLogs.sort((a, b) => {
        const tA = a.timestamp ? new Date(a.timestamp) : 0;
        const tB = b.timestamp ? new Date(b.timestamp) : 0;
        return sortDir === 'desc' ? tB - tA : tA - tB;
    });

    currentPage = 1;
    renderPage();
}

function renderPage() {
    const table = document.getElementById('logTable');
    if (!table || isLogsLoading) return;

    const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start    = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filteredLogs.slice(start, start + PAGE_SIZE);

    if (filteredLogs.length === 0) {
        table.innerHTML = `<tr class="log-empty-row"><td colspan="4">No activity logs found.</td></tr>`;
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

    const totalLabel = document.getElementById('logsTotalLabel');
    if (totalLabel) {
        totalLabel.textContent = filteredLogs.length > 0
            ? `${filteredLogs.length} log${filteredLogs.length !== 1 ? 's' : ''} found`
            : '';
    }

    const pageInfo = document.getElementById('pageInfo');
    const prevBtn  = document.getElementById('prevPageBtn');
    const nextBtn  = document.getElementById('nextPageBtn');
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
// EVENT LISTENERS
// ================================================
document.addEventListener("DOMContentLoaded", () => {

    document.getElementById('dateHeader')?.addEventListener('click', () => {
        sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        const icon = document.getElementById('sortIcon');
        if (icon) icon.className = sortDir === 'desc' ? 'fas fa-sort-down' : 'fas fa-sort-up';
        applyFilterAndRender();
    });

    document.getElementById('logSearch')?.addEventListener('input', applyFilterAndRender);

    document.getElementById('refreshLogsBtn')?.addEventListener('click', () => {
        localStorage.removeItem(LOGS_CACHE_KEY);
        initLogs(true);
    });

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

    // Sidebar
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn     = document.getElementById('closeBtn');
    const sidebar      = document.getElementById('sidebar');
    const overlay      = document.getElementById('overlay');

    const toggleSidebar = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
    const closeSidebar  = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

    hamburgerBtn?.addEventListener('click', e => { e.stopPropagation(); toggleSidebar(); });
    closeBtn?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
});