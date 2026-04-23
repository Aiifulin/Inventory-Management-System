// ============================================================
// Stock_Transactions.js
// Handles all logic for the Stock Transactions page: loading and
// displaying transactions by year, filtering and paginating the
// table, creating new transactions via a modal form, updating
// transaction statuses with real-time stock adjustments, and
// logging all activity to the Firestore activities collection.
// ============================================================

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc,
    updateDoc, query, orderBy, where, serverTimestamp, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// SECTION 1 — FIRESTORE PATH HELPERS
// Transactions are stored in a year-keyed sub-collection:
//   stock_transactions/{year}/transactions/{txId}
// Each year also has a sentinel document at stock_transactions/{year}
// used to enumerate which years have data without a full scan.
// ============================================================

/** Returns the transactions sub-collection reference for a given year. */
const txCol   = (year) => collection(db, "stock_transactions", String(year), "transactions");

/** Returns a specific transaction document reference by year and ID. */
const txDoc   = (year, id) => doc(db, "stock_transactions", String(year), "transactions", id);

/** Returns the sentinel year document (used to mark that a year has data). */
const yearDoc = (year) => doc(db, "stock_transactions", String(year));


// ============================================================
// SECTION 2 — STATE
// Module-level variables that represent the current UI state.
// PAGE_SIZE     — number of rows shown per table page.
// filteredTx    — the active filtered + sorted transaction list
//   that the table renders from. Rebuilt by applyFilters().
// currentPage   — the current pagination page (1-indexed).
// isAdmin       — resolved once from Firestore; gates the "Add
//   Transaction" button and the clickable status badges.
// currentUser   — the Firebase Auth user, set by the Auth listener.
// productsMap   — in-memory map of productId → { name, stock,
//   lowStockThreshold } used for stock preview and validation.
// isLoading     — true while a Firestore fetch is in progress;
//   blocks renderPage() to avoid flashing stale data.
// activeYear    — the currently selected year tab.
// txCache       — year-keyed cache of transaction arrays so
//   switching years doesn't re-fetch already-loaded data.
// allYears      — sorted list of years that have transaction data.
// statusModalTxId / statusModalTxYear — hold the transaction
//   identity while the status-change modal is open.
// ============================================================
const PAGE_SIZE = 15;
let filteredTx  = [];
let currentPage = 1;
let isAdmin     = false;
let currentUser = null;
let productsMap = {};
let isLoading   = true;

let activeYear = new Date().getFullYear();
let txCache    = {};
let allYears   = [];

let statusModalTxId   = null;
let statusModalTxYear = null;


// ============================================================
// SECTION 3 — USER DATA HELPER
// ============================================================

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Caches the result per-UID in sessionStorage so repeat page visits
 * don't cost an extra Firestore read.
 *
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null} — user data object, or null on failure
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
    } catch (e) { console.error(e); }
    return null;
}


// ============================================================
// SECTION 4 — AUTH & INITIALISATION
// The user's role MUST be resolved before loadProducts() and
// initYearTabs() run, because isAdmin gates both the "Add
// Transaction" button and the clickable status badges in the
// rendered rows. Once isAdmin is set, those two operations are
// fired in parallel to minimise load time.
// ============================================================

/**
 * Firebase Auth state listener — runs once on page load.
 * Redirects unauthenticated users to the login page.
 *
 * Flow:
 *   1. Resolves isAdmin from Firestore user data (sequential,
 *      because isAdmin must be set before anything renders).
 *   2. Fires loadProducts() and initYearTabs() in parallel.
 *   3. Updates the sidebar name badge and wires up the logout modal.
 */
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.replace("index.html"); return; }

    currentUser = user;

    // Resolve role first — isAdmin gates button visibility and row rendering.
    const userData = await getCachedUserData(user.uid);
    isAdmin = userData?.role?.toLowerCase() === "admin";

    const nameEl = document.getElementById("userNameDisplay");
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    // Show the "Add Transaction" button only for admins.
    const openBtn = document.getElementById("openModalBtn");
    if (openBtn && isAdmin) openBtn.style.display = "inline-flex";

    // Safe to run in parallel now that isAdmin is set.
    await Promise.all([
        loadProducts(),
        initYearTabs()
    ]);

    document.querySelector('.main-content').style.visibility = 'visible';

    const doSignOut = () => {
        ["user_session", "user_uid", "user_role"].forEach(k => localStorage.removeItem(k));
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogout = initLogoutModal(doSignOut);
    window.logout = () => { if (openLogout) openLogout(); };
});


// ============================================================
// SECTION 5 — PRODUCT LOADER
// Fetches all non-archived products into productsMap for use
// in the transaction modal (stock preview, validation) and in
// the table (low-stock colour coding). Also populates the
// product dropdown and initialises Tom Select on it.
// ============================================================

/**
 * Fetches all active (non-archived) products from Firestore.
 * Builds productsMap keyed by document ID for O(1) lookups
 * during stock preview and transaction saves.
 * Populates the modal product dropdown and initialises a
 * Tom Select searchable dropdown on it.
 */
async function loadProducts() {
    try {
        const snap = await getDocs(query(collection(db, "products"), where("archived", "==", false)));

        const modalSelect = document.getElementById("modalProduct");
        if (modalSelect) modalSelect.innerHTML = '<option value="" disabled selected>Select a product…</option>';

        snap.forEach(docSnap => {
            const d = docSnap.data();
            productsMap[docSnap.id] = {
                name:              d.name || "",
                stock:             Number(d.stock) || 0,
                lowStockThreshold: Number(d.lowStockThreshold) || 10
            };

            if (modalSelect) {
                const opt = document.createElement("option");
                opt.value = docSnap.id;
                opt.textContent = d.name || docSnap.id;
                modalSelect.appendChild(opt);
            }
        });

        // Initialise Tom Select only once — guard against double init.
        if (modalSelect && !modalSelect.tomselect) {
            new TomSelect('#modalProduct', {
                placeholder: 'Search or select a product…',
                allowEmptyOption: true,
                maxOptions: null,
            });
        }

    } catch (e) { console.error("loadProducts:", e); }
}


// ============================================================
// SECTION 6 — DATA MIGRATION
// One-time migration that moves any flat transaction documents
// (stored directly under stock_transactions/{txId}) into the
// year-keyed sub-collection structure. Guarded by a localStorage
// flag so it costs zero Firestore reads after the first run.
// ============================================================

/**
 * Migrates legacy flat transaction documents into the year-keyed
 * sub-collection structure.
 *
 * Documents whose IDs match /^\d{4}$/ are already year sentinels
 * and are skipped. All others are moved to
 *   stock_transactions/{year}/transactions/{id}
 * and their original document is deleted.
 *
 * Once migration completes (or if there is nothing to migrate),
 * a localStorage flag is set so this function becomes a no-op
 * on every subsequent page load.
 */
async function migrateFlatDocs() {
    if (localStorage.getItem('tx_migration_done')) return;

    try {
        const rootSnap  = await getDocs(collection(db, "stock_transactions"));
        const toMigrate = [];
        rootSnap.forEach(docSnap => {
            if (/^\d{4}$/.test(docSnap.id)) return; // Skip year sentinel docs.
            const d = docSnap.data();
            if (d.createdAt?.seconds) toMigrate.push({ id: docSnap.id, data: d });
        });

        if (toMigrate.length === 0) {
            localStorage.setItem('tx_migration_done', '1');
            return;
        }

        for (const { id, data } of toMigrate) {
            const year = new Date(data.createdAt.seconds * 1000).getFullYear();
            await setDoc(txDoc(year, id), data);
            await setDoc(yearDoc(year), { exists: true }, { merge: true });
            await deleteDoc(doc(db, "stock_transactions", id));
        }

        localStorage.setItem('tx_migration_done', '1');
    } catch (e) { console.error("migrateFlatDocs:", e); }
}


// ============================================================
// SECTION 7 — YEAR TABS
// The page organises transactions by year. initYearTabs() builds
// the list of years with data, caches it in sessionStorage, and
// loads the active year's transactions. Switching tabs reuses
// the per-year cache (txCache) so already-loaded years render
// instantly without a new Firestore read.
// ============================================================

/**
 * Entry point for the year tab system.
 * Runs migration (near-instant after first run), reads or builds
 * the year list, renders the tab bar, and loads the active year.
 */
async function initYearTabs() {
    setLoading(true);
    const currentYear = new Date().getFullYear();
    await migrateFlatDocs();

    // Use the cached year list from sessionStorage if available.
    const cachedYears = sessionStorage.getItem('tx_years');
    if (cachedYears) {
        allYears = JSON.parse(cachedYears);
        if (!allYears.includes(currentYear)) allYears.unshift(currentYear);
    } else {
        try {
            // Enumerate year sentinel documents to discover which years have data.
            const rootSnap = await getDocs(collection(db, "stock_transactions"));
            const yearSet  = new Set();
            rootSnap.forEach(docSnap => {
                if (/^\d{4}$/.test(docSnap.id)) yearSet.add(Number(docSnap.id));
            });
            yearSet.add(currentYear);
            allYears = Array.from(yearSet).sort((a, b) => b - a);
            sessionStorage.setItem('tx_years', JSON.stringify(allYears));
        } catch (e) {
            console.error("initYearTabs:", e);
            allYears = [currentYear];
        }
    }

    renderYearTabs();
    await loadYearTransactions(activeYear);
}

/**
 * Renders the year tab bar from allYears.
 * Appends a transaction count badge to any tab whose year has
 * already been loaded into txCache.
 * Wires up click listeners to call switchYear().
 */
function renderYearTabs() {
    const container = document.getElementById("yearTabs");
    if (!container) return;
    container.style.display = "flex";
    container.innerHTML = allYears.map(year => {
        const cached     = txCache[year];
        const countBadge = cached != null ? `<span class="tab-count">(${cached.length})</span>` : "";
        return `<button class="year-tab${year === activeYear ? " active" : ""}" data-year="${year}">${year}${countBadge}</button>`;
    }).join("");
    container.querySelectorAll(".year-tab").forEach(btn => {
        btn.addEventListener("click", () => switchYear(Number(btn.dataset.year)));
    });
}

/**
 * Switches the active year tab.
 * If the year's data is already cached, renders it immediately.
 * Otherwise fetches it from Firestore via loadYearTransactions().
 * Guards against redundant fetches when clicking the already-active
 * cached tab.
 *
 * @param {number} year — the year to switch to
 */
async function switchYear(year) {
    if (year === activeYear && txCache[year] != null) return;
    activeYear = year;
    renderYearTabs();
    if (txCache[year] != null) { applyFilters(); updateSummaryStats(); }
    else await loadYearTransactions(year);
}

/**
 * Returns a human-readable date/time string for a Firestore Timestamp.
 * Returns an empty string if the timestamp is missing or malformed.
 *
 * @param {{ seconds: number }|null} ts — Firestore Timestamp object
 * @returns {string} — e.g. "Apr 22, 2025, 03:45 PM"
 */
function formatDate(ts) {
    if (!ts?.seconds) return "";
    return new Date(ts.seconds * 1000).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
}

/**
 * Fetches all transactions for a given year from Firestore,
 * normalises each document into a flat row object, and stores
 * the result in txCache[year].
 * Calls applyFilters() and updateSummaryStats() once data is ready.
 * Falls back to an empty array on error.
 *
 * @param {number} year — the year to load
 */
async function loadYearTransactions(year) {
    setLoading(true);
    try {
        const snap = await getDocs(query(txCol(year), orderBy("createdAt", "desc")));
        const rows = [];
        snap.forEach(docSnap => {
            const d = docSnap.data();
            rows.push({
                id:            docSnap.id,
                year,
                productId:     d.productId    || "",
                productName:   d.productName  || "",
                type:          d.type         || "",
                status:        d.status       || "Completed",
                qty:           Number(d.qty)  || 0,
                stockBefore:   Number(d.stockBefore) || 0,
                stockAfter:    Number(d.stockAfter)  || 0,
                note:          d.note         || "",
                createdBy:     d.createdBy    || "",
                createdByName: d.createdByName || "",
                editedBy:      d.editedBy     || "",
                createdAt:     d.createdAt    || null,
                updatedAt:     d.updatedAt    || null,
                dateStr:       formatDate(d.createdAt),
                updatedStr:    formatDate(d.updatedAt)
            });
        });
        txCache[year] = rows;
    } catch (e) {
        console.error(`loadYearTransactions(${year}):`, e);
        txCache[year] = [];
    } finally {
        setLoading(false);
        renderYearTabs();
        applyFilters();
        updateSummaryStats();
    }
}


// ============================================================
// SECTION 8 — FILTER & SEARCH
// applyFilters() reads all filter/search inputs, filters the
// active year's cached transactions, and resets pagination to
// page 1 before re-rendering. The "active filter" dot indicator
// is shown when any non-search filter is active.
// ============================================================

/**
 * Filters txCache[activeYear] based on the current values of all
 * search and filter inputs (text search, type, status, date range).
 * Stores the result in filteredTx and calls renderPage().
 * Also toggles the filter-active dot indicator.
 */
function applyFilters() {
    const search    = (document.getElementById("searchInput")?.value   || "").toLowerCase().trim();
    const type      = document.getElementById("filterType")?.value      || "";
    const status    = document.getElementById("filterStatus")?.value    || "";
    const dateFrom  = document.getElementById("filterDateFrom")?.value  || "";
    const dateTo    = document.getElementById("filterDateTo")?.value    || "";
    const source    = txCache[activeYear] || [];

    // Show the orange dot on the filter button when any filter is active.
    const dot = document.getElementById("filterActiveDot");
    if (dot) dot.style.display = (status || dateFrom || dateTo) ? "block" : "none";

    filteredTx = source.filter(tx => {
        const matchSearch  = !search || (
            tx.productName.toLowerCase().includes(search) ||
            tx.type.toLowerCase().includes(search)        ||
            tx.note.toLowerCase().includes(search)        ||
            tx.dateStr.toLowerCase().includes(search)     ||
            tx.status.toLowerCase().includes(search)
        );
        const matchType   = !type   || tx.type   === type;
        const matchStatus = !status || tx.status === status;

        let matchDate = true;
        if (tx.createdAt?.seconds) {
            const txDate = new Date(tx.createdAt.seconds * 1000);
            if (dateFrom) { const from = new Date(dateFrom); from.setHours(0,0,0,0); if (txDate < from) matchDate = false; }
            if (matchDate && dateTo) { const to = new Date(dateTo); to.setHours(23,59,59,999); if (txDate > to) matchDate = false; }
        }

        return matchSearch && matchType && matchStatus && matchDate;
    });

    currentPage = 1;
    renderPage();
}


// ============================================================
// SECTION 9 — TABLE RENDERING & PAGINATION
// renderPage() slices filteredTx to the current page and builds
// the table HTML. Status badges are made clickable for admins.
// Stock-after values are colour-coded (danger/warn/ok) against
// the product's low-stock threshold.
// ============================================================

/**
 * Renders the current page of filteredTx into the transactions table.
 *
 * Each row includes:
 *   - Date, product ID + name with an "edited" pill if modified
 *   - Transaction type badge (Stock In / Sold / Adjustment)
 *   - Status badge — clickable for admins to open the status modal
 *   - Stock Before, Qty delta (±), Stock After with colour coding
 *   - Note, last updated date, and last editor
 *
 * Shows an appropriate empty-state message if no rows match.
 * Updates the pagination controls (page info label and prev/next buttons).
 */
function renderPage() {
    const tbody = document.getElementById("txTableBody");
    if (!tbody || isLoading) return;

    const totalPages = Math.max(1, Math.ceil(filteredTx.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const rows  = filteredTx.slice(start, start + PAGE_SIZE);

    if (filteredTx.length === 0) {
        const source = txCache[activeYear] || [];
        const msg    = source.length === 0
            ? `No transactions recorded for ${activeYear}.`
            : "No transactions match your filters.";
        tbody.innerHTML = `<tr class="empty-state"><td colspan="9"><div class="empty-state-icon"><i class="fas fa-arrows-rotate"></i></div>${msg}</td></tr>`;
    } else {
        tbody.innerHTML = rows.map(tx => {
            const isPositive = tx.type === "Stock In";
            const deltaSign  = isPositive ? "+" : "-";
            const deltaClass = isPositive ? "positive" : "negative";
            const badgeClass = { "Stock In": "stock-in", "Sold": "sold", "Adjustment": "adjustment" }[tx.type] || "adjustment";

            // Status badge: admins get a clickable badge that opens the status modal.
            const statusKey   = (tx.status || "Completed").toLowerCase();
            const statusIcons = { completed: "✅", pending: "⏳", cancelled: "❌" };
            const statusIcon  = statusIcons[statusKey] || "✅";
            const clickable   = isAdmin ? " clickable" : "";
            const clickAttr   = isAdmin ? `data-txid="${tx.id}" data-year="${tx.year}" data-txname="${escHtml(tx.productName)} — ${escHtml(tx.type)}"` : "";
            const title       = isAdmin ? `title="Click to change status"` : "";
            const statusBadge = `<span class="status-badge ${statusKey}${clickable}" ${clickAttr} ${title}>${statusIcon} ${tx.status}</span>`;

            // Colour-code the Stock After value against the product's threshold.
            const threshold  = productsMap[tx.productId]?.lowStockThreshold || 10;
            const afterClass = tx.stockAfter === 0 ? "danger" : tx.stockAfter <= threshold ? "warn" : "ok";

            // Small "edited" pill shown when the transaction was modified after creation.
            const editedDot = tx.updatedAt
                ? `<span style="font-size:10px;font-weight:600;margin-left:6px;vertical-align:middle;padding:1px 5px;border-radius:4px;background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.3);letter-spacing:0.02em;" title="Edited">edited</span>`
                : "";

            // "Updated On" cell shows the edit timestamp if present, otherwise the creation time.
            const updatedOnCell = tx.updatedAt
                ? `<span class="audit-line"><i class="fas fa-pen" style="font-size:11px;margin-right:4px;"></i>${tx.updatedStr || "—"}</span>`
                : tx.dateStr
                ? `<span class="audit-line" style="color:var(--text-secondary);"><i class="fas fa-clock" style="font-size:11px;margin-right:4px;"></i>${tx.dateStr}</span>`
                : `<span style="color:var(--text-secondary);font-size:12px;">—</span>`;

            // "Updated By" cell prefers the editor name over the creator name.
            const updatedByCell = tx.editedBy
                ? escHtml(tx.editedBy)
                : tx.createdByName
                ? `<span style="color:var(--text-secondary);">${escHtml(tx.createdByName)}</span>`
                : `<span style="color:var(--text-secondary);font-size:12px;">—</span>`;

            return `
                <tr>
                    <td data-label="Date" style="white-space:nowrap;font-size:13px;color:var(--text-secondary);">${tx.dateStr || "—"}</td>
                    <td data-label="Product">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span style="font-size:11px; font-weight:600; color:var(--text-secondary); background:var(--hover-bg); padding:2px 6px; border-radius:4px; font-family:monospace; white-space:nowrap; flex-shrink:0;">${escHtml(tx.productId)}</span>
                            <span style="font-weight:600;">${escHtml(tx.productName)}${editedDot}</span>
                        </div>
                    </td>
                    <td data-label="Type"><span class="tx-badge ${badgeClass}">${tx.type}</span></td>
                    <td data-label="Status">${statusBadge}</td>
                    <td data-label="Stock Before"><span class="stock-after" style="color:var(--text-secondary);">${tx.stockBefore}</span></td>
                    <td data-label="Qty"><span class="qty-delta ${deltaClass}">${deltaSign}${tx.qty}</span></td>
                    <td data-label="Stock After"><span class="stock-after ${afterClass}">${tx.stockAfter}</span></td>
                    <td data-label="Note" style="color:var(--text-secondary);font-size:13px;">${escHtml(tx.note) || "—"}</td>
                    <td data-label="Updated On" style="font-size:13px;white-space:nowrap;">${updatedOnCell}</td>
                    <td data-label="Updated By" style="font-size:13px;color:var(--text-secondary);">${updatedByCell}</td>
                </tr>`;
        }).join("");

        // Attach status modal listeners to clickable badges after HTML is injected.
        if (isAdmin) {
            tbody.querySelectorAll(".status-badge.clickable").forEach(el => {
                el.addEventListener("click", () => openStatusModal(el.dataset.txid, Number(el.dataset.year), el.dataset.txname));
            });
        }
    }

    document.getElementById("pageInfo").textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById("prevBtn").disabled      = currentPage <= 1;
    document.getElementById("nextBtn").disabled      = currentPage >= totalPages;
}

/**
 * Escapes special HTML characters to prevent XSS when injecting
 * user-generated strings (product names, notes, etc.) into innerHTML.
 *
 * @param {string} str — raw string to escape
 * @returns {string} — HTML-safe string
 */
function escHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Recalculates and updates the four summary stat cards
 * (Total, Stock In qty, Sold qty, Other count) from the
 * active year's cached transaction data.
 */
function updateSummaryStats() {
    const source = txCache[activeYear] || [];
    let stockInQty = 0, soldQty = 0, otherCount = 0;
    source.forEach(tx => {
        if (tx.type === "Stock In")  stockInQty += tx.qty;
        else if (tx.type === "Sold") soldQty    += tx.qty;
        else                         otherCount++;
    });
    document.getElementById("statTotal").textContent   = source.length.toLocaleString();
    document.getElementById("statStockIn").textContent = stockInQty.toLocaleString();
    document.getElementById("statSold").textContent    = soldQty.toLocaleString();
    document.getElementById("statOther").textContent   = otherCount.toLocaleString();
}

/**
 * Toggles the skeleton loading state.
 * While loading, the table and pagination bar are hidden and the
 * skeleton placeholder is shown. renderPage() is also blocked
 * via the isLoading flag to prevent rendering stale data.
 *
 * @param {boolean} loading
 */
function setLoading(loading) {
    isLoading = loading;
    document.getElementById("txSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("txTableWrapper")?.classList.toggle("hidden", loading);
    document.getElementById("paginationBar")?.classList.toggle("hidden", loading);
}

/**
 * Writes an entry to the Firestore activities collection.
 * Used to record every transaction create and status change.
 * Silently logs errors without disrupting the main flow.
 *
 * @param {string} action — short description of the action (e.g. "Stock In")
 * @param {string} target — the item affected (e.g. "Product Name (Qty: +10)")
 */
async function logActivity(action, target) {
    try {
        await addDoc(collection(db, "activities"), {
            action, target, user: currentUser?.email || "Admin", timestamp: serverTimestamp()
        });
    } catch (e) { console.error("logActivity:", e); }
}


// ============================================================
// SECTION 10 — TRANSACTION MODAL (CREATE)
// The modal form lets admins add new Stock In, Sold, or
// Adjustment transactions. updateStockPreview() gives live
// feedback on what the stock level will be after the save.
// saveTransaction() validates, writes to Firestore, adjusts
// product stock, and reloads the table.
// ============================================================

/**
 * Shows or hides the inline stock warning banner and toggles
 * the save buttons accordingly.
 * The warning is shown when the admin tries to deduct more units
 * than are currently in stock on a Completed transaction.
 *
 * @param {boolean} show  — true to show the warning, false to hide it
 * @param {string}  title — warning heading text
 * @param {string}  desc  — warning detail text
 */
function setStockWarning(show, title = "", desc = "") {
    const banner     = document.getElementById("stockWarning");
    const confirmBtn = document.getElementById("confirmTxBtn");
    const anotherBtn = document.getElementById("saveAnotherBtn");

    if (!banner) return;
    banner.style.display = show ? "flex" : "none";
    if (show) {
        document.getElementById("stockWarningTitle").textContent = title;
        document.getElementById("stockWarningDesc").textContent  = desc;
    }

    // Disable save buttons while the warning is blocking the form.
    if (confirmBtn) confirmBtn.disabled = show;
    if (anotherBtn) anotherBtn.disabled = show;
}

/**
 * Recalculates and displays the stock preview (current → after)
 * whenever the product, type, quantity, or status changes.
 *
 * Shows a blocking warning instead of the preview when the
 * selected quantity would exceed available stock on a Completed
 * deduction. Pending and Cancelled statuses skip this check since
 * they don't immediately adjust stock.
 */
function updateStockPreview() {
    const productId = document.getElementById("modalProduct").value;
    const type      = document.getElementById("modalType").value;
    const qty       = parseInt(document.getElementById("modalQty").value) || 0;
    const statusVal = document.getElementById("modalStatus")?.value;
    const preview   = document.getElementById("stockPreview");

    setStockWarning(false);

    if (!productId || !type || qty <= 0) { preview.style.display = "none"; return; }
    const product = productsMap[productId];
    if (!product)  { preview.style.display = "none"; return; }

    const before   = product.stock;
    const isIn     = type === "Stock In";
    const isDeduct = type === "Sold" || type === "Adjustment";

    // Block the save if attempting to deduct more than available stock.
    if (isDeduct && statusVal === "Completed" && qty > before) {
        const typeLabel = type === "Sold" ? "sell" : "adjust";
        setStockWarning(
            true,
            `Not enough stock to ${typeLabel}`,
            `You're trying to remove ${qty} unit${qty !== 1 ? "s" : ""} but only ${before} remain${before === 1 ? "s" : ""}. Reduce the quantity or change the status to Pending.`
        );
        preview.style.display = "none";
        return;
    }

    const after      = isIn ? before + qty : Math.max(0, before - qty);
    const afterEl    = document.getElementById("previewAfter");
    const afterClass = after === 0 ? "danger" : after <= product.lowStockThreshold ? "warn" : "ok";
    const noteEl     = document.getElementById("previewNote");

    document.getElementById("previewCurrent").textContent = before;
    afterEl.textContent = after;
    afterEl.className   = `after ${afterClass}`;

    // Show a contextual note for non-Completed statuses.
    noteEl.textContent = statusVal === "Pending"   ? "⏳ Stock will update when Completed"
                       : statusVal === "Cancelled" ? "❌ Cancelled — stock won't change"
                       : "";

    preview.style.display = "flex";
}

/**
 * Validates the modal form and saves a new transaction to Firestore.
 *
 * Flow:
 *   1. Validates inputs (product, type, quantity).
 *   2. Checks that a Completed deduction won't go below zero (safety net).
 *   3. Calculates stockAfter (Pending/Cancelled transactions leave stock unchanged).
 *   4. Writes the transaction document to txCol(thisYear).
 *   5. Creates the year sentinel document if it doesn't exist.
 *   6. Updates the product's stock in Firestore only for Completed transactions.
 *   7. Logs the activity, invalidates relevant session caches, and reloads the table.
 *   8. Either closes the modal (keepOpen = false) and shows a result modal,
 *      or resets the form for another entry (keepOpen = true).
 *
 * @param {boolean} keepOpen — true to reset and keep modal open ("Save & Add Another")
 */
async function saveTransaction(keepOpen = false) {
    const productId  = document.getElementById("modalProduct").value;
    const type       = document.getElementById("modalType").value;
    const status     = document.getElementById("modalStatus").value || "Completed";
    const qty        = parseInt(document.getElementById("modalQty").value);
    const note       = document.getElementById("modalNote").value.trim();
    const confirmBtn = document.getElementById("confirmTxBtn");
    const anotherBtn = document.getElementById("saveAnotherBtn");

    if (!productId)      { showToast("Please select a product.",         "error"); return; }
    if (!type)           { showToast("Please select a transaction type.", "error"); return; }
    if (!qty || qty < 1) { showToast("Quantity must be at least 1.",      "error"); return; }

    const product = productsMap[productId];
    if (!product) { showToast("Product not found.", "error"); return; }

    const isIn        = type === "Stock In";
    const stockBefore = product.stock;

    // Hard block — the UI warning should prevent reaching here, but this is a safety net.
    if (status === "Completed" && !isIn && qty > stockBefore) {
        showToast(`Cannot ${type.toLowerCase()} ${qty} units — only ${stockBefore} in stock.`, "error");
        return;
    }

    // Only adjust stock for Completed transactions.
    const stockAfter = status === "Completed"
        ? (isIn ? stockBefore + qty : Math.max(0, stockBefore - qty))
        : stockBefore;

    confirmBtn.disabled  = true;
    confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';
    if (anotherBtn) anotherBtn.disabled = true;

    try {
        const thisYear  = new Date().getFullYear();
        const now       = serverTimestamp();
        const userData  = await getCachedUserData(currentUser.uid);
        const adminName = userData?.name || currentUser?.email || "Admin";

        const txData = {
            productId, productName: product.name, type, qty, status,
            stockBefore, stockAfter, note,
            createdBy: currentUser?.uid || "", createdByName: adminName,
            createdAt: now, updatedAt: null, editedBy: ""
        };

        await addDoc(txCol(thisYear), txData);
        // Ensure the year sentinel exists so this year appears in the tab list.
        await setDoc(yearDoc(thisYear), { exists: true }, { merge: true });

        if (status === "Completed") {
            await updateDoc(doc(db, "products", productId), { stock: stockAfter });
            productsMap[productId].stock = stockAfter; // Sync local cache immediately.
        }

        const statusNote = status !== "Completed" ? ` [${status}]` : "";
        await logActivity(`${type}${statusNote}`, `${product.name} (Qty: ${isIn ? "+" : "-"}${qty})`);

        // Invalidate related session caches so other pages pick up the change.
        sessionStorage.removeItem("dashboard_cache");
        sessionStorage.removeItem("tx_years");
        sessionStorage.removeItem("products_cache");

        if (!allYears.includes(thisYear)) allYears.unshift(thisYear);
        delete txCache[thisYear]; // Force a fresh fetch for the current year.
        activeYear = thisYear;
        await loadYearTransactions(thisYear);

        if (keepOpen) {
            openTxModal();
            showToast(`${product.name} — ${type} saved!`, "success");
        } else {
            closeTxModal();
            showResultModal(
                "Transaction Saved",
                `${product.name} — ${type} [${status}]: ${isIn ? "+" : "-"}${qty} unit(s).` +
                (status === "Completed" ? ` New stock: ${stockAfter}.` : " Stock unchanged until Completed.")
            );
        }

    } catch (e) {
        console.error("saveTransaction:", e);
        showToast("Error saving transaction: " + e.message, "error");
    } finally {
        confirmBtn.disabled  = false;
        confirmBtn.innerHTML = '<i class="fas fa-check"></i> Save Transaction';
        if (anotherBtn) anotherBtn.disabled = false;
        updateStockPreview(); // Restore correct button state after save attempt.
    }
}


// ============================================================
// SECTION 11 — STATUS MODAL
// Admins can change a transaction's status (Pending → Completed,
// Completed → Cancelled, etc.) by clicking a status badge in the
// table. The modal shows audit info (created/edited timestamps)
// and handles the stock reversal/application logic:
//   - Pending → Completed: applies stock change now.
//   - Completed → anything else: reverses the stock change.
// The local txCache is updated immediately to avoid a round trip.
// ============================================================

/**
 * Opens the status-change modal for the given transaction.
 * Populates the modal with the transaction's current status,
 * audit trail (created date, last edit), and wires the transaction
 * identity into module-level state for confirmStatusChange().
 *
 * @param {string} txId   — Firestore transaction document ID
 * @param {number} year   — the year sub-collection the transaction lives in
 * @param {string} txName — display name for the modal heading
 */
function openStatusModal(txId, year, txName) {
    if (!isAdmin) return;
    statusModalTxId   = txId;
    statusModalTxYear = year;

    const tx = (txCache[year] || []).find(t => t.id === txId);
    if (!tx) return;

    document.getElementById("statusModalTxName").textContent = txName;
    document.getElementById("statusModalSelect").value       = tx.status || "Completed";

    const auditBox        = document.getElementById("statusModalAudit");
    const auditCreated    = document.getElementById("auditCreated");
    const auditUpdated    = document.getElementById("auditUpdated");
    const auditEditedBy   = document.getElementById("auditEditedBy");
    const auditUpdatedRow = document.getElementById("auditUpdatedRow");

    auditBox.style.display   = "flex";
    auditCreated.textContent = tx.dateStr || "—";

    // Only show the "last edited" row if the transaction has been modified.
    if (tx.updatedAt) {
        auditUpdated.textContent  = tx.updatedStr || "—";
        auditEditedBy.textContent = tx.editedBy   || "unknown";
        auditUpdatedRow.style.display = "flex";
    } else {
        auditUpdatedRow.style.display = "none";
    }

    document.getElementById("statusModal").style.display = "flex";
}

/** Closes the status modal and clears the stored transaction identity. */
function closeStatusModal() {
    document.getElementById("statusModal").style.display = "none";
    statusModalTxId   = null;
    statusModalTxYear = null;
}

/**
 * Commits the status change selected in the status modal.
 *
 * Stock adjustment logic:
 *   - If transitioning TO Completed: applies the stock delta now
 *     (stock was held pending).
 *   - If transitioning FROM Completed: reverses the stock delta
 *     (stock was already applied and needs to be undone).
 *   - Any other transition (e.g. Pending → Cancelled): no stock change.
 *
 * Updates Firestore, syncs the local txCache entry (to avoid a
 * full re-fetch), logs the activity, invalidates relevant caches,
 * and re-renders the table via applyFilters().
 */
async function confirmStatusChange() {
    if (!statusModalTxId || !statusModalTxYear) return;

    const newStatus = document.getElementById("statusModalSelect").value;
    const btn       = document.getElementById("confirmStatusBtn");
    const tx        = (txCache[statusModalTxYear] || []).find(t => t.id === statusModalTxId);
    if (!tx) { closeStatusModal(); return; }

    btn.disabled  = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating…';

    try {
        const userData   = await getCachedUserData(currentUser.uid);
        const editorName = userData?.name || currentUser?.email || "Admin";
        const updateData = { status: newStatus, updatedAt: serverTimestamp(), editedBy: editorName };

        const wasCompleted = tx.status === "Completed";
        const nowCompleted = newStatus  === "Completed";
        const product      = productsMap[tx.productId];

        // Apply stock delta when moving TO Completed from a non-Completed state.
        if (!wasCompleted && nowCompleted && product) {
            const isIn     = tx.type === "Stock In";
            const newStock = isIn ? product.stock + tx.qty : Math.max(0, product.stock - tx.qty);
            updateData.stockAfter = newStock;
            await updateDoc(doc(db, "products", tx.productId), { stock: newStock });
            productsMap[tx.productId].stock = newStock;
        }

        // Reverse stock delta when moving FROM Completed to any other status.
        if (wasCompleted && !nowCompleted && product) {
            const isIn     = tx.type === "Stock In";
            const reversed = isIn
                ? Math.max(0, product.stock - tx.qty)
                : product.stock + tx.qty;
            updateData.stockAfter = reversed;
            await updateDoc(doc(db, "products", tx.productId), { stock: reversed });
            productsMap[tx.productId].stock = reversed;
        }

        await updateDoc(txDoc(statusModalTxYear, statusModalTxId), updateData);

        // Patch the local cache entry so the table updates without a re-fetch.
        const cached = txCache[statusModalTxYear];
        if (cached) {
            const idx = cached.findIndex(t => t.id === statusModalTxId);
            if (idx !== -1) {
                cached[idx] = {
                    ...cached[idx], status: newStatus, editedBy: editorName,
                    updatedAt:  { seconds: Math.floor(Date.now() / 1000) },
                    updatedStr: new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })
                };
            }
        }

        await logActivity(`Status → ${newStatus}`, `${tx.productName} — ${tx.type}`);
        sessionStorage.removeItem("dashboard_cache");
        sessionStorage.removeItem("products_cache");

        closeStatusModal();
        applyFilters();
        showToast(`Status updated to ${newStatus}`, "success");
    } catch (e) {
        console.error("confirmStatusChange:", e);
        showToast("Error updating status: " + e.message, "error");
    } finally {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Update Status';
    }
}


// ============================================================
// SECTION 12 — MODAL & TOAST HELPERS
// Small UI helpers for opening/closing modals and showing
// transient toast notifications.
// ============================================================

/**
 * Resets and opens the "Add Transaction" modal.
 * Clears the Tom Select instance (if initialised) or falls back
 * to resetting the raw select value, then clears all other fields.
 */
function openTxModal() {
    const ts = document.getElementById("modalProduct")?.tomselect;
    if (ts) ts.clear(); // Reset Tom Select properly to clear the rendered selection.
    else document.getElementById("modalProduct").value = "";

    document.getElementById("modalType").value    = "";
    document.getElementById("modalStatus").value  = "Completed";
    document.getElementById("modalQty").value     = "";
    document.getElementById("modalNote").value    = "";
    document.getElementById("stockPreview").style.display = "none";
    document.getElementById("txModal").style.display     = "flex";
}

/** Closes the "Add Transaction" modal. */
function closeTxModal() { document.getElementById("txModal").style.display = "none"; }

/**
 * Shows the result modal (success or error) after saving a transaction.
 * The icon and colour change based on the isError flag.
 *
 * @param {string}  title   — modal heading
 * @param {string}  message — modal body text
 * @param {boolean} isError — true for a red error state, false for green success
 */
function showResultModal(title, message, isError = false) {
    const wrap = document.getElementById("resultIconWrap");
    const icon = document.getElementById("resultIcon");
    wrap.className  = `result-icon-wrap ${isError ? "error" : "success"}`;
    icon.className  = `fas fa-${isError ? "times" : "check"}`;
    document.getElementById("resultTitle").textContent   = title;
    document.getElementById("resultMessage").textContent = message;
    document.getElementById("resultModal").style.display = "flex";
}

/**
 * Shows a self-dismissing toast notification at the bottom of the screen.
 * The toast fades out after 3 seconds and is removed from the DOM.
 *
 * @param {string} message        — text to display
 * @param {"success"|"error"} type — controls the icon and colour
 */
function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");
    const toast     = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fas fa-${type === "success" ? "check-circle" : "exclamation-circle"}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = "fadeOutToast 0.3s ease forwards";
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


// ============================================================
// SECTION 13 — DOM EVENT WIRING
// All event listeners are registered inside DOMContentLoaded
// to guarantee elements exist before we query them.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    // ── Mobile sidebar ──────────────────────────────────────
    const hamburger = document.getElementById("hamburgerBtn");
    const closeBtn  = document.getElementById("closeBtn");
    const sidebar   = document.getElementById("sidebar");
    const overlay   = document.getElementById("overlay");

    const toggleSidebar = () => { sidebar.classList.toggle("open");  overlay.classList.toggle("show"); };
    const closeSidebar  = () => { sidebar.classList.remove("open");  overlay.classList.remove("show"); };

    hamburger?.addEventListener("click", e => { e.stopPropagation(); toggleSidebar(); });
    closeBtn?.addEventListener("click", closeSidebar);
    overlay?.addEventListener("click", closeSidebar);

    // ── Transaction modal ────────────────────────────────────
    document.getElementById("openModalBtn")?.addEventListener("click", openTxModal);
    document.getElementById("closeModalBtn")?.addEventListener("click", closeTxModal);
    document.getElementById("cancelModalBtn")?.addEventListener("click", closeTxModal);
    // Click outside the modal card also closes it.
    document.getElementById("txModal")?.addEventListener("click", e => {
        if (e.target === document.getElementById("txModal")) closeTxModal();
    });
    document.getElementById("confirmTxBtn")?.addEventListener("click",  () => saveTransaction(false));
    document.getElementById("saveAnotherBtn")?.addEventListener("click", () => saveTransaction(true));

    // Re-run the stock preview whenever any of these fields change.
    ["modalProduct", "modalType", "modalQty", "modalStatus"].forEach(id => {
        document.getElementById(id)?.addEventListener("input",  updateStockPreview);
        document.getElementById(id)?.addEventListener("change", updateStockPreview);
    });

    // ── Result modal ─────────────────────────────────────────
    document.getElementById("resultOkBtn")?.addEventListener("click", () => {
        document.getElementById("resultModal").style.display = "none";
    });

    // ── Status modal ─────────────────────────────────────────
    document.getElementById("closeStatusModalBtn")?.addEventListener("click", closeStatusModal);
    document.getElementById("cancelStatusModalBtn")?.addEventListener("click", closeStatusModal);
    document.getElementById("statusModal")?.addEventListener("click", e => {
        if (e.target === document.getElementById("statusModal")) closeStatusModal();
    });
    document.getElementById("confirmStatusBtn")?.addEventListener("click", confirmStatusChange);

    // ── Filter panel toggle ──────────────────────────────────
    const filterToggleBtn = document.getElementById("filterToggleBtn");
    const filterPanel     = document.getElementById("filterPanel");
    filterToggleBtn?.addEventListener("click", () => {
        const isOpen = filterPanel.style.display !== "none";
        filterPanel.style.display = isOpen ? "none" : "block";
        filterToggleBtn.classList.toggle("active", !isOpen);
    });

    // Clear all filter inputs and re-apply.
    document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
        document.getElementById("filterDateFrom").value = "";
        document.getElementById("filterDateTo").value   = "";
        document.getElementById("filterType").value     = "";
        document.getElementById("filterStatus").value   = "";
        document.getElementById("searchInput").value    = "";
        applyFilters();
    });

    // Any filter or search change triggers a full re-filter.
    document.getElementById("searchInput")?.addEventListener("input",   applyFilters);
    document.getElementById("filterType")?.addEventListener("change",   applyFilters);
    document.getElementById("filterStatus")?.addEventListener("change", applyFilters);
    document.getElementById("filterDateFrom")?.addEventListener("change", applyFilters);
    document.getElementById("filterDateTo")?.addEventListener("change",   applyFilters);
    document.getElementById("filterProductInput")?.addEventListener("input", applyFilters);

    // ── Pagination ───────────────────────────────────────────
    document.getElementById("prevBtn")?.addEventListener("click", () => {
        if (currentPage > 1) { currentPage--; renderPage(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    document.getElementById("nextBtn")?.addEventListener("click", () => {
        const total = Math.ceil(filteredTx.length / PAGE_SIZE);
        if (currentPage < total) { currentPage++; renderPage(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
});


// ============================================================
// EXPORTS
// Named exports allow other modules or unit tests to reuse
// individual helpers without importing the full module.
// ============================================================
export { getCachedUserData, logActivity, formatDate, escHtml, updateSummaryStats };