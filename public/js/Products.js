import { collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc, query } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { applyRoleBasedNavigation } from "./access-control.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBAL STATE
// allProducts      — master list of all fetched (non-archived) products
// filteredProducts — the subset currently shown after search/filter/sort
// currentSortDir   — 'asc' or 'desc', toggled by the sort direction button
// currentUser      — the signed-in Firebase Auth user object
// isAdmin          — true if the user's role is 'admin'; gates write actions
// isProductsLoading — true while Firestore fetch is in progress; blocks renders
// PAGE_SIZE         — how many products to show per page in pagination (if implemented)
//
// ============================================================
let allProducts = [];
let filteredProducts = []; 
let currentSortDir = 'asc';
let currentUser = null;
let isAdmin = false; 
let isProductsLoading = true;
const PAGE_SIZE = 20;
let currentPage = 1;

// ============================================================
// SECTION 1 — PRODUCTS CACHE
// Products are cached in sessionStorage with a 5-minute TTL so
// navigating away and back doesn't trigger another Firestore read.
// Firestore Timestamps are converted to plain objects before
// serialisation (they aren't JSON-safe) and restored on read.
// ============================================================
const PRODUCTS_CACHE_KEY = 'products_cache';


/** Serialises the product list and writes it to sessionStorage.
 *  Firestore Timestamps are converted to { _type, seconds } objects. */
function saveProductsCache(products) {
    try {
        // Firestore Timestamps aren't JSON-serialisable — convert to millis
        const serialisable = products.map(p => ({
            ...p,
            createdAt: p.createdAt?.seconds
                ? { _type: 'ts', seconds: p.createdAt.seconds }
                : null
        }));
        sessionStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify({ products: serialisable, cachedAt: Date.now() }));
    } catch (e) {
        console.warn("Could not save products cache:", e);
    }
}


/**
 * Reads and deserialises the product cache.
 * Returns null if nothing is cached, the TTL has expired, or parsing fails.
 * Restores a synthetic .toDate() on Timestamp objects so date-sorting works.
 */
function loadProductsCache() {
    try {
        const raw = sessionStorage.getItem(PRODUCTS_CACHE_KEY);
        if (!raw) return null;
        const { products, cachedAt } = JSON.parse(raw);
        // 5-minute TTL — same as your logs cache
        if (Date.now() - cachedAt > 5 * 60 * 1000) return null;
        // Restore createdAt so sorting by date still works
        return products.map(p => ({
            ...p,
            createdAt: p.createdAt?._type === 'ts'
                ? { seconds: p.createdAt.seconds, toDate: () => new Date(p.createdAt.seconds * 1000) }
                : null
        }));
    } catch {
        return null;
    }
}

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Cached per-UID in sessionStorage so repeat visits skip the Firestore read.
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null}
 */
async function getCachedUserData(uid) {
    const key = `user_data_${uid}`;
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
 * Writes a single activity entry to the "activities" Firestore collection.
 * Called after any create / edit / archive / import action.
 * @param {string} action     — verb describing what happened, e.g. "Archived Product"
 * @param {string} targetName — the name of the affected product or record
 */
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin";
        await addDoc(collection(db, "activities"), {
            action, target: targetName, user: userEmail, timestamp: serverTimestamp()
        });
    } catch (e) {
        console.error("Error logging activity", e);
    }
}


// ============================================================
// SECTION 2 — AUTH LISTENER
// Runs once on page load. Redirects to login if no session exists.
// Fires getCachedUserData(), fetchProducts(), and loadCategoryFilter()
// in parallel via Promise.all so none waits on the others.
// Once user role is resolved, role-gated UI elements are shown/hidden.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    currentUser = user;

    // 🔥 Fire user data AND both data fetches simultaneously
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        fetchProducts(),
        loadCategoryFilter()
    ]);

    isAdmin = userData?.role?.toLowerCase() === 'admin';

    // Apply role-dependent UI after data is already loading
    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    localStorage.setItem("user_uid",  user.uid);
    localStorage.setItem("user_role", isAdmin ? "admin" : "user");
    applyRoleBasedNavigation(isAdmin);

    if (isAdmin) {
        const bulkBtn   = document.getElementById('bulkUploadBtn');
        const addBtn    = document.getElementById('addProductBtn');
        const importBtn = document.getElementById('importBtn');
        if (bulkBtn)   bulkBtn.style.display   = 'flex';
        if (addBtn)    addBtn.style.display    = 'flex';
        if (importBtn) importBtn.style.display = 'flex';
        // Re-render now that isAdmin is set, so action buttons appear
        renderTable(filteredProducts);
    }

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.style.display = 'flex';

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

// ============================================================
// SECTION 3 — DATA FETCHING
// ============================================================

/**
 * Loads all non-archived products from Firestore (or cache).
 * On success, populates allProducts and calls applyFilters() to render.
 * Pass forceRefresh=true to bypass the cache (used after imports/archives).
 * @param {boolean} forceRefresh
 */

async function fetchProducts(forceRefresh = false) {
    setProductsLoading(true);

    if (!forceRefresh) {
        const cached = loadProductsCache();
        if (cached) {
            allProducts = cached;
            setProductsLoading(false);
            applyFilters();
            return;
        }
    }

    try {
        const q = query(collection(db, "products"), where("archived", "==", false));
        const querySnapshot = await getDocs(q);
        allProducts = [];
        querySnapshot.forEach((docSnap) => {
            allProducts.push({ id: docSnap.id, ...docSnap.data() });
        });
        saveProductsCache(allProducts);
    } catch (error) {
        console.error("Error loading products:", error);
        allProducts = [];
    } finally {
        setProductsLoading(false);
        applyFilters();
    }
}

/**
 * Toggles the skeleton loaders and hides/shows the table and mobile list.
 * Called with true at the start of a fetch and false when it completes.
 * @param {boolean} loading
 */

function setProductsLoading(loading) {
    isProductsLoading = loading;

    const desktopSkeleton = document.getElementById("desktopProductsSkeleton");
    const mobileSkeleton  = document.getElementById("mobileProductsSkeleton");
    const tableContainer  = document.querySelector(".table-container.desktop-only");
    const mobileList      = document.getElementById("mobileProductList");

    desktopSkeleton?.classList.toggle("visible", loading);
    mobileSkeleton?.classList.toggle("visible", loading);
    tableContainer?.classList.toggle("hidden", loading);
    mobileList?.classList.toggle("hidden", loading);
    document.getElementById("paginationBar")?.classList.toggle("hidden", loading);
}

// ============================================================
// SECTION 4 — FILTER & SORT
// applyFilters() reads every filter control, runs the full
// product list through search / category / status / price checks,
// then sorts the result and hands it to renderTable().
// It is called on every filter change event.
// Pagination is implemented by slicing filteredProducts in renderTable()
// ============================================================

/**
 * Filters allProducts against the current search text, category,
 * price range, and stock status, then sorts by the chosen field
 * and direction. Writes the result to filteredProducts and re-renders.
 */
function applyFilters() {
    const searchVal     = document.getElementById("searchInput").value.trim().toLowerCase();
    const catVal        = document.getElementById("filterCategory").value;
    const priceRangeVal = document.getElementById("filterPrice").value; 
    const statusVal     = document.getElementById("filterStatus").value;
    const sortVal       = document.getElementById("filterSort").value;

    let result = allProducts.filter(p => {
        const prodName = (p.name     || "").toLowerCase();
        const prodCat  = (p.category || "").toLowerCase();
        const prodId   = (p.id       || "").toLowerCase();

        let prodDate = "";
        if (p.createdAt && p.createdAt.toDate) {
            const d = p.createdAt.toDate();
            prodDate = d.toLocaleDateString("en-US", { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
            prodDate += " " + d.toLocaleDateString("en-US", { month: 'short' }).toLowerCase();
            prodDate += " " + d.toLocaleDateString("en-US");
        }

        const matchesSearch   = prodName.includes(searchVal) || prodCat.includes(searchVal) || prodId.includes(searchVal) || prodDate.includes(searchVal);
        const matchesCategory = catVal === "" || p.category === catVal;
        
        const stock     = Number(p.stock) || 0;
        const price     = Number(p.price) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;

        let pStatus = 'in-stock';
        if (stock === 0)            pStatus = 'out-of-stock';
        else if (stock <= threshold) pStatus = 'low-stock';
        
        const matchesStatus = statusVal === "" || pStatus === statusVal;

        let matchesPrice = true;
        if (priceRangeVal) {
            if (priceRangeVal === "1000+") {
                matchesPrice = price >= 1000;
            } else {
                const [min, max] = priceRangeVal.split("-").map(Number);
                matchesPrice = price >= min && price <= max;
            }
        }

        return matchesSearch && matchesCategory && matchesStatus && matchesPrice;
    });

    result.sort((a, b) => {
        let valA, valB;
        if (sortVal === 'price')      { valA = Number(a.price) || 0; valB = Number(b.price) || 0; }
        else if (sortVal === 'stock') { valA = Number(a.stock) || 0; valB = Number(b.stock) || 0; }
        else if (sortVal === 'date')  { valA = a.createdAt?.seconds || 0; valB = b.createdAt?.seconds || 0; }
        else { valA = (a.name || "").toLowerCase(); valB = (b.name || "").toLowerCase(); }

        if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    filteredProducts = result;
    currentPage = 1;
    renderTable(filteredProducts);
}

// ============================================================
// SECTION 5 — RENDER
// renderTable() is the single function responsible for writing
// product data to the DOM. It builds both the desktop <table>
// rows and the mobile card list from the same product array.
// Admin-only action buttons (Edit / Delete) are injected only
// when isAdmin is true.
// ============================================================
function renderTable(productsToRender) {
    const tableBody = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");
    const tableHead = document.querySelector(".products-table thead tr");

    if (isProductsLoading) return;

    // ── Pagination slice ──────────────────────────────────
    const totalPages   = Math.max(1, Math.ceil(productsToRender.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const start        = (currentPage - 1) * PAGE_SIZE;
    const pageProducts = productsToRender.slice(start, start + PAGE_SIZE);
    // ─────────────────────────────────────────────────────

    if (tableHead) {
        tableHead.innerHTML = `
            <th style="width: 80px;">ID</th> <th style="width: 35%;">Product</th>
            <th>Category</th>
            <th>Price</th>
            <th>Stock</th>
            <th>Status</th>
            <th>Added</th>
            <th>Actions</th>
        `;
    }

    if (tableBody) tableBody.innerHTML = "";
    if (mobileList) mobileList.innerHTML = "";

    if (productsToRender.length === 0) {
        if (tableBody)  tableBody.innerHTML  = `<tr><td colspan="8" style="text-align:center; padding:30px; color:#9ca3af;">No products found.</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div style="text-align:center; padding:30px; color:#9ca3af;">No products found.</div>`;
        return;
    }

    pageProducts.forEach(p => {
        const docId    = p.id;
        const shortId = p.id;

        let imageHtml = p.imageUrl
        ? `<img src="${p.imageUrl}" alt="${p.name}"
                loading="lazy" decoding="async"
                style="width:45px;height:45px;border-radius:8px;object-fit:cover;
                       border:1px solid var(--border-color);"
                onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
           <div class="product-img-placeholder" style="display:none"><i class="fa-regular fa-image"></i></div>`
        : `<div class="product-img-placeholder"><i class="fa-regular fa-image"></i></div>`;
    
        let mobileImageHtml = p.imageUrl
            ? `<img src="${p.imageUrl}" alt="${p.name}"
                    loading="lazy" decoding="async"
                    style="width:60px;height:60px;border-radius:8px;object-fit:cover;
                           border:1px solid var(--border-color);"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
               <div class="card-img" style="display:none"><i class="fa-regular fa-image"></i></div>`
            : `<div class="card-img"><i class="fa-regular fa-image"></i></div>`;

        const stock     = Number(p.stock) || 0;
        const threshold = Number(p.lowStockThreshold) || 10;

        let statusText  = "In Stock";
        let statusClass = "in-stock";
        if (stock === 0)            { statusText = "Out of Stock"; statusClass = "out-of-stock"; }
        else if (stock <= threshold) { statusText = "Low Stock";   statusClass = "low-stock"; }

        let dateAdded = "N/A";
        if (p.createdAt && p.createdAt.toDate) {
            dateAdded = p.createdAt.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
        }

        const tagsHtml = (p.variations || []).map(v => 
            v.size ? `<span class="v-tag">${v.size}</span>` : ''
        ).join('');

        const attributesHtml = (p.attributes || []).map(a => 
            `<span class="v-tag" style="background-color: rgba(224, 242, 254, 0.2); color: #0284c7; border: 1px solid rgba(186, 230, 253, 0.3);">
                ${a.name}: ${a.value}
             </span>`
        ).join('');

        const allTags = tagsHtml + attributesHtml;

        const adminActions = isAdmin ? `
            <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editProduct('${docId}')" style="cursor: pointer;"></i>
            <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
        ` : '';

        const mobileAdminActions = isAdmin ? `
            <button class="btn-card-action" onclick="editProduct('${docId}')"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="btn-card-action btn-card-delete delete-btn" data-id="${docId}"><i class="fa-regular fa-trash-can"></i></button>
        ` : '';

        if (tableBody) {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td><span class="id-badge" title="${docId}">${shortId}</span></td>
                <td>
                    <div class="product-cell">
                        ${imageHtml}
                        <div class="product-info">
                            <h4>${p.name}</h4>
                            <div class="variation-tags" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px;">
                                ${allTags} 
                            </div>
                        </div>
                    </div>
                </td>
                <td>${p.category}</td>
                <td>₱${Number(p.price).toFixed(2)}</td>
                <td>${p.stock}</td>
                <td><span class="status-pill ${statusClass}">${statusText}</span></td>
                <td>${dateAdded}</td>
                <td class="actions">${adminActions}</td>
            `;
            tableBody.appendChild(row);
        }

        if (mobileList) {
            const card = document.createElement("div");
            card.className = "mobile-card";
            card.innerHTML = `
                <div class="mobile-id-header">ID: <span class="id-badge">${shortId}</span></div>
                <div class="card-top">
                    ${mobileImageHtml}
                    <div class="card-header-text">
                        <h3 class="card-title">${p.name}</h3>
                        <div class="mobile-tags" style="display: flex; gap: 4px; flex-wrap: wrap;">${allTags}</div>
                    </div>
                    <div class="card-badge"><span class="status-pill ${statusClass}">${statusText}</span></div>
                </div>
                <div class="card-details-grid">
                    <div class="detail-item"><label>Price:</label> <span>₱${Number(p.price).toFixed(2)}</span></div>
                    <div class="detail-item"><label>Stock:</label> <span>${p.stock}</span></div>
                </div>
                <div class="card-actions">${mobileAdminActions}</div>
            `;
            mobileList.appendChild(card);
        }
    });

    if (isAdmin) attachDeleteListeners();
    renderPagination();
}

// PAGINATION
function renderPagination() {
    const bar = document.getElementById("paginationBar");
    if (!bar) return;

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

    document.getElementById("pageInfo").textContent = `Page ${currentPage} of ${totalPages}`;
    document.getElementById("prevPageBtn").disabled  = currentPage <= 1;
    document.getElementById("nextPageBtn").disabled  = currentPage >= totalPages;
}

/**
 * Navigates to the Edit Product page for the given product ID.
 * Exposed on window so it can be called from inline onclick attributes.
 * Blocks navigation and alerts if the user is not an admin.
 */

window.editProduct = function(id) {
    if (isAdmin) {
        window.location.href = `Edit_Product.html?id=${id}`;
    } else {
        alert("Access Denied: Only Admin can edit products.");
    }
}

/**
 * Shows the archive confirmation modal and returns a Promise that
 * resolves to true (confirmed) or false (cancelled).
 * Used before any destructive action so the user must explicitly confirm.
 * @param {string} productName — displayed in the modal body
 * @returns {Promise<boolean>}
 */

function confirmAction(productName) {
    const modal      = document.getElementById('confirmModal');
    const nameSpan   = document.getElementById('archive-product-name');
    const confirmBtn = document.getElementById('confirm-archive-btn');
    const cancelBtn  = document.getElementById('cancel-archive-btn');
    
    nameSpan.innerText = productName;
    modal.style.display = 'flex';

    return new Promise((resolve) => {
        confirmBtn.onclick = () => { modal.style.display = 'none'; resolve(true); };
        cancelBtn.onclick  = () => { modal.style.display = 'none'; resolve(false); };
    });
}
/**
 * Attaches click listeners to every .delete-btn element currently in the DOM.
 * Must be called after renderTable() since the buttons are created dynamically.
 * On confirm: sets archived=true in Firestore, logs the activity, clears
 * the products cache, removes the item from allProducts, and re-renders.
 */

function attachDeleteListeners() {
    if (!isAdmin) return;

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const target = e.target.closest('.delete-btn');
            if (!target) return;

            const idToArchive      = target.getAttribute('data-id');
            const productToArchive = allProducts.find(p => p.id === idToArchive);
            const nameToLog        = productToArchive ? productToArchive.name : "Unknown Product";

            const isConfirmed = await confirmAction(nameToLog);
            if (!isConfirmed) return;

            try {
                await updateDoc(doc(db, "products", idToArchive), {
                    archived: true, archivedAt: serverTimestamp()
                });
                await logActivity("Archived Product", nameToLog);
                sessionStorage.removeItem(PRODUCTS_CACHE_KEY);
                allProducts = allProducts.filter(p => p.id !== idToArchive);
                applyFilters();
                showToast("Product moved to Archive", "success");
            } catch (err) {
                console.error("Error archiving:", err);
                showToast("Error: " + err.message, "error");
            }
        });
    });
}

// ============================================================
// SECTION 6 — UI EVENT LISTENERS
// All filter controls, sort toggle, and reset button are wired
// here inside DOMContentLoaded to guarantee elements exist.
// Each change/input event simply calls applyFilters() which
// re-reads all controls and re-renders the table from scratch.
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("searchInput").addEventListener("input", applyFilters);
    document.getElementById("filterCategory").addEventListener("change", applyFilters);
    document.getElementById("filterPrice").addEventListener("change", applyFilters); 
    document.getElementById("filterStatus").addEventListener("change", applyFilters);
    document.getElementById("filterSort").addEventListener("change", applyFilters);

    document.getElementById("prevPageBtn")?.addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderTable(filteredProducts);
            document.querySelector(".main-content").scrollTo({ top: 0, behavior: "smooth" });
        }
    });
    document.getElementById("nextPageBtn")?.addEventListener("click", () => {
        const total = Math.ceil(filteredProducts.length / PAGE_SIZE);
        if (currentPage < total) {
            currentPage++;
            renderTable(filteredProducts);
            document.querySelector(".main-content").scrollTo({ top: 0, behavior: "smooth" });
        }
    });
    
    const sortBtn = document.getElementById("sortDirBtn");
    if (sortBtn) {
        sortBtn.addEventListener("click", () => {
            currentSortDir = currentSortDir === 'asc' ? 'desc' : 'asc';
            const icon = document.getElementById("sortDirIcon");
            const text = document.getElementById("sortDirText");
            if (icon) icon.textContent = currentSortDir === 'asc' ? "↑" : "↓"; 
            if (text) text.textContent = currentSortDir === 'asc' ? "Ascending" : "Descending";
            applyFilters();
        });
    }

    const resetBtn = document.getElementById("resetFiltersBtn");
    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            document.getElementById("searchInput").value   = "";
            document.getElementById("filterCategory").value = "";
            document.getElementById("filterPrice").value   = "";
            document.getElementById("filterStatus").value  = "";
            document.getElementById("filterSort").value    = "name";
            currentSortDir = 'asc';
            const icon = document.getElementById("sortDirIcon");
            const text = document.getElementById("sortDirText");
            if (icon) icon.textContent = "↑";
            if (text) text.textContent = "Ascending";
            applyFilters();
        });
    }
});

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('exportBtn')?.addEventListener('click', exportToExcel);
});

// ============================================================
// SECTION 7 — TOAST NOTIFICATIONS
// ============================================================

/**
 * Appends a self-dismissing toast notification to #toast-container.
 * Automatically removed after 3 seconds with a fade-out animation.
 * @param {string} message
 * @param {'success'|'error'} type
 */

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// SECTION 8 — EXPORT
// ============================================================

/**
 * Exports the full allProducts list to an .xlsx file using SheetJS.
 * Flattens variations and attributes to single columns (first entry only).
 * File is named Products_Backup_YYYY-MM-DD.xlsx.
 */
function exportToExcel() {
    if (!allProducts || allProducts.length === 0) {
        showToast("No products available to export", "error");
        return;
    }

    const dataToExport = allProducts.map(p => {
        const firstVariation = p.variations && p.variations[0] ? p.variations[0] : {};
        const firstAttribute = p.attributes && p.attributes[0] ? p.attributes[0] : {};
        return {
            "Product Name":        p.name || "",
            "Description":         p.description || "",
            "Category":            p.category || "",
            "Price":               Number(p.price) || 0,
            "Stock":               Number(p.stock) || 0,
            "Low Stock Threshold": Number(p.lowStockThreshold) || 10,
            "Size":                firstVariation.size  || "",
            "Color":               firstVariation.color || "",
            "Custom Variation":    firstVariation.custom || "",
            "Attribute Name":      firstAttribute.name  || "",
            "Attribute Value":     firstAttribute.value || ""
        };
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
    XLSX.writeFile(workbook, `Products_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast("Products exported successfully!", "success");
}

/**
 * Populates the Category filter <select> with all non-archived categories
 * fetched from Firestore. Called once during auth initialisation in parallel
 * with fetchProducts() so both resolve at the same time.
 */
async function loadCategoryFilter() {
    const select = document.getElementById("filterCategory");
    if (!select) return;

    select.innerHTML = '<option value="">All Categories</option>';

    try {
        const q = query(collection(db, "categories"), where("archived", "==", false));
        const snapshot = await getDocs(q);
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.name) return;
            const option = document.createElement("option");
            option.value = data.name;
            option.textContent = data.name;
            select.appendChild(option);
        });
    } catch (err) {
        console.error("Error loading category filter:", err);
    }
}

// ============================================================
// SECTION 9 — IMPORT
// Allows admins to bulk-create products from an .xlsx file.
// Flow: open modal → select file → processImportFile() reads the
// file, validates every row, then writes valid products to Firestore.
// A downloadable template is provided so the expected columns are clear.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    const importBtn       = document.getElementById('importBtn');
    const importModal     = document.getElementById('importModalOverlay');
    const closeImportModal = document.getElementById('closeImportModal');
    const importFileInput = document.getElementById('importFileInput');
    const processImportBtn = document.getElementById('processImportBtn');
    const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            if (!isAdmin) { showToast("Access Denied: Only admins can import products", "error"); return; }
            importModal.style.display = 'flex';
        });
    }

    closeImportModal?.addEventListener('click', () => {
        importModal.style.display = 'none';
        importFileInput.value = '';
        processImportBtn.disabled = true;
    });

    importFileInput?.addEventListener('change', (e) => {
        processImportBtn.disabled = !e.target.files[0];
    });

    downloadTemplateBtn?.addEventListener('click', downloadImportTemplate);
    processImportBtn?.addEventListener('click', processImportFile);
});

/**
 * Generates and downloads a one-row Excel template showing every
 * expected column and an example value.
 */
function downloadImportTemplate() {
    const templateData = [{
        "Product Name": "Example Product", "Description": "Product description (optional)",
        "Category": "Electronics", "Price": 99.99, "Stock": 50, "Low Stock Threshold": 10,
        "Size": "Large", "Color": "Black", "Custom Variation": "Premium (optional)",
        "Attribute Name": "Material (optional)", "Attribute Value": "Plastic (optional)"
    }];
    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook  = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
    XLSX.writeFile(workbook, `Product_Import_Template_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast("Template downloaded successfully!", "success");
}

/**
 * Main import handler. Reads the selected file, validates all rows,
 * and writes valid products to Firestore one by one.
 * Shows a result modal on completion and forces a cache-busting
 * fetchProducts(true) so the table reflects the new data immediately.
 */
async function processImportFile() {
    const fileInput = document.getElementById('importFileInput');
    const file = fileInput.files[0];
    if (!file) { showToast("Please select a file first", "error"); return; }

    const processBtn = document.getElementById('processImportBtn');
    processBtn.disabled = true;
    processBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        const data = await readExcelFile(file);
        const validationResult = await validateImportData(data);

        if (validationResult.errors.length > 0) {
            displayImportErrors(validationResult.errors);
            processBtn.disabled = false;
            processBtn.innerHTML = '<i class="fas fa-check-circle"></i> Import Products';
            return;
        }

        const result = await importProducts(validationResult.validProducts);
        if (result.imported > 0) {
            await logActivity("Imported Products", `${result.imported} product(s) via Excel import`);
        }

        document.getElementById('importModalOverlay').style.display = 'none';
        fileInput.value = '';

        if (result.errors.length > 0) {
            showImportResultModal(result.imported, result.errors);
        } else {
            showToast(`Successfully imported ${result.imported} product(s)!`, 'success');
        }

        await fetchProducts(true);
    } catch (error) {
        console.error("Import error:", error);
        showToast("Import failed: " + error.message, "error");
    } finally {
        processBtn.disabled = false;
        processBtn.innerHTML = '<i class="fas fa-check-circle"></i> Import Products';
    }
}

/**
 * Reads an Excel or CSV file using SheetJS and returns its first
 * sheet as an array of plain row objects (column headers become keys).
 * @param {File} file
 * @returns {Promise<Object[]>}
 */
function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data     = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                resolve(XLSX.utils.sheet_to_json(firstSheet));
            } catch (err) {
                reject(new Error("Failed to read file. Please ensure it's a valid Excel or CSV file."));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Validates every row in the import file before any Firestore writes.
 * Checks: required fields, numeric ranges, existing category names,
 * duplicates within the file, and duplicates against the live database.
 * Fetches existing products and categories in parallel to minimise wait time.
 * @param {Object[]} data — raw rows from readExcelFile()
 * @returns {{ validProducts: Object[], errors: string[] }}
 */
async function validateImportData(data) {
    const errors        = [];
    const validProducts = [];
    const existingNames = new Set();
    const fileNames     = new Set();

    // 🔥 Both queries in parallel
    const [productsSnap, categoriesSnap] = await Promise.all([
        getDocs(query(collection(db, "products"), where("archived", "==", false))),
        getDocs(query(collection(db, "categories"), where("archived", "==", false)))
    ]);

    productsSnap.forEach(d => existingNames.add(d.data().name.toLowerCase()));

    const validCategories = new Set();
    categoriesSnap.forEach(d => validCategories.add(d.data().name));

    data.forEach((row, index) => {
        const rowNum   = index + 2;
        const rowErrors = [];

        if (!row["Product Name"]?.trim()) rowErrors.push(`Row ${rowNum}: Product Name is required`);
        if (!row["Category"])             rowErrors.push(`Row ${rowNum}: Category is required`);
        else if (!validCategories.has(row["Category"])) rowErrors.push(`Row ${rowNum}: Category "${row["Category"]}" does not exist`);
        if (row["Price"] === undefined || row["Price"] === null || row["Price"] === "") rowErrors.push(`Row ${rowNum}: Price is required`);
        else if (isNaN(row["Price"]) || row["Price"] < 0) rowErrors.push(`Row ${rowNum}: Price must be a valid number`);
        if (row["Stock"] === undefined || row["Stock"] === null || row["Stock"] === "") rowErrors.push(`Row ${rowNum}: Stock is required`);
        else if (!Number.isInteger(Number(row["Stock"])) || row["Stock"] < 0) rowErrors.push(`Row ${rowNum}: Stock must be a positive integer`);
        if (!row["Size"]?.trim())  rowErrors.push(`Row ${rowNum}: Size is required`);
        if (!row["Color"]?.trim()) rowErrors.push(`Row ${rowNum}: Color is required`);

        const productName = row["Product Name"]?.trim().toLowerCase();
        if (existingNames.has(productName)) rowErrors.push(`Row ${rowNum}: Product "${row["Product Name"]}" already exists in database`);
        if (fileNames.has(productName))     rowErrors.push(`Row ${rowNum}: Duplicate product "${row["Product Name"]}" in import file`);
        else fileNames.add(productName);

        if (rowErrors.length > 0) errors.push(...rowErrors);
        else validProducts.push(row);
    });

    return { validProducts, errors };
}

/**
 * Writes each validated product row to Firestore as a new "products" document.
 * Builds the full product shape (including variations and optional attributes)
 * before each addDoc call. Logs each import individually via logActivity().
 * Returns counts of successes and per-product error messages for failures.
 * @param {Object[]} products — rows that passed validateImportData()
 * @returns {{ imported: number, errors: string[] }}
 */
async function importProducts(products) {
    const imported = [];
    const errors   = [];

    for (const product of products) {
        try {
            const productData = {
                name:              product["Product Name"].trim(),
                description:       product["Description"]?.trim() || "",
                category:          product["Category"],
                price:             Number(product["Price"]),
                stock:             Number(product["Stock"]),
                lowStockThreshold: Number(product["Low Stock Threshold"]) || 10,
                imageUrl:          "",
                createdAt:         serverTimestamp(),
                createdBy:         auth.currentUser.uid,
                archived:          false,
                variations: [{
                    size:   product["Size"].trim(),
                    color:  product["Color"].trim(),
                    custom: product["Custom Variation"]?.trim() || ""
                }],
                attributes: []
            };

            if (product["Attribute Name"] && product["Attribute Value"]) {
                productData.attributes.push({
                    name:  product["Attribute Name"].trim(),
                    value: product["Attribute Value"].trim()
                });
            }

            await addDoc(collection(db, "products"), productData);
            await logActivity("Imported Product", productData.name);
            imported.push(product["Product Name"]);
        } catch (error) {
            errors.push(`${product["Product Name"]}: ${error.message}`);
        }
    }

    return { imported: imported.length, errors };
}

/**
 * Injects an inline modal listing all validation errors returned by
 * validateImportData(). The modal is self-closing via an inline onclick.
 * @param {string[]} errors
 */
function displayImportErrors(errors) {
    const errorHtml = errors.map(err => `<li style="margin-bottom:8px;">${err}</li>`).join('');
    const modal = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-card); border-radius:12px; padding:24px; max-width:600px; width:100%; max-height:80vh; overflow-y:auto;">
                <h3 style="margin:0 0 16px; color:#dc2626; font-size:18px;"><i class="fas fa-exclamation-triangle"></i> Import Validation Failed</h3>
                <p style="margin-bottom:16px; color:var(--text-secondary); font-size:14px;">Please fix the following errors and try again:</p>
                <ul style="margin:0 0 20px; padding-left:20px; font-size:13px; color:var(--text-main); line-height:1.8;">${errorHtml}</ul>
                <button onclick="this.closest('[style*=fixed]').remove()" style="width:100%; padding:10px; background:var(--primary-color); color:#fff; border:none; border-radius:6px; font-weight:600; cursor:pointer;">Close</button>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
}

/**
 * Shows a success modal after an import completes.
 * Displays the count of successfully imported products and, if any
 * individual rows failed during the Firestore write, lists those errors too.
 * @param {number}   importedCount
 * @param {string[]} errors
 */

function showImportResultModal(importedCount, errors) {
    const errorHtml = errors.length > 0 
        ? `<div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:8px; padding:12px; margin-top:16px;">
               <h4 style="margin:0 0 8px; color:#dc2626; font-size:14px;">Errors:</h4>
               <ul style="margin:0; padding-left:20px; font-size:13px; color:#991b1b;">${errors.map(err => `<li>${err}</li>`).join('')}</ul>
           </div>` : '';
    const modal = `
        <div style="position:fixed; inset:0; background:rgba(0,0,0,0.5); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;">
            <div style="background:var(--bg-card); border-radius:12px; padding:32px; max-width:500px; width:100%; text-align:center;">
                <div style="width:64px; height:64px; background:#dcfce7; border:2px solid #86efac; border-radius:50%; display:flex; align-items:center; justify-content:center; margin:0 auto 20px; font-size:28px; color:#16a34a;"><i class="fas fa-check"></i></div>
                <h2 style="margin:0 0 8px; font-size:20px; color:var(--text-main);">Import Complete!</h2>
                <p style="margin:0; color:var(--text-secondary); font-size:14px;">Successfully imported <strong>${importedCount}</strong> product(s).</p>
                ${errorHtml}
                <button onclick="this.closest('[style*=fixed]').remove()" style="width:100%; padding:12px; background:var(--primary-color); color:#fff; border:none; border-radius:8px; font-weight:600; cursor:pointer; margin-top:20px;">Close</button>
            </div>
        </div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
}

// ============================================================
// EXPORTS
// Named exports allow other modules (e.g. unit tests or other
// pages) to reuse individual helpers without importing the
// entire module.
// ============================================================

export { 
    getCachedUserData,
    logActivity,
    fetchProducts, 
    applyFilters, 
    saveProductsCache, 
    loadProductsCache, 
    validateImportData, 
    importProducts, 
    readExcelFile, 
    exportToExcel };
