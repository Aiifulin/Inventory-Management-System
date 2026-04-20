// Stock_Transactions.js
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
    collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc,
    updateDoc, query, orderBy, where, serverTimestamp, Timestamp, limit
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";

// ─── Firestore path helpers ───────────────────────────────────────────────────
const txCol   = (year) => collection(db, "stock_transactions", String(year), "transactions");
const txDoc   = (year, id) => doc(db, "stock_transactions", String(year), "transactions", id);
const yearDoc = (year) => doc(db, "stock_transactions", String(year));

// ─── State ────────────────────────────────────────────────────────────────────
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

// ─── User helpers ─────────────────────────────────────────────────────────────
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

// ================================================
// AUTH — parallel: user data + products + year tabs fire at the same time
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.replace("index.html"); return; }

    currentUser = user;

    // ✅ Resolve user role FIRST before anything renders
    const userData = await getCachedUserData(user.uid);
    isAdmin = userData?.role?.toLowerCase() === "admin";

    const nameEl = document.getElementById("userNameDisplay");
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    const openBtn = document.getElementById("openModalBtn");
    if (openBtn && isAdmin) openBtn.style.display = "inline-flex";

    // ✅ Now safe to fire in parallel — isAdmin is already set
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

// ─── Load products ────────────────────────────────────────────────────────────
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

        // ✅ Initialize Tom Select after options are populated
        if (modalSelect && !modalSelect.tomselect) {
            new TomSelect('#modalProduct', {
                placeholder: 'Search or select a product…',
                allowEmptyOption: true,
                maxOptions: null, // show all results
            });
        }

    } catch (e) { console.error("loadProducts:", e); }
}

// ─── Migration ────────────────────────────────────────────────────────────────
async function migrateFlatDocs() {
    // ← Skip entirely if already done
    if (localStorage.getItem('tx_migration_done')) return;

    try {
        const rootSnap  = await getDocs(collection(db, "stock_transactions"));
        const toMigrate = [];
        rootSnap.forEach(docSnap => {
            if (/^\d{4}$/.test(docSnap.id)) return;
            const d = docSnap.data();
            if (d.createdAt?.seconds) toMigrate.push({ id: docSnap.id, data: d });
        });

        if (toMigrate.length === 0) {
            localStorage.setItem('tx_migration_done', '1'); // ← never check again
            return;
        }

        for (const { id, data } of toMigrate) {
            const year = new Date(data.createdAt.seconds * 1000).getFullYear();
            await setDoc(txDoc(year, id), data);
            await setDoc(yearDoc(year), { exists: true }, { merge: true });
            await deleteDoc(doc(db, "stock_transactions", id));
        }

        localStorage.setItem('tx_migration_done', '1'); // ← done, never run again
    } catch (e) { console.error("migrateFlatDocs:", e); }
}

// ─── Year tabs ────────────────────────────────────────────────────────────────
async function initYearTabs() {
    setLoading(true);
    const currentYear = new Date().getFullYear();
    await migrateFlatDocs(); // now near-instant after first run

    // Cache the years list in sessionStorage
    const cachedYears = sessionStorage.getItem('tx_years');
    if (cachedYears) {
        allYears = JSON.parse(cachedYears);
        if (!allYears.includes(currentYear)) allYears.unshift(currentYear);
    } else {
        try {
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

async function switchYear(year) {
    if (year === activeYear && txCache[year] != null) return;
    activeYear = year;
    renderYearTabs();
    if (txCache[year] != null) { applyFilters(); updateSummaryStats(); }
    else await loadYearTransactions(year);
}

function formatDate(ts) {
    if (!ts?.seconds) return "";
    return new Date(ts.seconds * 1000).toLocaleString("en-US", {
        month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
}

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

// ─── Filter + search ──────────────────────────────────────────────────────────
function applyFilters() {
    const search    = (document.getElementById("searchInput")?.value   || "").toLowerCase().trim();
    const type      = document.getElementById("filterType")?.value      || "";
    const status    = document.getElementById("filterStatus")?.value    || "";
    const dateFrom  = document.getElementById("filterDateFrom")?.value  || "";
    const dateTo    = document.getElementById("filterDateTo")?.value    || "";
    const source    = txCache[activeYear] || [];

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
        const matchType    = !type    || tx.type    === type;
        const matchStatus  = !status  || tx.status  === status;

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

// ─── Render table ─────────────────────────────────────────────────────────────
function renderPage() {
    const tbody = document.getElementById("txTableBody");
    if (!tbody || isLoading) return;

    const totalPages = Math.max(1, Math.ceil(filteredTx.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * PAGE_SIZE;
    const rows  = filteredTx.slice(start, start + PAGE_SIZE);

    if (filteredTx.length === 0) {
        const source = txCache[activeYear] || [];
        const msg    = source.length === 0 ? `No transactions recorded for ${activeYear}.` : "No transactions match your filters.";
        tbody.innerHTML = `<tr class="empty-state"><td colspan="9"><div class="empty-state-icon"><i class="fas fa-arrows-rotate"></i></div>${msg}</td></tr>`;
    } else {
        tbody.innerHTML = rows.map(tx => {
            const isPositive = tx.type === "Stock In";
            const deltaSign  = isPositive ? "+" : "-";
            const deltaClass = isPositive ? "positive" : "negative";
            const badgeClass = { "Stock In": "stock-in", "Sold": "sold", "Adjustment": "adjustment" }[tx.type] || "adjustment";


            const statusKey   = (tx.status || "Completed").toLowerCase();
            const statusIcons = { completed: "✅", pending: "⏳", cancelled: "❌" };
            const statusIcon  = statusIcons[statusKey] || "✅";
            const clickable   = isAdmin ? " clickable" : "";
            const clickAttr   = isAdmin ? `data-txid="${tx.id}" data-year="${tx.year}" data-txname="${escHtml(tx.productName)} — ${escHtml(tx.type)}"` : "";
            const title       = isAdmin ? `title="Click to change status"` : "";
            const statusBadge = `<span class="status-badge ${statusKey}${clickable}" ${clickAttr} ${title}>${statusIcon} ${tx.status}</span>`;

            const threshold  = productsMap[tx.productId]?.lowStockThreshold || 10;
            const afterClass = tx.stockAfter === 0 ? "danger" : tx.stockAfter <= threshold ? "warn" : "ok";

            const editedDot = tx.updatedAt
                ? `<span style="font-size:10px;font-weight:600;margin-left:6px;vertical-align:middle;padding:1px 5px;border-radius:4px;background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.3);letter-spacing:0.02em;" title="Edited">edited</span>`
                : "";

            const updatedOnCell = tx.updatedAt
                ? `<span class="audit-line"><i class="fas fa-pen" style="font-size:11px;margin-right:4px;"></i>${tx.updatedStr || "—"}</span>`
                : tx.dateStr
                ? `<span class="audit-line" style="color:var(--text-secondary);"><i class="fas fa-clock" style="font-size:11px;margin-right:4px;"></i>${tx.dateStr}</span>`
                : `<span style="color:var(--text-secondary);font-size:12px;">—</span>`;

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

function escHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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

function setLoading(loading) {
    isLoading = loading;
    document.getElementById("txSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("txTableWrapper")?.classList.toggle("hidden", loading);
    document.getElementById("paginationBar")?.classList.toggle("hidden", loading);
}

async function logActivity(action, target) {
    try {
        await addDoc(collection(db, "activities"), {
            action, target, user: currentUser?.email || "Admin", timestamp: serverTimestamp()
        });
    } catch (e) { console.error("logActivity:", e); }
}

// ─── Stock warning helper ─────────────────────────────────────────────────────
function setStockWarning(show, title = "", desc = "") {
    const banner = document.getElementById("stockWarning");
    const confirmBtn = document.getElementById("confirmTxBtn");
    const anotherBtn = document.getElementById("saveAnotherBtn");

    if (!banner) return;
    banner.style.display = show ? "flex" : "none";
    if (show) {
        document.getElementById("stockWarningTitle").textContent = title;
        document.getElementById("stockWarningDesc").textContent  = desc;
    }

    // Block both save buttons while warning is active
    if (confirmBtn) confirmBtn.disabled = show;
    if (anotherBtn) anotherBtn.disabled = show;
}

function updateStockPreview() {
    const productId = document.getElementById("modalProduct").value;
    const type      = document.getElementById("modalType").value;
    const qty       = parseInt(document.getElementById("modalQty").value) || 0;
    const statusVal = document.getElementById("modalStatus")?.value;
    const preview   = document.getElementById("stockPreview");

    // Clear warning by default
    setStockWarning(false);

    if (!productId || !type || qty <= 0) { preview.style.display = "none"; return; }
    const product = productsMap[productId];
    if (!product)  { preview.style.display = "none"; return; }

    const before  = product.stock;
    const isIn    = type === "Stock In";
    const isDeduct = type === "Sold" || type === "Adjustment";


    // ─── Inline stock warning (replaces confirm()) ─────────────────────────────
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

    noteEl.textContent = statusVal === "Pending"    ? "⏳ Stock will update when Completed"
                       : statusVal === "Cancelled"  ? "❌ Cancelled — stock won't change"
                       : "";

    preview.style.display = "flex";
}

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

    // ─── Hard block — should never reach here due to UI, but safety net ────────
    if (status === "Completed" && !isIn && qty > stockBefore) {
        showToast(`Cannot ${type.toLowerCase()} ${qty} units — only ${stockBefore} in stock.`, "error");
        return;
    }

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
        await setDoc(yearDoc(thisYear), { exists: true }, { merge: true });

        if (status === "Completed") {
            await updateDoc(doc(db, "products", productId), { stock: stockAfter });
            productsMap[productId].stock = stockAfter;
        }

        const statusNote = status !== "Completed" ? ` [${status}]` : "";
        await logActivity(`${type}${statusNote}`, `${product.name} (Qty: ${isIn ? "+" : "-"}${qty})`);
        sessionStorage.removeItem("dashboard_cache");
        sessionStorage.removeItem("tx_years");
        sessionStorage.removeItem("products_cache");

        if (!allYears.includes(thisYear)) allYears.unshift(thisYear);
        delete txCache[thisYear];
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
        // Re-run preview to restore correct button state
        updateStockPreview();
    }
}

// ─── Status modal ─────────────────────────────────────────────────────────────
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

    if (tx.updatedAt) {
        auditUpdated.textContent  = tx.updatedStr || "—";
        auditEditedBy.textContent = tx.editedBy   || "unknown";
        auditUpdatedRow.style.display = "flex";
    } else {
        auditUpdatedRow.style.display = "none";
    }

    document.getElementById("statusModal").style.display = "flex";
}

function closeStatusModal() {
    document.getElementById("statusModal").style.display = "none";
    statusModalTxId   = null;
    statusModalTxYear = null;
}

async function confirmStatusChange() {
    if (!statusModalTxId || !statusModalTxYear) return;

    const newStatus = document.getElementById("statusModalSelect").value;
    const btn       = document.getElementById("confirmStatusBtn");
    const tx        = (txCache[statusModalTxYear] || []).find(t => t.id === statusModalTxId);
    if (!tx) { closeStatusModal(); return; }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating…';

    try {
        const userData   = await getCachedUserData(currentUser.uid);
        const editorName = userData?.name || currentUser?.email || "Admin";
        const updateData = { status: newStatus, updatedAt: serverTimestamp(), editedBy: editorName };

        const wasCompleted = tx.status === "Completed";
        const nowCompleted = newStatus  === "Completed";
        const product      = productsMap[tx.productId];

        if (!wasCompleted && nowCompleted && product) {
            const isIn     = tx.type === "Stock In";
            const newStock = isIn ? product.stock + tx.qty : Math.max(0, product.stock - tx.qty);
            updateData.stockAfter = newStock;
            await updateDoc(doc(db, "products", tx.productId), { stock: newStock });
            productsMap[tx.productId].stock = newStock;
        }

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

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openTxModal() {
    const ts = document.getElementById("modalProduct")?.tomselect;
    if (ts) ts.clear(); // ✅ reset Tom Select properly
    else document.getElementById("modalProduct").value = "";

    document.getElementById("modalType").value    = "";
    document.getElementById("modalStatus").value  = "Completed";
    document.getElementById("modalQty").value     = "";
    document.getElementById("modalNote").value    = "";
    document.getElementById("stockPreview").style.display = "none";
    document.getElementById("txModal").style.display     = "flex";
}

function closeTxModal() { document.getElementById("txModal").style.display = "none"; }

function showResultModal(title, message, isError = false) {
    const wrap = document.getElementById("resultIconWrap");
    const icon = document.getElementById("resultIcon");
    wrap.className  = `result-icon-wrap ${isError ? "error" : "success"}`;
    icon.className  = `fas fa-${isError ? "times" : "check"}`;
    document.getElementById("resultTitle").textContent   = title;
    document.getElementById("resultMessage").textContent = message;
    document.getElementById("resultModal").style.display = "flex";
}

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

// ─── DOM event wiring ─────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    const hamburger = document.getElementById("hamburgerBtn");
    const closeBtn  = document.getElementById("closeBtn");
    const sidebar   = document.getElementById("sidebar");
    const overlay   = document.getElementById("overlay");

    const toggleSidebar = () => { sidebar.classList.toggle("open");  overlay.classList.toggle("show"); };
    const closeSidebar  = () => { sidebar.classList.remove("open");  overlay.classList.remove("show"); };

    hamburger?.addEventListener("click", e => { e.stopPropagation(); toggleSidebar(); });
    closeBtn?.addEventListener("click", closeSidebar);
    overlay?.addEventListener("click", closeSidebar);

    document.getElementById("openModalBtn")?.addEventListener("click", openTxModal);
    document.getElementById("closeModalBtn")?.addEventListener("click", closeTxModal);
    document.getElementById("cancelModalBtn")?.addEventListener("click", closeTxModal);
    document.getElementById("txModal")?.addEventListener("click", e => {
        if (e.target === document.getElementById("txModal")) closeTxModal();
    });
    document.getElementById("confirmTxBtn")?.addEventListener("click", () => saveTransaction(false));
    document.getElementById("saveAnotherBtn")?.addEventListener("click", () => saveTransaction(true));

    ["modalProduct", "modalType", "modalQty", "modalStatus"].forEach(id => {
        document.getElementById(id)?.addEventListener("input",  updateStockPreview);
        document.getElementById(id)?.addEventListener("change", updateStockPreview);
    });

    document.getElementById("resultOkBtn")?.addEventListener("click", () => {
        document.getElementById("resultModal").style.display = "none";
    });

    document.getElementById("closeStatusModalBtn")?.addEventListener("click", closeStatusModal);
    document.getElementById("cancelStatusModalBtn")?.addEventListener("click", closeStatusModal);
    document.getElementById("statusModal")?.addEventListener("click", e => {
        if (e.target === document.getElementById("statusModal")) closeStatusModal();
    });
    document.getElementById("confirmStatusBtn")?.addEventListener("click", confirmStatusChange);

    const filterToggleBtn = document.getElementById("filterToggleBtn");
    const filterPanel     = document.getElementById("filterPanel");
    filterToggleBtn?.addEventListener("click", () => {
        const isOpen = filterPanel.style.display !== "none";
        filterPanel.style.display = isOpen ? "none" : "block";
        filterToggleBtn.classList.toggle("active", !isOpen);
    });

    document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
        document.getElementById("filterDateFrom").value = "";
        document.getElementById("filterDateTo").value   = "";
        document.getElementById("filterType").value     = "";
        document.getElementById("filterStatus").value   = "";
        document.getElementById("searchInput").value    = "";
        applyFilters();
    });

    document.getElementById("searchInput")?.addEventListener("input",  applyFilters);
    document.getElementById("filterType")?.addEventListener("change",  applyFilters);
    document.getElementById("filterStatus")?.addEventListener("change",  applyFilters);
    document.getElementById("filterDateFrom")?.addEventListener("change", applyFilters);
    document.getElementById("filterDateTo")?.addEventListener("change",   applyFilters);
    document.getElementById("filterProductInput")?.addEventListener("input", applyFilters); 


    document.getElementById("prevBtn")?.addEventListener("click", () => {
        if (currentPage > 1) { currentPage--; renderPage(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
    document.getElementById("nextBtn")?.addEventListener("click", () => {
        const total = Math.ceil(filteredTx.length / PAGE_SIZE);
        if (currentPage < total) { currentPage++; renderPage(); window.scrollTo({ top: 0, behavior: "smooth" }); }
    });
});


export { getCachedUserData, logActivity, formatDate, escHtml, updateSummaryStats };