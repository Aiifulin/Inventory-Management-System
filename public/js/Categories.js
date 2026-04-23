import { collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc, query} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { getCountFromServer } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBAL STATE
// allCategories      — master list of all fetched (non-archived) categories
// filteredCategories — the subset currently shown after search/sort
// currentSortDir     — 'asc' or 'desc', toggled by the sort direction button
// currentUser        — the signed-in Firebase Auth user object
// isAdmin            — true if the user's role is 'admin'; gates write actions
// isCategoriesLoading — true while Firestore fetch is in progress; blocks renders
// ============================================================
let allCategories      = [];
let filteredCategories = []; 
let currentSortDir     = 'asc';
let currentUser        = null;
let isAdmin            = false;
let isCategoriesLoading = true;

// ============================================================
// SECTION 1 — CATEGORIES CACHE
// Categories are cached in sessionStorage with a 5-minute TTL so
// navigating away and back doesn't trigger another Firestore read.
// Firestore Timestamps are converted to plain objects before
// serialisation (they aren't JSON-safe) and restored on read.
// Note: item counts are patched in AFTER the initial fetch, so
// the cache is only written once counts are fully loaded.
// ============================================================
const CATEGORIES_CACHE_KEY = 'categories_cache';

/**
 * Serialises the categories array and writes it to sessionStorage.
 * Firestore Timestamps are converted to { _type, seconds } objects
 * so they survive JSON serialisation without losing date information.
 */
function saveCategoriesCache(categories) {
    try {
        const serialisable = categories.map(c => ({
            ...c,
            createdAt: c.createdAt?.seconds
                ? { _type: 'ts', seconds: c.createdAt.seconds }
                : null
        }));
        sessionStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify({ categories: serialisable, cachedAt: Date.now() }));
    } catch (e) { console.warn("Could not save categories cache:", e); }
}

/**
 * Reads and deserialises the categories cache from sessionStorage.
 * Returns null if nothing is cached, the 5-minute TTL has expired,
 * or JSON parsing fails.
 * Restores a synthetic .toDate() on Timestamp objects so
 * date-based sorting and display still work correctly.
 */
function loadCategoriesCache() {
    try {
        const raw = sessionStorage.getItem(CATEGORIES_CACHE_KEY);
        if (!raw) return null;
        const { categories, cachedAt } = JSON.parse(raw);
        if (Date.now() - cachedAt > 5 * 60 * 1000) return null;
        return categories.map(c => ({
            ...c,
            createdAt: c.createdAt?._type === 'ts'
                ? { seconds: c.createdAt.seconds, toDate: () => new Date(c.createdAt.seconds * 1000) }
                : null
        }));
    } catch { return null; }
}

// ============================================================
// SECTION 2 — USER DATA CACHE
// Fetches the signed-in user's Firestore document (name, role).
// Cached per-UID in sessionStorage so repeated calls within the
// same tab skip the Firestore read entirely.
// ============================================================

/**
 * Returns the user's Firestore document data from sessionStorage
 * cache if available, otherwise fetches from Firestore and caches.
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null}
 */
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

// ============================================================
// SECTION 3 — ACTIVITY LOGGING
// ============================================================

/**
 * Writes a single activity entry to the "activities" Firestore collection.
 * Called after every archive action on a category.
 * Falls back to "Admin" as the user label if auth.currentUser is null.
 * @param {string} action     — e.g. "Archived Category"
 * @param {string} targetName — the name of the affected category
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
// SECTION 4 — AUTH LISTENER
// Runs once on page load. Unauthenticated users are redirected
// to the login page. Fires getCachedUserData() and fetchCategories()
// simultaneously via Promise.all so the sidebar name and the
// category table both load as fast as possible.
// Once the user role is resolved, the Add Category button is
// shown or hidden and the table is re-rendered so admin action
// icons (Edit / Archive) appear for admins.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    currentUser = user;

    // 🔥 Fire user data AND category fetch simultaneously
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        fetchCategories()
    ]);

    isAdmin = userData?.role?.toLowerCase() === 'admin';

    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    // Show/hide add button now that role is known
    const addBtn = document.getElementById('addCategoryBtn');
    if (addBtn) addBtn.style.display = isAdmin ? 'flex' : 'none';

    // Re-render so admin action icons appear now that isAdmin is set
    renderTable(filteredCategories);

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
// SECTION 5 — DATA FETCHING
// fetchCategories() serves from cache on normal visits and falls
// back to Firestore on the first load or when the cache has expired.
// Item counts are intentionally loaded AFTER the initial render so
// the table appears immediately with 0 counts, then counts are
// patched in smoothly once the parallel count queries complete.
// The cache is only saved after counts are fully populated so
// cached data always includes accurate item counts.
// ============================================================

/**
 * Loads all non-archived categories from Firestore (or cache).
 * On a cache hit: populates allCategories and renders immediately.
 * On a cache miss: fetches categories, renders with 0 item counts,
 * then fires loadCategoryCounts() in the background to patch in
 * real counts and save the completed data to cache.
 */
async function fetchCategories() {
    setCategoriesLoading(true);

    const cached = loadCategoriesCache();
    if (cached) {
        allCategories = cached;
        setCategoriesLoading(false);
        applyFilters();
        return; // Skip Firestore + count queries entirely on cache hit
    }

    try {
        const q = query(collection(db, "categories"), where("archived", "==", false));
        const querySnapshot = await getDocs(q);

        allCategories = querySnapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data(),
            itemCount: 0 // Placeholder — real counts loaded below
        }));

        setCategoriesLoading(false);
        applyFilters(); // Render immediately with 0 counts

        // Load counts in the background, then save complete data to cache
        await loadCategoryCounts(querySnapshot.docs);
        saveCategoriesCache(allCategories); // Save AFTER counts are patched in

    } catch (error) {
        console.error("Error loading categories:", error);
        allCategories = [];
        setCategoriesLoading(false);
    }
}

/**
 * Toggles the skeleton loaders and hides/shows the table and
 * mobile list. Called with true at the start of a fetch and
 * false when it completes.
 * @param {boolean} loading
 */
function setCategoriesLoading(loading) {
    isCategoriesLoading = loading;

    const desktopSkeleton = document.getElementById("desktopCategoriesSkeleton");
    const mobileSkeleton  = document.getElementById("mobileCategoriesSkeleton");
    const tableContainer  = document.querySelector(".table-container.desktop-only");
    const mobileList      = document.getElementById("mobileProductList");

    desktopSkeleton?.classList.toggle("visible", loading);
    mobileSkeleton?.classList.toggle("visible", loading);
    tableContainer?.classList.toggle("hidden", loading);
    mobileList?.classList.toggle("hidden", loading);
}

// ============================================================
// SECTION 6 — FILTER & SORT
// applyFilters() reads the search input and sort select, filters
// allCategories by name and creation date, sorts the result, and
// passes it to renderTable(). Called on every filter change event.
// ============================================================

/**
 * Filters allCategories against the current search text, sorts by
 * name or creation date in the current direction, writes the result
 * to filteredCategories, and re-renders the table.
 */
function applyFilters() {
    const searchVal = document.getElementById("searchInput").value.trim().toLowerCase();
    const sortVal   = document.getElementById("filterSort").value; 

    let result = allCategories.filter(c => {
        const catName = (c.name || "").toLowerCase();
        let dateStr = "";
        if (c.createdAt?.toDate) {
            const d = c.createdAt.toDate();
            dateStr = d.toLocaleDateString("en-US", { month: 'long', day: 'numeric', year: 'numeric' }).toLowerCase();
        }
        return catName.includes(searchVal) || dateStr.includes(searchVal);
    });

    result.sort((a, b) => {
        let valA, valB;
        if (sortVal === 'name') {
            valA = (a.name || "").toLowerCase();
            valB = (b.name || "").toLowerCase();
        } else {
            valA = a.createdAt?.seconds || 0;
            valB = b.createdAt?.seconds || 0;
        }
        if (valA < valB) return currentSortDir === 'asc' ? -1 : 1;
        if (valA > valB) return currentSortDir === 'asc' ? 1 : -1;
        return 0;
    });

    filteredCategories = result;
    renderTable(filteredCategories);
}

/**
 * Fetches the live product count for every non-archived category
 * using Firestore's getCountFromServer() (a lightweight aggregation
 * query that doesn't download the actual documents).
 * All count queries run in parallel via Promise.all to minimise
 * total wait time regardless of the number of categories.
 * After all counts are resolved, patches them into allCategories
 * and calls applyFilters() to update the visible counts smoothly.
 * @param {QueryDocumentSnapshot[]} docs — raw Firestore snapshots from fetchCategories()
 */
async function loadCategoryCounts(docs) {
    // 🔥 All count queries run in parallel
    const updates = await Promise.all(
        docs.map(async (docSnap) => {
            const data = docSnap.data();
            if (data.archived === true) return null; // Skip archived categories
            try {
                const q    = query(collection(db, "products"), where("category", "==", data.name), where("archived", "==", false));
                const snap = await getCountFromServer(q);
                return { id: docSnap.id, count: snap.data().count };
            } catch (err) {
                console.error("Count error:", err);
                return null;
            }
        })
    );

    // Patch the live count into the matching allCategories entry
    updates.forEach(update => {
        if (!update) return;
        const cat = allCategories.find(c => c.id === update.id);
        if (cat) cat.itemCount = update.count;
    });

    applyFilters(); // Re-render to show updated counts
}

// ============================================================
// SECTION 7 — RENDER
// renderTable() is the single function responsible for writing
// category data to the DOM. It builds both the desktop <table>
// rows and the mobile card list from the same categories array.
// Admin-only action buttons (Edit / Archive) are injected only
// when isAdmin is true.
// ============================================================

/**
 * Renders the provided categories array into both the desktop table
 * and the mobile card list. Shows an empty state message if the
 * array is empty. Calls attachDeleteListeners() after rendering
 * so the dynamically created Archive buttons are wired up.
 * @param {Array} categoriesToRender
 */
function renderTable(categoriesToRender) {
    const tableBody  = document.getElementById("productTableBody");
    const mobileList = document.getElementById("mobileProductList");

    if (tableBody)  tableBody.innerHTML  = "";
    if (mobileList) mobileList.innerHTML = "";

    if (categoriesToRender.length === 0) {
        if (tableBody)  tableBody.innerHTML  = `<tr><td colspan="5" style="text-align:center; padding:30px; color:#9ca3af;">No categories found.</td></tr>`;
        if (mobileList) mobileList.innerHTML = `<div style="text-align:center; padding:30px; color:#9ca3af;">No categories found.</div>`;
        return;
    }

    categoriesToRender.forEach((c, index) => {
        const docId   = c.id;
        const shortId = docId;

        let dateAdded = "N/A";
        if (c.createdAt && c.createdAt.toDate) {
            dateAdded = c.createdAt.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });
        }

        // Action buttons are only injected for admins
        const adminActions = isAdmin ? `
            <i class="fa-regular fa-pen-to-square" title="Edit" onclick="editCategory('${docId}')" style="cursor: pointer;"></i>
            <i class="fa-regular fa-trash-can delete-btn" data-id="${docId}" title="Delete" style="cursor: pointer;"></i>
        ` : '';

        const mobileAdminActions = isAdmin ? `
            <button class="btn-card-action" onclick="editCategory('${docId}')"><i class="fa-regular fa-pen-to-square"></i> Edit</button>
            <button class="btn-card-action btn-card-delete delete-btn" data-id="${docId}"><i class="fa-regular fa-trash-can"></i></button>
        ` : '';

        if (tableBody) {
            const row = document.createElement("tr");
            row.innerHTML = `
            <td><span class="id-badge">${docId}</span></td>
                <td>${c.name}</td>
                <td>${c.itemCount || 0}</td>
                <td>${dateAdded}</td>
                <td class="actions">${adminActions}</td>
            `;
            tableBody.appendChild(row);
        }

        if (mobileList) {
            const card = document.createElement("div");
            card.className = "mobile-card";
            card.innerHTML = `
                <div class="mobile-id-header">ID: <span class="id-badge">${docId}</span></div>
                <div class="card-top">
                    <div class="card-header-text"><h3 class="card-title">${c.name}</h3></div>
                </div>
                <div class="card-details-grid">
                    <div class="detail-item"><label>Items:</label> <span>${c.itemCount || 0}</span></div>
                    <div class="detail-item"><label>Created:</label> <span>${dateAdded}</span></div>
                </div>
                <div class="card-actions">${mobileAdminActions}</div>
            `;
            mobileList.appendChild(card);
        }
    });

    if (isAdmin) attachDeleteListeners();
}

// ============================================================
// SECTION 8 — EDIT & DELETE (ARCHIVE) ACTIONS
// ============================================================

/**
 * Navigates to the Edit Category page for the given category ID.
 * Exposed on window so it can be called from inline onclick attributes.
 * Shows an error toast and blocks navigation for non-admins.
 */
window.editCategory = function(id) {
    if (isAdmin) {
        window.location.href = `Edit_Category.html?id=${id}`;
    } else {
        showToast("Access Denied: Only Admin can edit categories.", "error");
    }
}

// ============================================================
// SECTION 9 — DELETE (ARCHIVE) MODAL
// pendingDeleteId / pendingDeleteName store the category awaiting
// confirmation so the confirm button knows which document to update.
// Archiving a category also reassigns all of its products to
// "Uncategorized" via a parallel Promise.all so no product is
// left pointing to a non-existent category.
// ============================================================
let pendingDeleteId   = null;
let pendingDeleteName = null;

/**
 * Populates and opens the archive confirmation modal.
 * Stores the category ID and name in module-level variables so
 * the confirm button can act on the correct document.
 * @param {string} id   — Firestore document ID
 * @param {string} name — displayed inside the modal body
 */
function openDeleteModal(id, name) {
    pendingDeleteId   = id;
    pendingDeleteName = name;
    document.getElementById('deleteCategoryName').textContent = `"${name}"`;
    document.getElementById('deleteModalOverlay').style.display = 'flex';
}

/**
 * Hides the archive modal, resets pendingDeleteId/Name to null,
 * and restores the confirm button to its default enabled state.
 */
function closeDeleteModal() {
    pendingDeleteId   = null;
    pendingDeleteName = null;
    document.getElementById('deleteModalOverlay').style.display = 'none';
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="fas fa-archive"></i> Archive';
}

// ============================================================
// SECTION 10 — MODAL EVENT LISTENERS
// Cancel button and backdrop click both call closeDeleteModal().
// Confirm button: sets archived=true on the category, then
// reassigns all products in that category to "Uncategorized"
// using a parallel Promise.all, logs the activity, clears the
// dashboard cache, removes the item from allCategories, and
// re-renders. Always resets the button state via the catch block
// so the modal never gets stuck in a loading state on error.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('modalCancelBtn')?.addEventListener('click', closeDeleteModal);

    // Close modal when clicking the backdrop (outside the card)
    document.getElementById('deleteModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('deleteModalOverlay')) closeDeleteModal();
    });

    document.getElementById('modalConfirmBtn')?.addEventListener('click', async () => {
        if (!pendingDeleteId) return;
    
        const categoryName = pendingDeleteName; 
        const confirmBtn   = document.getElementById('modalConfirmBtn');
        
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Archiving...';
    
        try {
            // 1. Archive the category document
            await updateDoc(doc(db, "categories", pendingDeleteId), {
                archived: true, archivedAt: serverTimestamp()
            });
            
            // 2. Reassign all products in this category to "Uncategorized"
            //    in parallel so no product is left with a dead category reference
            const productsQuery    = query(collection(db, "products"), where("category", "==", categoryName));
            const productsSnapshot = await getDocs(productsQuery);
            
            await Promise.all(
                productsSnapshot.docs.map(productDoc =>
                    updateDoc(doc(db, "products", productDoc.id), { category: "Uncategorized" })
                )
            );
            
            await logActivity("Archived Category", categoryName);
            allCategories = allCategories.filter(c => c.id !== pendingDeleteId);
            applyFilters();
            sessionStorage.removeItem('dashboard_cache'); // Bust dashboard category count
            closeDeleteModal();
            showToast(`Category "${categoryName}" archived successfully!`, 'success');
        } catch (err) {
            console.error("Error archiving:", err);
            showToast("Failed to archive category.", "error");
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = '<i class="fas fa-archive"></i> Archive';
        }
    });
});

/**
 * Attaches click listeners to every .delete-btn element currently
 * in the DOM. Must be called after renderTable() since the buttons
 * are created dynamically. Looks up the category name from
 * allCategories before opening the modal so it can be displayed
 * in the confirmation dialog.
 */
function attachDeleteListeners() {
    if (!isAdmin) return;
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.closest('.delete-btn');
            if (!target) return;
            const idToDelete       = target.getAttribute('data-id');
            const categoryToDelete = allCategories.find(c => c.id === idToDelete);
            const nameToLog        = categoryToDelete ? categoryToDelete.name : "Unknown Category";
            openDeleteModal(idToDelete, nameToLog);
        });
    });
}

// ============================================================
// SECTION 11 — UI EVENT LISTENERS
// Search input and sort select both call applyFilters() on change.
// Sort direction button toggles currentSortDir and updates the
// icon and label before re-running the filter.
// Reset button restores all controls to their default values and
// calls applyFilters() to show the full unsorted list.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("searchInput").addEventListener("input", applyFilters);
    document.getElementById("filterSort").addEventListener("change", applyFilters);
    
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
            document.getElementById("searchInput").value = "";
            document.getElementById("filterSort").value  = "name";
            currentSortDir = 'asc';
            const icon = document.getElementById("sortDirIcon");
            const text = document.getElementById("sortDirText");
            if (icon) icon.textContent = "↑";
            if (text) text.textContent = "Ascending";
            applyFilters();
        });
    }
});

// ============================================================
// SECTION 12 — TOAST NOTIFICATIONS
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
// EXPORTS
// Named exports allow other modules and test suites to import
// individual helpers directly without pulling in the full module.
// ============================================================
export { 
    getCachedUserData, 
    logActivity, 
    fetchCategories, 
    applyFilters, 
    loadCategoryCounts, 
    saveCategoriesCache, 
    loadCategoriesCache, };