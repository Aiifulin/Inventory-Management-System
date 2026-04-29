import {
    collection, query, orderBy, getDocs, doc, getDoc, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { applyRoleBasedNavigation, isAdminUser, renderAccessDenied } from "./access-control.js";
import { db, auth, storage } from "./firebase.js";



// ============================================================
// CONSTANTS & STATE
// LOGS_CACHE_KEY — localStorage key for the activity logs cache
// CACHE_TTL_MS   — cache lifetime: 5 minutes in milliseconds
// FETCH_LIMIT    — max log entries fetched from Firestore per request
// PAGE_SIZE      — number of rows shown per page in the table
//
// allLogs       — full list of fetched log entries
// filteredLogs  — the subset currently shown after search/sort
// currentPage   — the active pagination page (1-based)
// sortDir       — 'asc' or 'desc'; toggled by clicking the date header
// isLogsLoading — true while Firestore fetch is in progress; blocks renders
// ============================================================
const LOGS_CACHE_KEY = 'activity_logs_cache';
const CACHE_TTL_MS   = 5 * 60 * 1000;
const FETCH_LIMIT    = 200;
const PAGE_SIZE      = 10;
const USER_NAME_LOOKUP_KEY = 'activity_user_name_lookup';

let allLogs       = [];
let filteredLogs  = [];
let currentPage   = 1;
let sortDir       = 'desc';
let isLogsLoading = true;

// ============================================================
// SECTION 1 — CACHE HELPERS
// Logs are cached in localStorage (not sessionStorage) with a
// 5-minute TTL. localStorage is used here so the cache survives
// tab refreshes, unlike the product/user caches which use
// sessionStorage and reset on close.
// ============================================================

/** Serialises the logs array and writes it to localStorage with a timestamp. */
function saveLogsCache(logs) {
    try {
        localStorage.setItem(LOGS_CACHE_KEY, JSON.stringify({ logs, cachedAt: Date.now() }));
    } catch (e) {
        console.warn("Could not save logs cache:", e);
    }
}

/**
 * Reads and parses the logs cache from localStorage.
 * Returns null if nothing is cached, the TTL has expired, or JSON parsing fails.
 */
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

/**
 * Escapes text before inserting it into table HTML.
 * @param {string} value
 * @returns {string}
 */
function escHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

// ============================================================
// SECTION 2 — USER DATA CACHE
// Fetches the current user's Firestore document (name, role).
// Cached per-UID in sessionStorage so repeat visits within the
// same tab skip the Firestore read entirely.
// ============================================================

/**
 * Returns the user's Firestore document data, reading from sessionStorage
 * if available or fetching from Firestore and caching the result.
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null}
 */
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

/**
 * Builds a lookup of user emails to display names. Activity entries store
 * the email in `user`, so this lets the logs show names without changing
 * older activity documents.
 * @returns {Promise<Object>}
 */
async function getUserNameLookup() {
    try {
        const cached = sessionStorage.getItem(USER_NAME_LOOKUP_KEY);
        if (cached) return JSON.parse(cached);

        const lookup = {};
        const snapshot = await getDocs(collection(db, "users"));
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.email && data.name) {
                lookup[data.email.toLowerCase()] = data.name;
            }
        });

        sessionStorage.setItem(USER_NAME_LOOKUP_KEY, JSON.stringify(lookup));
        return lookup;
    } catch (err) {
        console.error("Error fetching user name lookup:", err);
        return {};
    }
}

/**
 * Adds displayUser to each log. Falls back to the original stored user value
 * when no matching account name exists.
 * @param {Array} logs
 */
async function hydrateLogUsers(logs) {
    const lookup = await getUserNameLookup();
    logs.forEach((log) => {
        const storedUser = log.user || 'Admin';
        log.displayUser = lookup[String(storedUser).toLowerCase()] || storedUser;
    });
}

// ============================================================
// SECTION 3 — AUTH LISTENER
// Runs once on page load. Redirects unauthenticated users to login.
// Fires getCachedUserData() and initLogs() simultaneously via
// Promise.all so the sidebar name and the log table both load
// as fast as possible without waiting on each other.
// Makes .main-content visible only after auth resolves, preventing
// a flash of unstyled/unauthorised content.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    // 🔥 Fire user data AND logs fetch simultaneously
    const userData = await getCachedUserData(user.uid);
    const isAdmin = isAdminUser(userData);

    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }
    applyRoleBasedNavigation(isAdmin);

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

    const main = document.querySelector('.main-content');
    if (!isAdmin) {
        renderAccessDenied(main, "Activity Logs");
        if (main) main.style.visibility = 'visible';
        return;
    }

    await initLogs();
    if (main) main.style.visibility = 'visible';
});

// ============================================================
// SECTION 4 — CORE: INIT & FETCH
// ============================================================

/**
 * Entry point for loading the activity log table.
 * Serves from cache on normal visits; fetches fresh data when
 * forceRefresh=true (triggered by the Refresh button) or when
 * the cache is missing or expired.
 * @param {boolean} forceRefresh
 */
async function initLogs(forceRefresh = false) {
    setLogsLoading(true);

    if (!forceRefresh) {
        const cached = loadLogsCache();
        if (cached) {
            allLogs = cached;
            await hydrateLogUsers(allLogs);
            setLogsLoading(false);
            applyFilterAndRender();
            return;
        }
    }

    await fetchAndCacheLogs();
}

/**
 * Fetches the most recent FETCH_LIMIT activity log entries from
 * Firestore, ordered by timestamp descending.
 * Converts each Firestore Timestamp to an ISO string before storing
 * so the data is safely JSON-serialisable for caching.
 * Saves the result to localStorage via saveLogsCache(), then
 * triggers applyFilterAndRender() to populate the table.
 */
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
                displayUser: data.displayUser || data.user || 'Admin',
                timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
            });
        });

        await hydrateLogUsers(allLogs);

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

/**
 * Toggles the skeleton loader visibility and shows/hides the
 * log table wrapper and pagination bar.
 * Called with true at the start of a fetch and false on completion.
 * @param {boolean} loading
 */
function setLogsLoading(loading) {
    isLogsLoading = loading;
    document.getElementById('logsSkeleton')?.classList.toggle('visible', loading);
    document.getElementById('logsTableWrapper')?.classList.toggle('hidden', loading);
    document.getElementById('paginationBar')?.classList.toggle('hidden', loading);
}

// ============================================================
// SECTION 5 — FILTER + SORT + RENDER
// applyFilterAndRender() is called on every search input change
// or sort toggle. It filters allLogs by the search term (matched
// against action, target, user, and formatted date strings),
// sorts by timestamp, resets to page 1, then calls renderPage().
//
// renderPage() is the only function that writes to the DOM. It
// slices filteredLogs to the current page window, builds the
// table rows, colours action badges by type, and updates the
// pagination controls.
// ============================================================

/**
 * Filters allLogs against the current search input, sorts by timestamp,
 * resets to page 1, and calls renderPage() to update the DOM.
 */
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
               (log.displayUser || '').toLowerCase().includes(search) ||
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

/**
 * Renders the current page of filteredLogs into the log table.
 * Calculates the correct slice from filteredLogs based on currentPage
 * and PAGE_SIZE, then builds a table row per entry.
 *
 * Badge colour is assigned by action keyword:
 *   green  → "add"
 *   red    → "delete"
 *   orange → "archive" or "restore"
 *   blue   → everything else (default)
 *
 * Also updates the total count label and enables/disables the
 * previous/next pagination buttons.
 */
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
                    <td><span class="badge ${badgeClass}">${escHtml(log.action)}</span></td>
                    <td>${escHtml(log.target)}</td>
                    <td>${escHtml(log.displayUser || log.user)}</td>
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

// ============================================================
// SECTION 6 — REFRESH LOADING STATE
// ============================================================

/**
 * Toggles the disabled state and .loading class on the Refresh button.
 * The .loading class triggers a spin animation on the button icon.
 * Kept separate from setLogsLoading() because the refresh button
 * needs its own loading state independent of the skeleton loader.
 * @param {boolean} isLoading
 */
function setRefreshLoading(isLoading) {
    const btn = document.getElementById('refreshLogsBtn');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.classList.toggle('loading', isLoading);
}

// ============================================================
// SECTION 7 — EVENT LISTENERS
// All interactivity is wired here inside DOMContentLoaded.
//
// dateHeader click  — toggles sortDir and updates the sort icon
// logSearch input   — re-runs filter/render on every keystroke
// refreshLogsBtn    — clears the localStorage cache and force-fetches
// prevPageBtn       — decrements currentPage and scrolls to top
// nextPageBtn       — increments currentPage and scrolls to top
// hamburger/overlay — toggle the mobile sidebar open/closed
// ============================================================
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
        sessionStorage.removeItem(USER_NAME_LOOKUP_KEY);
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

// ============================================================
// EXPORTS
// Named exports allow other modules and test suites to import
// individual helpers directly without pulling in the full module.
// ============================================================
export { 
    getCachedUserData, 
    saveLogsCache, 
    loadLogsCache, 
    fetchAndCacheLogs, 
    applyFilterAndRender, 
    renderPage, 
    initLogs };
