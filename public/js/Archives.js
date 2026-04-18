import { 
    collection, query, where, orderBy, limit, getDocs,
    startAfter, doc, updateDoc, deleteDoc, getDoc, addDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { ref, deleteObject } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { db, auth, storage } from "./firebase.js";

let lastVisibleProducts   = null;
let lastVisibleCategories = null;
const pageSize = 25;
let sortDirectionProducts   = "desc";
let sortDirectionCategories = "desc";
let pendingAction = null;
let isArchivedProductsLoading   = true;
let isArchivedCategoriesLoading = true;

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

// ================================================
// AUTH — parallel: user data + both archive lists fire at the same time
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    const main = document.getElementById('mainContent');

    // Logout modal setup (needed regardless of role)
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
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        loadArchivedProducts(true),
        loadArchivedCategories(true)
    ]);

    const nameEl  = document.getElementById('userNameDisplay');
    if (nameEl) nameEl.textContent = userData?.name || "User";

    const isAdmin = userData?.role?.toLowerCase() === "admin";

    if (!isAdmin) {
        main.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; 
                        justify-content:center; height:60vh; text-align:center; 
                        color:var(--text-secondary);">
                <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
                <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
                <p style="margin:0; font-size:14px;">You do not have permission to view Archives.</p>
            </div>`;
    }

    main.style.visibility = 'visible';
    document.documentElement.style.visibility = 'visible';
});

// ===============================
// LOAD ARCHIVED PRODUCTS
// ===============================
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

        if (snapshot.docs.length > 0) lastVisibleProducts = snapshot.docs[snapshot.docs.length - 1];
    } finally {
        setArchivedProductsLoading(false);
    }
}

// ===============================
// LOAD ARCHIVED CATEGORIES
// ===============================
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

        if (snapshot.docs.length > 0) lastVisibleCategories = snapshot.docs[snapshot.docs.length - 1];
    } finally {
        setArchivedCategoriesLoading(false);
    }
}

function setArchivedProductsLoading(loading) {
    isArchivedProductsLoading = loading;
    document.getElementById("archivedProductsSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("archivedProductsTableContainer")?.classList.toggle("hidden", loading);
}

function setArchivedCategoriesLoading(loading) {
    isArchivedCategoriesLoading = loading;
    document.getElementById("archivedCategoriesSkeleton")?.classList.toggle("visible", loading);
    document.getElementById("archivedCategoriesTableContainer")?.classList.toggle("hidden", loading);
}

// ===============================
// EVENT DELEGATION
// ===============================
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

// ===============================
// RESTORE / DELETE ACTIONS
// ===============================
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

// ===============================
// SEARCH
// ===============================
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

// ===============================
// SORT + SIDEBAR
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("sortArchivedDateProducts")?.addEventListener("click", () => {
        sortDirectionProducts = sortDirectionProducts === "desc" ? "asc" : "desc";
        lastVisibleProducts   = null;
        loadArchivedProducts(true);
    });

    document.getElementById("sortArchivedDateCategories")?.addEventListener("click", () => {
        sortDirectionCategories = sortDirectionCategories === "desc" ? "asc" : "desc";
        lastVisibleCategories   = null;
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

// ===============================
// MODAL HELPERS
// ===============================
function openRestoreModal(id, type, name) {
    pendingAction = { action: 'restore', itemType: type, id, name };
    document.getElementById('restoreItemName').textContent = `"${name}"`;
    document.getElementById('restoreModalOverlay').style.display = 'flex';
}

function openDeleteModal(id, type, name) {
    pendingAction = { action: 'delete', itemType: type, id, name };
    document.getElementById('deleteItemName').textContent = `"${name}"`;
    document.getElementById('deleteModalOverlay').style.display = 'flex';
}

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

function showSuccessModal(title, message) {
    document.getElementById('successModalTitle').textContent   = title;
    document.getElementById('successModalMessage').textContent = message;
    document.getElementById('successModalOverlay').style.display = 'flex';
    setTimeout(() => { document.getElementById('successModalOverlay').style.display = 'none'; }, 2000);
}

document.addEventListener("DOMContentLoaded", () => {
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