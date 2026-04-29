import { 
    collection, query, where, orderBy, limit, getDocs,
    startAfter, doc, updateDoc, deleteDoc, getDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { applyRoleBasedNavigation, isAdminUser, renderAccessDenied } from "./access-control.js";
import { db, auth, storage } from "./firebase.js";

// ============================================================
// GLOBAL STATE
// lastVisibleProducts   — Firestore cursor for the last fetched product
//                         document; used by startAfter() for pagination
// lastVisibleCategories — same cursor for archived categories pagination
// pageSize              — number of rows fetched per Firestore query (25)
// sortDirectionProducts   — 'asc' or 'desc' for the products archive table
// sortDirectionCategories — 'asc' or 'desc' for the categories archive table
// pendingAction         — stores { action, itemType, id, name } for the
//                         item currently awaiting modal confirmation
// isArchivedProductsLoading   — true while products fetch is in progress
// isArchivedCategoriesLoading — true while categories fetch is in progress
// ============================================================
let lastVisibleProducts   = null;
let lastVisibleCategories = null;
const pageSize = 25;
let sortDirectionProducts   = "desc";
let sortDirectionCategories = "desc";
let pendingAction = null;
let isArchivedProductsLoading   = true;
let isArchivedCategoriesLoading = true;

// ============================================================
// SECTION 1 — USER DATA CACHE
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
// SECTION 2 — AUTH LISTENER & ROLE GUARD
// Runs once on page load. Unauthenticated users are redirected
// to the login page immediately. Non-admins see an Access Denied
// message injected into #mainContent — the archive tables are
// never revealed to them even briefly.
// Fires getCachedUserData(), loadArchivedProducts(), and
// loadArchivedCategories() simultaneously via Promise.all so
// the sidebar name and both tables load as fast as possible.
// ============================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    const main = document.getElementById('mainContent');

    // Logout modal is wired here regardless of role so the sidebar
    // logout link always works even for non-admins seeing the denied screen.
    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };

    // 🔥 Fire user data fetch simultaneously with both archive loads
    const userData = await getCachedUserData(user.uid);

    const nameEl  = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    const isAdmin = isAdminUser(userData);
    applyRoleBasedNavigation(isAdmin);

    if (!isAdmin) {
        renderAccessDenied(main, "Archives");
    } else {
        await Promise.all([
            loadArchivedProducts(true),
            loadArchivedCategories(true)
        ]);
    }

    main.style.visibility = 'visible';
    document.documentElement.style.visibility = 'visible';
});

// ============================================================
// SECTION 3 — DATA LOADERS
// Each loader fetches one page of archived documents from
// Firestore, ordered by archivedAt in the current sort direction.
// Pagination is cursor-based using startAfter(lastVisible…) so
// subsequent pages don't re-fetch earlier documents.
// Pass reset=true to clear the table and start from the first page.
// ============================================================

/**
 * Fetches one page of archived products and appends rows to
 * #archiveTableProductsBody. Uses cursor-based pagination so
 * "Load More" calls append without re-fetching earlier rows.
 * Guards against race conditions by checking auth.currentUser
 * before writing to the DOM.
 * @param {boolean} reset — true to clear the table and reset the cursor
 */
async function loadArchivedProducts(reset = true) {
    if (!auth.currentUser) return;

    setArchivedProductsLoading(true);

    const q = (reset || !lastVisibleProducts)
        ? query(collection(db, "products"), where("archived", "==", true), orderBy("archivedAt", sortDirectionProducts), limit(pageSize))
        : query(collection(db, "products"), where("archived", "==", true), orderBy("archivedAt", sortDirectionProducts), startAfter(lastVisibleProducts), limit(pageSize));

    try {
        const snapshot = await getDocs(q);
        if (!auth.currentUser) return;

        const table = document.getElementById("archiveTableProductsBody");
        if (!table) return;

        if (reset) table.innerHTML = "";

        if (snapshot.empty) {
            table.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">No archived products found.</td></tr>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const product     = docSnap.data();
            const id          = docSnap.id;
            const archivedDate = product.archivedAt
                ? product.archivedAt.toDate().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                : "—";
            const imageUrl = product.imageUrl || "placeholder.png";

            const row = document.createElement("tr");
            row.innerHTML = `
                <td><img src="${imageUrl}" alt="${product.name}" class="product-img" style="max-width: 50px; height: auto;"></td>
                <td>${product.name || ""}</td>
                <td>${product.category || ""}</td>
                <td>${archivedDate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${id}" data-type="product">Restore</button>
                        <button class="btn-delete"  data-id="${id}" data-type="product">Delete Permanently</button>
                    </div>
                </td>`;
            table.appendChild(row);
        });

        // Advance the cursor to the last document in this page
        // so the next "Load More" call starts from the right place.
        if (snapshot.docs.length > 0) lastVisibleProducts = snapshot.docs[snapshot.docs.length - 1];
    } finally {
        setArchivedProductsLoading(false);
    }
}

/**
 * Fetches one page of archived categories and appends rows to
 * #archiveTableCategoriesBody. Mirrors the pagination and auth-guard
 * pattern used by loadArchivedProducts().
 * @param {boolean} reset — true to clear the table and reset the cursor
 */
async function loadArchivedCategories(reset = true) {
    if (!auth.currentUser) return;

    setArchivedCategoriesLoading(true);

    const q = (reset || !lastVisibleCategories)
        ? query(collection(db, "categories"), where("archived", "==", true), orderBy("archivedAt", sortDirectionCategories), limit(pageSize))
        : query(collection(db, "categories"), where("archived", "==", true), orderBy("archivedAt", sortDirectionCategories), startAfter(lastVisibleCategories), limit(pageSize));

    try {
        const snapshot = await getDocs(q);
        if (!auth.currentUser) return;

        const table = document.getElementById("archiveTableCategoriesBody");
        if (!table) return;

        if (reset) table.innerHTML = "";

        if (snapshot.empty) {
            table.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:20px;color:#999;">No archived categories found.</td></tr>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const category    = docSnap.data();
            const id          = docSnap.id;
            const archivedDate = category.archivedAt
                ? category.archivedAt.toDate().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                : "—";

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${category.name || ""}</td>
                <td>${archivedDate}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-restore" data-id="${id}" data-type="category">Restore</button>
                        <button class="btn-delete"  data-id="${id}" data-type="category">Delete Permanently</button>
                    </div>
                </td>`;
            table.appendChild(row);
        });

        // Advance the cursor for the next page of categories.
        if (snapshot.docs.length > 0) lastVisibleCategories = snapshot.docs[snapshot.docs.length - 1];
    } finally {
        setArchivedCategoriesLoading(false);
    }
}

/**
 * Toggles the skeleton loader and table container visibility for
 * the archived products section.
 * @param {boolean} loading
 */
function setArchivedProductsLoading(loading) {
    isArchivedProductsLoading = loading;
    document.getElementById("archivedProductsSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("archivedProductsTableContainer")?.classList.toggle("hidden", loading);
}

/**
 * Toggles the skeleton loader and table container visibility for
 * the archived categories section.
 * @param {boolean} loading
 */
function setArchivedCategoriesLoading(loading) {
    isArchivedCategoriesLoading = loading;
    document.getElementById("archivedCategoriesSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("archivedCategoriesTableContainer")?.classList.toggle("hidden", loading);
}

// ============================================================
// SECTION 4 — EVENT DELEGATION (Restore / Delete buttons)
// A single click listener on the document handles both Restore
// and Delete Permanently buttons for products and categories.
// Using event delegation means it works for dynamically rendered
// table rows without needing to re-attach listeners after each load.
// Fetches the item name from Firestore before opening the modal
// so the confirmation dialog can display a human-readable label.
// ============================================================
document.addEventListener("click", async (e) => {
    const restoreBtn = e.target.closest(".btn-restore");
    const deleteBtn  = e.target.closest(".btn-delete");

    if (!auth.currentUser) return;

    if (restoreBtn) {
        const id              = restoreBtn.dataset.id;
        const type            = restoreBtn.dataset.type;
        const collection_name = type === 'product' ? 'products' : 'categories';
        const snap = await getDoc(doc(db, collection_name, id));
        const name = snap.exists() ? snap.data().name : id;
        openRestoreModal(id, type, name);
    }

    if (deleteBtn) {
        const id              = deleteBtn.dataset.id;
        const type            = deleteBtn.dataset.type;
        const collection_name = type === 'product' ? 'products' : 'categories';
        const snap = await getDoc(doc(db, collection_name, id));
        const name = snap.exists() ? snap.data().name : id;
        openDeleteModal(id, type, name);
    }
});

// ============================================================
// SECTION 5 — RESTORE & DELETE ACTIONS
// Each function performs a single Firestore write, logs the
// activity, reloads the relevant table, and shows a toast.
// permanentlyDeleteProduct also attempts to remove the product's
// image from Firebase Storage before deleting the document;
// Storage errors are caught and warned without blocking the delete.
// ============================================================

/**
 * Clears the archived flag on a product document, restoring it
 * to the active inventory. Reloads the products archive table
 * and shows a success toast on completion.
 * @param {string} id   — Firestore document ID
 * @param {string} name — product name for the toast message
 */
async function restoreProduct(id, name) {
    try {
        await updateDoc(doc(db, "products", id), { archived: false, archivedAt: null });
        await logActivity("Restore Product", name);
        loadArchivedProducts(true);
        showToast(`"${name}" has been restored to inventory.`, 'success');
    } catch (error) {
        console.error("Error restoring product:", error);
        showToast("Failed to restore product.", "error");
    }
}

/**
 * Permanently deletes a product from Firestore and attempts to
 * remove its image from Firebase Storage if one exists.
 * Storage deletion errors are swallowed so a missing image never
 * blocks the document deletion.
 * @param {string} id   — Firestore document ID
 * @param {string} name — product name for the toast message
 */
async function permanentlyDeleteProduct(id, name) {
    try {
        const snap = await getDoc(doc(db, "products", id));
        if (snap.exists()) {
            const data = snap.data();
            if (data.imageUrl && data.imageUrl.includes("firebasestorage.googleapis.com")) {
                try { await deleteObject(ref(storage, data.imageUrl)); } catch (err) { console.warn("Failed to delete image:", err.message); }
            }
        }
        await deleteDoc(doc(db, "products", id));
        await logActivity("Delete Product Permanently", name);
        loadArchivedProducts(true);
        showToast(`"${name}" deleted forever.`, 'success');
    } catch (error) {
        console.error("Error deleting product:", error);
        showToast("Error during permanent deletion.", "error");
    }
}

/**
 * Clears the archived flag on a category document, restoring it
 * to active use. Also clears the dashboard cache so the Categories
 * stat card reflects the restored count on next visit.
 * @param {string} id   — Firestore document ID
 * @param {string} name — category name for the toast message
 */
async function restoreCategory(id, name) {
    try {
        await updateDoc(doc(db, "categories", id), { archived: false, archivedAt: null });
        await logActivity("Restore Category", name);
        loadArchivedCategories(true);
        sessionStorage.removeItem('dashboard_cache');
        showToast(`Category "${name}" is now active again.`, 'success');
    } catch (error) {
        console.error("Error restoring category:", error);
        showToast("Failed to restore category.", "error");
    }
}

/**
 * Permanently deletes a category document from Firestore.
 * Does not delete associated products — those must be managed
 * separately via the Products page.
 * @param {string} id   — Firestore document ID
 * @param {string} name — category name for the toast message
 */
async function permanentlyDeleteCategory(id, name) {
    try {
        await deleteDoc(doc(db, "categories", id));
        await logActivity("Delete Category Permanently", name);
        loadArchivedCategories(true);
        showToast(`Category "${name}" has been deleted permanently.`, 'success');
    } catch (error) {
        console.error("Error deleting category:", error);
        showToast("Failed to delete category permanently.", "error");
    }
}

// ============================================================
// SECTION 6 — ACTIVITY LOGGING
// ============================================================

/**
 * Writes a single activity entry to the "activities" Firestore collection.
 * Called after every restore or permanent delete action.
 * Silently returns if no user is signed in to avoid orphaned writes.
 * @param {string} action — e.g. "Restore Product", "Delete Category Permanently"
 * @param {string} target — the name of the affected item
 */
async function logActivity(action, target) {
    if (!auth.currentUser) return;
    try {
        await addDoc(collection(db, "activities"), {
            action, target, user: auth.currentUser.email || "Unknown", timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error logging activity:", error);
    }
}

// ============================================================
// SECTION 7 — SEARCH
// Client-side search that filters already-rendered table rows by
// toggling their display style. Runs on every keystroke via an
// input event listener delegated to the document.
// Searches across name, category, and archived date columns for
// products; name and date columns for categories.
// ============================================================
document.addEventListener("input", function(e) {
    if (e.target.id === "archiveSearchProducts") {
        const search = e.target.value.toLowerCase();
        document.querySelectorAll("#archiveTableProductsBody tr").forEach(row => {
            const name     = row.children[1]?.textContent.toLowerCase() || "";
            const category = row.children[2]?.textContent.toLowerCase() || "";
            const date     = row.children[3]?.textContent.toLowerCase() || "";
            row.style.display = (name.includes(search) || category.includes(search) || date.includes(search)) ? "" : "none";
        });
    }

    if (e.target.id === "archiveSearchCategories") {
        const search = e.target.value.toLowerCase();
        document.querySelectorAll("#archiveTableCategoriesBody tr").forEach(row => {
            const categoryName = row.children[0]?.textContent.toLowerCase() || "";
            const date         = row.children[1]?.textContent.toLowerCase() || "";
            row.style.display  = categoryName.includes(search) || date.includes(search) ? "" : "none";
        });
    }
});

// ============================================================
// SECTION 8 — SORT & SIDEBAR EVENT LISTENERS
// Sort buttons toggle the direction variable and reset the cursor
// before re-fetching from the first page so the full sorted list
// is shown from the beginning.
// Sidebar hamburger/overlay listeners follow the shared pattern
// used across all pages.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sortArchivedDateProducts")?.addEventListener("click", () => {
        sortDirectionProducts = sortDirectionProducts === "desc" ? "asc" : "desc";
        lastVisibleProducts   = null; // Reset cursor so sort starts from page 1
        loadArchivedProducts(true);
    });

    document.getElementById("sortArchivedDateCategories")?.addEventListener("click", () => {
        sortDirectionCategories = sortDirectionCategories === "desc" ? "asc" : "desc";
        lastVisibleCategories   = null; // Reset cursor so sort starts from page 1
        loadArchivedCategories(true);
    });

    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn     = document.getElementById('closeBtn');
    const sidebar      = document.getElementById('sidebar');
    const overlay      = document.getElementById('overlay');

    const toggleSidebar = () => { sidebar.classList.toggle('open'); overlay.classList.toggle('show'); };
    const closeSidebar  = () => { sidebar.classList.remove('open'); overlay.classList.remove('show'); };

    hamburgerBtn?.addEventListener('click', (e) => { e.stopPropagation(); toggleSidebar(); });
    closeBtn?.addEventListener('click', closeSidebar);
    overlay?.addEventListener('click', closeSidebar);
});

// ============================================================
// SECTION 9 — MODAL HELPERS
// openRestoreModal / openDeleteModal store the pending action in
// the pendingAction global and populate the modal's name label
// before showing it. This decouples the click handler from the
// actual Firestore write — the write only happens when the user
// confirms inside the modal.
//
// closeAllModals resets both modals and their confirm buttons back
// to their default state and clears pendingAction.
//
// showSuccessModal is a lightweight auto-dismissing overlay that
// closes itself after 2 seconds without user interaction.
// ============================================================

/**
 * Populates and opens the Restore confirmation modal.
 * Stores the item details in pendingAction so the confirm button
 * knows which document to update.
 * @param {string} id   — Firestore document ID
 * @param {string} type — 'product' or 'category'
 * @param {string} name — displayed inside the modal body
 */
function openRestoreModal(id, type, name) {
    pendingAction = { action: 'restore', itemType: type, id, name };
    document.getElementById('restoreItemName').textContent = `"${name}"`;
    document.getElementById('restoreModalOverlay').style.display = 'flex';
}

/**
 * Populates and opens the Delete Permanently confirmation modal.
 * Stores the item details in pendingAction so the confirm button
 * knows which document to delete.
 * @param {string} id   — Firestore document ID
 * @param {string} type — 'product' or 'category'
 * @param {string} name — displayed inside the modal body
 */
function openDeleteModal(id, type, name) {
    pendingAction = { action: 'delete', itemType: type, id, name };
    document.getElementById('deleteItemName').textContent = `"${name}"`;
    document.getElementById('deleteModalOverlay').style.display = 'flex';
}

/**
 * Hides both confirmation modals, re-enables and resets their
 * confirm buttons to their default labels, and clears pendingAction.
 * Called on cancel, backdrop click, and after a confirmed action completes.
 */
function closeAllModals() {
    document.getElementById('restoreModalOverlay').style.display = 'none';
    document.getElementById('deleteModalOverlay').style.display  = 'none';
    const restoreBtn = document.getElementById('restoreConfirmBtn');
    const deleteBtn  = document.getElementById('deleteConfirmBtn');
    restoreBtn.disabled = false;
    restoreBtn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore';
    deleteBtn.disabled  = false;
    deleteBtn.innerHTML  = '<i class="fas fa-trash"></i> Delete Forever';
    pendingAction = null;
}

/**
 * Shows a lightweight success overlay with a custom title and message,
 * then auto-dismisses after 2 seconds without requiring user interaction.
 * @param {string} title
 * @param {string} message
 */
function showSuccessModal(title, message) {
    document.getElementById('successModalTitle').textContent   = title;
    document.getElementById('successModalMessage').textContent = message;
    document.getElementById('successModalOverlay').style.display = 'flex';
    setTimeout(() => { document.getElementById('successModalOverlay').style.display = 'none'; }, 2000);
}

// ============================================================
// SECTION 10 — MODAL CONFIRM / CANCEL EVENT LISTENERS
// Backdrop clicks close the modal (clicking outside the card).
// Cancel buttons also close without acting.
// Confirm buttons read from pendingAction to determine whether
// to call the product or category variant of restore/delete,
// show a spinner while the async operation is in flight, and
// always call closeAllModals() in the finally block so the modal
// never gets stuck open on error.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
    // Close modals when clicking the backdrop (outside the card)
    document.getElementById('restoreModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('restoreModalOverlay')) closeAllModals();
    });
    document.getElementById('deleteModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('deleteModalOverlay')) closeAllModals();
    });

    document.getElementById('restoreCancelBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('deleteCancelBtn')?.addEventListener('click',  closeAllModals);

    document.getElementById('restoreConfirmBtn')?.addEventListener('click', async () => {
        if (!pendingAction) return;
        const btn = document.getElementById('restoreConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';
        const { itemType, id, name } = pendingAction;
        try {
            if (itemType === 'product') await restoreProduct(id, name);
            else                        await restoreCategory(id, name);
        } finally { closeAllModals(); }
    });

    document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
        if (!pendingAction) return;
        const btn = document.getElementById('deleteConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
        const { itemType, id, name } = pendingAction;
        try {
            if (itemType === 'product') await permanentlyDeleteProduct(id, name);
            else                        await permanentlyDeleteCategory(id, name);
        } finally { closeAllModals(); }
    });
});

// ============================================================
// SECTION 11 — TOAST NOTIFICATIONS
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
    restoreProduct, 
    permanentlyDeleteProduct, 
    restoreCategory,
    permanentlyDeleteCategory, 
    logActivity };
