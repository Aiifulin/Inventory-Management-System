// ============================================================
// Dashboard.js
// Handles all data fetching, rendering, and UI logic for the
// main dashboard page of the Inventory Management System.
// ============================================================

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { collection, query, orderBy, limit, where, doc, getDoc, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBALS
// barChartInstance — holds the active Chart.js bar chart so we
//   can destroy it before re-rendering (prevents canvas errors).
// dashboardStage   — a temporary object that accumulates fetched
//   data during a refresh cycle before it's written to cache.
// CACHE_KEY        — sessionStorage key for the dashboard cache.
// ============================================================
let barChartInstance = null;
let dashboardStage = {};
const CACHE_KEY = 'dashboard_cache';


// ============================================================
// SECTION 1 — CACHE HELPERS
// We cache dashboard data in sessionStorage so that navigating
// back to the dashboard doesn't trigger another full Firestore
// read. Cache is cleared on manual refresh or sign-out.
// ============================================================

/** Serialises and saves the dashboard data object to sessionStorage. */
function saveCache(data) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
}

/**
 * Reads and parses the cached dashboard data.
 * Returns null if nothing is cached or the JSON is corrupt.
 */
function loadCache() {
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

/** Removes the dashboard cache (called before a forced refresh). */
function clearCache() {
    sessionStorage.removeItem(CACHE_KEY);
}

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Results are cached per-UID in sessionStorage so repeat page visits
 * don't cost an extra read.
 *
 * @param {string} uid — Firebase Auth UID of the logged-in user.
 * @returns {Object|null} — user data object, or null on failure.
 */
async function getCachedUserData(uid) {
    const CACHE_KEY_USER = `user_data_${uid}`;
    const cached = sessionStorage.getItem(CACHE_KEY_USER);
    if (cached) return JSON.parse(cached);
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            sessionStorage.setItem(CACHE_KEY_USER, JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}


// ============================================================
// SECTION 2 — AUTH LISTENER
// Runs once on page load. If no user is signed in, we redirect
// to the login page immediately. Otherwise we fire the user-data
// fetch and the dashboard data load in parallel (Promise.all) so
// neither has to wait for the other.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    // Fire both requests simultaneously instead of sequentially.
    // loadDashboard() starts rendering from cache right away if available.
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        loadDashboard()
    ]);

    // Update the sidebar name badge once user data arrives.
    const isAdmin = userData?.role?.toLowerCase() === 'admin';
    const nameEl  = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    // Only admins can see the "Add Product" button.
    const addBtn = document.getElementById('addProductBtn');
    if (addBtn) addBtn.style.display = isAdmin ? 'flex' : 'none';

    // Wire up the logout modal with a sign-out callback that clears
    // all local/session storage and signs the user out of Firebase.
    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth)
            .then(() => window.location.replace("index.html"))
            .catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };
});


// ============================================================
// SECTION 3 — CORE LOAD FUNCTION
// loadDashboard() is the single entry point for populating the
// dashboard. On first visit (or after a forced refresh) it calls
// fetchAndCache(). On subsequent visits it restores the UI from
// the cached snapshot instantly.
// ============================================================

/**
 * Loads the dashboard, either from cache or by fetching fresh data.
 *
 * @param {boolean} forceRefresh — when true, bypasses cache and
 *   re-fetches everything from Firestore.
 */
async function loadDashboard(forceRefresh = false) {
    const cached = loadCache();

    if (!forceRefresh && cached) {
        // Restore all UI elements from the cached snapshot.
        updateStat("statTotalProducts", cached.totalProducts);
        updateStat("statLowStock",      cached.lowStockCount);
        updateStat("statCategories",    cached.categoryCount);
        updateStat("statTotalValue",    cached.totalValue);
        updateStat("statStockIn", cached.stockIn?.toLocaleString() ?? "—");
        updateStat("statSold",    cached.sold?.toLocaleString()    ?? "—");
        initCharts(cached.categoryMap);
        renderLowStockTable(cached.lowStockItems);
        renderActivities(cached.activities);
        return;
    }

    // No cache or forced refresh — fetch from Firestore.
    await fetchAndCache();
}

/**
 * Orchestrates all parallel Firestore fetches, then saves the
 * combined result to cache. Also manages the loading state of
 * the Refresh button.
 */
async function fetchAndCache() {
    dashboardStage = {};
    setRefreshLoading(true);

    try {
        // Run all four data-fetching tasks simultaneously so the
        // dashboard loads as fast as the slowest individual query.
        await Promise.all([
            loadStats(),
            loadRecentActivities(),
            loadCategoryCount(),
            loadMonthlyTxStats()
        ]);
        saveCache(dashboardStage);
    } catch (err) {
        console.error("Dashboard load error:", err);
    } finally {
        setRefreshLoading(false);
    }
}

/**
 * Toggles the visual loading state of the Refresh button.
 * The .loading class triggers the spin animation on the icon.
 *
 * @param {boolean} isLoading
 */
function setRefreshLoading(isLoading) {
    const btn = document.getElementById('refreshBtn');
    if (!btn) return;
    btn.disabled = isLoading;
    btn.classList.toggle('loading', isLoading);
}


// ============================================================
// SECTION 4 — DATA LOADERS
// Each function fetches one slice of dashboard data from
// Firestore, updates the relevant DOM elements immediately, and
// stores its result in dashboardStage for later caching.
// ============================================================

/**
 * Fetches all non-archived products and derives:
 *   - total product count
 *   - total inventory value (stock × price for every product)
 *   - low-stock items (stock ≤ threshold)
 *   - per-category count and value (used by the bar chart)
 *
 * Uses a server-side `where("archived", "==", false)` filter so
 * archived products are never downloaded to the client.
 */
async function loadStats() {
    const q = query(
        collection(db, "products"),
        where("archived", "==", false)
    );
    const snapshot = await getDocs(q);

    const products      = [];
    const lowStockItems = [];
    const categoryMap   = {};

    snapshot.forEach((docSnap) => {
        const p = docSnap.data();

        products.push(p);

        const stock     = Number(p.stock) || 0;
        const price     = Number(p.price) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;
        const cat       = p.category || "Uncategorized";

        // Build the category roll-up used by the bar chart.
        if (!categoryMap[cat]) categoryMap[cat] = { count: 0, value: 0 };
        categoryMap[cat].count += 1;
        categoryMap[cat].value += stock * price;

        // Flag any product at or below its low-stock threshold.
        if (stock <= threshold) {
            lowStockItems.push({ name: p.name, stock, imageUrl: p.imageUrl || null, threshold });
        }
    });

    const totalValue = products.reduce((sum, p) =>
        sum + ((Number(p.price) || 0) * (Number(p.stock) || 0)), 0);

    const formattedValue = totalValue.toLocaleString('en-PH', {
        style: 'currency', currency: 'PHP', minimumFractionDigits: 2
    });

    // Immediately update the stat cards.
    updateStat("statTotalProducts", products.length);
    updateStat("statLowStock",      lowStockItems.length);
    updateStat("statTotalValue",    formattedValue);
    initCharts(categoryMap);
    renderLowStockTable(lowStockItems);

    // Stage data for caching.
    dashboardStage.totalProducts = products.length;
    dashboardStage.lowStockCount = lowStockItems.length;
    dashboardStage.totalValue    = formattedValue;
    dashboardStage.categoryMap   = categoryMap;
    dashboardStage.lowStockItems = lowStockItems;
}

/**
 * Fetches the 5 most recent activity log entries (ordered by
 * timestamp descending) and hands them to renderActivities().
 * Activity data is also staged for caching.
 */
async function loadRecentActivities() {
    const q = query(
        collection(db, "activities"),
        orderBy("timestamp", "desc"),
        limit(5)
    );
    const snapshot = await getDocs(q);

    const activities = [];
    snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        activities.push({
            user:      data.user   || 'Admin',
            action:    data.action || '',
            target:    data.target || '',
            // Convert Firestore Timestamp to an ISO string for safe caching.
            timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
        });
    });

    dashboardStage.activities = activities;
    renderActivities(activities);
}

/**
 * Counts all non-archived categories and updates the Categories
 * stat card. Uses a server-side filter to avoid fetching archived
 * documents unnecessarily.
 */
async function loadCategoryCount() {
    const q = query(
        collection(db, "categories"),
        where("archived", "==", false)
    );
    const snapshot = await getDocs(q);
    updateStat("statCategories", snapshot.size);
    dashboardStage.categoryCount = snapshot.size;
}

/**
 * Reads this month's stock transactions and sums up:
 *   - stockIn — total units received (type === "Stock In")
 *   - sold     — total units sold    (type === "Sold")
 * Cancelled transactions are excluded from both totals.
 *
 * Transactions live in a subcollection keyed by year:
 *   stock_transactions/{year}/transactions
 */
async function loadMonthlyTxStats() {
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentYear = now.getFullYear();

    try {
        const snap = await getDocs(
            query(
                collection(db, "stock_transactions", String(currentYear), "transactions"),
                where("createdAt", ">=", Timestamp.fromDate(thisMonthStart))
            )
        );

        let stockIn = 0, sold = 0;
        snap.forEach(docSnap => {
            const d = docSnap.data();
            if (d.status === "Cancelled") return; // Skip cancelled transactions.
            const qty = Number(d.qty) || 0;
            if (d.type === "Stock In") stockIn += qty;
            else if (d.type === "Sold") sold += qty;
        });

        updateStat("statStockIn", stockIn.toLocaleString());
        updateStat("statSold", sold.toLocaleString());

        // Stage for caching.
        dashboardStage.stockIn = stockIn;
        dashboardStage.sold = sold;
    } catch (e) {
        console.error("loadMonthlyTxStats:", e);
        // Fall back to dashes if the query fails (e.g. missing index).
        updateStat("statStockIn", "—");
        updateStat("statSold", "—");
    }
}


// ============================================================
// SECTION 5 — RENDER HELPERS
// Pure DOM-manipulation functions. They receive plain data and
// write HTML — no Firestore calls happen inside these functions.
// ============================================================

/**
 * Renders the Low Stock Alert table.
 * - Items are sorted ascending by stock level (worst first).
 * - Only the top 5 are shown; a "and X more" footer link is
 *   appended when there are additional items.
 *
 * @param {Array} items — array of { name, stock, imageUrl, threshold }
 */
function renderLowStockTable(items) {
    const tableBody = document.querySelector('#lowStockTable tbody');
    if (!tableBody) return;

    if (items.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align:center; padding:20px; color:#9ca3af;">
                    All products are well stocked!
                </td>
            </tr>`;
        return;
    }

    items.sort((a, b) => a.stock - b.stock);

    // Update the badge counter in the card header.
    const badge = document.getElementById('lowStockBadge');
    if (badge && items.length > 0) {
        badge.textContent = items.length;
        badge.style.display = 'inline';
    }

    const displayItems = items.slice(0, 5);
    const remaining    = items.length - displayItems.length;

    let html = '';
    displayItems.forEach(item => {
        const pillClass  = item.stock === 0 ? "pill-red"    : "pill-orange";
        const statusText = item.stock === 0 ? "Out of Stock" : "Low Stock";

        // Show product image if available; fallback to a box icon placeholder.
        const imgTag = item.imageUrl
            ? `<img src="${item.imageUrl}" class="sm-product-img" alt="img">`
            : `<div style="display:inline-block;width:32px;height:32px;background:#f3f4f6;border-radius:6px;margin-right:10px;vertical-align:middle;text-align:center;line-height:32px;">
                <i class="fas fa-box" style="font-size:12px;color:#9ca3af;"></i>
               </div>`;

        html += `
            <tr>
                <td>${imgTag}<span style="font-weight:500;">${item.name}</span></td>
                <td style="font-family:monospace;font-size:14px;">${item.stock}</td>
                <td><span class="pill ${pillClass}">${statusText}</span></td>
            </tr>`;
    });

    // "and X more" overflow row linking to the Products page.
    if (remaining > 0) {
        html += `
            <tr>
                <td colspan="3" style="text-align:center;padding:10px;font-size:13px;color:var(--text-secondary);">
                    and <a href="Products.html" style="color:#f97316;font-weight:600;text-decoration:none;">${remaining} more</a> low stock item${remaining !== 1 ? 's' : ''} — 
                    <a href="Products.html" style="color:var(--text-secondary);font-size:12px;">view all</a>
                </td>
            </tr>`;
    }

    tableBody.innerHTML = html;
}

/**
 * Renders the Recent Activities feed.
 * Chooses an icon and colour based on keywords in the action string:
 *   "add"    → green plus
 *   "edit" / "update" → blue pen
 *   "delete" / "remove" → red trash
 *
 * @param {Array} activities — array of { user, action, target, timestamp }
 */
function renderActivities(activities) {
    const container = document.querySelector('.activity-content');
    if (!container) return;

    if (!activities || activities.length === 0) {
        container.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; color:#9ca3af;">
                <i class="fas fa-history" style="font-size:24px; margin-bottom:10px;"></i>
                <span>No recent activities found.</span>
            </div>`;
        return;
    }

    let html = '<ul class="activity-list">';

    activities.forEach((data) => {
        const timeString  = data.timestamp ? formatTimeAgo(new Date(data.timestamp)) : "Just now";
        const actionLower = data.action.toLowerCase();

        let iconClass  = "fa-info";
        let colorClass = "";

        if (actionLower.includes("add")) {
            iconClass = "fa-plus";  colorClass = "act-add";
        } else if (actionLower.includes("edit") || actionLower.includes("update")) {
            iconClass = "fa-pen";   colorClass = "act-edit";
        } else if (actionLower.includes("delete") || actionLower.includes("remove")) {
            iconClass = "fa-trash"; colorClass = "act-delete";
        }

        html += `
            <li class="activity-item">
                <div class="activity-icon-box ${colorClass}">
                    <i class="fas ${iconClass}"></i>
                </div>
                <div class="activity-details">
                    <p class="activity-text">
                        <strong>${data.user}</strong> ${data.action}: ${data.target}
                    </p>
                    <p class="activity-meta">${timeString}</p>
                </div>
            </li>`;
    });

    html += '</ul>';
    container.innerHTML = html;
}


// ============================================================
// SECTION 6 — CHARTS
// Uses Chart.js to render a bar chart of products per category.
// Supports toggling between "count" and "value (₱)" modes.
// The active chart instance is stored globally so it can be
// destroyed before re-initialising (avoids canvas reuse errors).
// ============================================================

/**
 * Creates (or recreates) the bar chart from a category data map.
 * Also stores the raw data on window._chartModeData so the toggle
 * buttons can switch modes without hitting Firestore again.
 *
 * @param {Object} dataMap — { categoryName: { count, value }, … }
 */
function initCharts(dataMap) {
    const labels = Object.keys(dataMap);
    const counts = labels.map(cat => dataMap[cat].count);
    const values = labels.map(cat => dataMap[cat].value);

    const isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#e5e7eb' : '#374151';
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    const chartColors = ['#0f172a','#3b82f6','#64748b','#cbd5e1','#f59e0b','#10b981','#ef4444'];

    const ctx = document.getElementById('barChart');
    if (!ctx) return;

    // Destroy the previous instance to prevent "canvas already in use" errors.
    if (barChartInstance) barChartInstance.destroy();

    barChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Products',
                data: counts,
                backgroundColor: chartColors.map((c, i) => chartColors[i % chartColors.length]),
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, ticks: { stepSize: 1, color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { display: false } }
            }
        }
    });

    // Store chart data globally so the Count/Value toggle buttons
    // can call switchChartMode() without needing to re-fetch.
    window._chartModeData = { counts, values, labels, chartColors, textColor, gridColor };
}

/**
 * Switches the bar chart between "product count" and "inventory
 * value" display modes without rebuilding the chart from scratch —
 * only the dataset and axis formatter are swapped, then updated.
 *
 * @param {'count'|'value'} mode
 * @param {number[]} data         — the dataset for the chosen mode
 * @param {string[]} labels       — category labels (unchanged)
 * @param {string[]} chartColors  — bar colours (unchanged)
 * @param {string}   textColor    — axis label colour for current theme
 * @param {string}   gridColor    — grid line colour for current theme
 */
function switchChartMode(mode, data, labels, chartColors, textColor, gridColor) {
    if (!barChartInstance) return;

    // Sync the active state of the toggle buttons.
    document.getElementById('toggleCount')?.classList.toggle('active', mode === 'count');
    document.getElementById('toggleValue')?.classList.toggle('active', mode === 'value');

    barChartInstance.data.datasets[0].data  = data;
    barChartInstance.data.datasets[0].label = mode === 'count' ? 'Products' : 'Value (₱)';

    // Format Y-axis ticks as peso amounts in value mode.
    barChartInstance.options.scales.y.ticks.callback = mode === 'value'
        ? v => `₱${Number(v).toLocaleString()}`
        : undefined;

    // Format the tooltip label to match the active mode.
    barChartInstance.options.plugins.tooltip = {
        callbacks: {
            label: ctx => mode === 'value'
                ? ` ₱${Number(ctx.raw).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`
                : ` ${ctx.raw} product(s)`
        }
    };

    barChartInstance.update();
}


// ============================================================
// SECTION 7 — UTILITIES
// Small helper functions used across multiple sections above.
// ============================================================

/**
 * Sets the inner text of a stat card element by its DOM ID.
 * Silently does nothing if the element doesn't exist.
 *
 * @param {string} id    — element ID
 * @param {*}      value — the value to display
 */
function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

/**
 * Returns a human-readable relative time string for a given Date.
 * Examples: "Just now", "3 minutes ago", "2 hours ago", "Apr 5, 02:30 PM"
 *
 * @param {Date} date
 * @returns {string}
 */
function formatTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return "Just now";

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`;

    // Older than 24 hours — show a formatted date/time string.
    return date.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
}


// ============================================================
// SECTION 8 — UI EVENT LISTENERS
// All DOM event listeners are registered here inside
// DOMContentLoaded to guarantee elements exist before we query
// for them.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn     = document.getElementById('closeBtn');
    const sidebar      = document.getElementById('sidebar');
    const overlay      = document.getElementById('overlay');
    const refreshBtn   = document.getElementById('refreshBtn');

    // Refresh button — bypasses cache and re-fetches from Firestore.
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadDashboard(true));
    }

    /** Opens or closes the mobile sidebar and its backdrop overlay. */
    function toggleSidebar() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }

    /** Closes the mobile sidebar and hides the backdrop overlay. */
    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    if (hamburgerBtn) hamburgerBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
    if (closeBtn)     closeBtn.addEventListener('click', closeSidebar);
    // Tapping the dark overlay also closes the sidebar.
    if (overlay)      overlay.addEventListener('click', closeSidebar);

    // Chart toggle buttons — switch between product count and peso value views.
    document.getElementById('toggleCount')?.addEventListener('click', () => {
        if (window._chartModeData) {
            switchChartMode(
                'count',
                window._chartModeData.counts,
                window._chartModeData.labels,
                window._chartModeData.chartColors,
                window._chartModeData.textColor,
                window._chartModeData.gridColor
            );
        }
    });

    document.getElementById('toggleValue')?.addEventListener('click', () => {
        if (window._chartModeData) {
            switchChartMode(
                'value',
                window._chartModeData.values,
                window._chartModeData.labels,
                window._chartModeData.chartColors,
                window._chartModeData.textColor,
                window._chartModeData.gridColor
            );
        }
    });
});


// ============================================================
// EXPORTS
// Named exports allow other modules (e.g. unit tests or other
// pages) to reuse individual helpers without importing the
// entire module.
// ============================================================
export {
    getCachedUserData,
    loadDashboard,
    fetchAndCache,
    loadStats,
    loadRecentActivities,
    loadCategoryCount,
    saveCache,
    loadCache,
    clearCache,
    formatTimeAgo
};