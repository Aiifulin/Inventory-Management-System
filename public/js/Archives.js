import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    query, 
    where,
    orderBy,
    limit,
    getDocs,
    startAfter,
    doc,
    updateDoc,
    deleteDoc,
    getDoc,
    addDoc,
    serverTimestamp

} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";

// 🔹 Firebase Config
const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let lastVisibleProducts = null;
let lastVisibleCategories = null;
const pageSize = 25;
let sortDirectionProducts = "desc";
let sortDirectionCategories = "desc";
let pendingAction = null; // { type: 'restore'|'delete', itemType: 'product'|'category', id, name }


// ================================================
// OPTIMIZED USER CACHE (SHARED)
// ================================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;

    // 1. Try cache first
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    // 2. Fetch if not cached
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

async function checkAdminRole(uid) {
    const userData = await getCachedUserData(uid);
    return userData?.role?.toLowerCase() === "admin";
}

async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    const userData = await getCachedUserData(uid);

    let role = userData?.role || "User";
    role = role.charAt(0).toUpperCase() + role.slice(1);

    roleEl.textContent = role;
}

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const main = document.getElementById('mainContent');

        await displayUserRole(user.uid);

        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            main.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; 
                            justify-content:center; height:60vh; text-align:center; 
                            color:var(--text-secondary);">
                    <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
                    <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
                    <p style="margin:0; font-size:14px;">You do not have permission to view Settings.</p>
                </div>`;
            
            main.style.visibility = 'visible';
            document.documentElement.style.visibility = 'visible'; 
            return;
        }

        // Load content
        loadArchivedProducts(true);
        loadArchivedCategories(true);

        main.style.visibility = 'visible';
        document.documentElement.style.visibility = 'visible'; 
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

    } else {
        window.location.href = "index.html";
    }
});



// ===============================
// LOAD ARCHIVED PRODUCTS
// ===============================
async function loadArchivedProducts(reset = true) {

    // 🔥 STOP if not logged in (extra safety)
    if (!auth.currentUser) return;

    let q;
    if (reset || !lastVisibleProducts) {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirectionProducts),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirectionProducts),
            startAfter(lastVisibleProducts),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);

    // 🔥 STOP if logged out during fetch
    if (!auth.currentUser) return;

    const table = document.getElementById("archiveTableProductsBody");
    if (!table) return;

    if (reset) table.innerHTML = "";

    if (snapshot.empty) {
        table.innerHTML = `
            <tr>
                <td colspan="5" style="text-align:center;padding:20px;color:#999;">
                    No archived products found.
                </td>
            </tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const product = docSnap.data();
        const id = docSnap.id;

        const archivedDate = product.archivedAt
        ? product.archivedAt.toDate().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        })
        : "—";

        const imageUrl = product.imageUrl || "placeholder.png";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <img src="${imageUrl}" 
                     alt="${product.name}" 
                     class="product-img"
                     style="max-width: 50px; height: auto;">
            </td>
            <td>${product.name || ""}</td>
            <td>${product.category || ""}</td>
            <td>${archivedDate}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-restore" data-id="${id}" data-type="product">
                        Restore
                    </button>
                    <button class="btn-delete" data-id="${id}" data-type="product">
                        Delete Permanently
                    </button>
                </div>
            </td>
        `;

        table.appendChild(row);
    });

    if (snapshot.docs.length > 0) {
        lastVisibleProducts = snapshot.docs[snapshot.docs.length - 1];
    }
}

// ===============================
// LOAD ARCHIVED CATEGORIES
// ===============================
async function loadArchivedCategories(reset = true) {

    // 🔥 STOP if not logged in
    if (!auth.currentUser) return;

    let q;
    if (reset || !lastVisibleCategories) {
        q = query(
            collection(db, "categories"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirectionCategories),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "categories"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirectionCategories),
            startAfter(lastVisibleCategories),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);

    // 🔥 STOP if logged out during fetch
    if (!auth.currentUser) return;

    const table = document.getElementById("archiveTableCategoriesBody");
    if (!table) return;

    if (reset) table.innerHTML = "";

    if (snapshot.empty) {
        table.innerHTML = `
            <tr>
                <td colspan="3" style="text-align:center;padding:20px;color:#999;">
                    No archived categories found.
                </td>
            </tr>`;
        return;
    }

    snapshot.forEach(docSnap => {
        const category = docSnap.data();
        const id = docSnap.id;

        const archivedDate = category.archivedAt
        ? category.archivedAt.toDate().toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        })
        : "—";

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${category.name || ""}</td>
            <td>${archivedDate}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-restore" data-id="${id}" data-type="category">
                        Restore
                    </button>
                    <button class="btn-delete" data-id="${id}" data-type="category">
                        Delete Permanently
                    </button>
                </div>
            </td>
        `;

        table.appendChild(row);
    });

    if (snapshot.docs.length > 0) {
        lastVisibleCategories = snapshot.docs[snapshot.docs.length - 1];
    }
}

// ===============================
// EVENT DELEGATION FOR PRODUCTS & CATEGORIES
// ===============================
document.addEventListener("click", async (e) => {
    const restoreBtn = e.target.closest(".btn-restore");
    const deleteBtn  = e.target.closest(".btn-delete");

    if (!auth.currentUser) return;

    if (restoreBtn) {
        const id   = restoreBtn.dataset.id;
        const type = restoreBtn.dataset.type;
        const collection_name = type === 'product' ? 'products' : 'categories';

        const snap = await getDoc(doc(db, collection_name, id));
        const name = snap.exists() ? snap.data().name : id;
        openRestoreModal(id, type, name);
    }

    if (deleteBtn) {
        const id   = deleteBtn.dataset.id;
        const type = deleteBtn.dataset.type;
        const collection_name = type === 'product' ? 'products' : 'categories';

        const snap = await getDoc(doc(db, collection_name, id));
        const name = snap.exists() ? snap.data().name : id;
        openDeleteModal(id, type, name);
    }
});

// ===============================
// RESTORE PRODUCT
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

// ===============================
// ACTIVITY LOGGER
// ===============================
async function logActivity(action, target) {

    if (!auth.currentUser) return;

    try {
        await addDoc(collection(db, "activities"), {
            action,
            target,
            user: auth.currentUser.email || "Unknown",
            timestamp: serverTimestamp()
        });
    } catch (error) {
        console.error("Error logging activity:", error);
    }
}

// ===============================
// SEARCH PRODUCTS
// ===============================
document.addEventListener("input", function(e){

    if(e.target.id !== "archiveSearchProducts") return;

    const search = e.target.value.toLowerCase();

    document.querySelectorAll("#archiveTableProductsBody tr").forEach(row => {

        const name = row.children[1]?.textContent.toLowerCase() || "";
        const category = row.children[2]?.textContent.toLowerCase() || "";
        const date = row.children[3]?.textContent.toLowerCase() || "";

        row.style.display =
            (name.includes(search) || category.includes(search) || date.includes(search))
            ? ""
            : "none";
    });
});

// ===============================
// SEARCH CATEGORIES
// ===============================
document.addEventListener("input", function(e){

    if(e.target.id !== "archiveSearchCategories") return;

    const search = e.target.value.toLowerCase();

    document.querySelectorAll("#archiveTableCategoriesBody tr").forEach(row => {

        const categoryName = row.children[0]?.textContent.toLowerCase() || "";
        const date = row.children[1]?.textContent.toLowerCase() || "";

        row.style.display = categoryName.includes(search) || date.includes(search) ? "" : "none";
    });
});

// ===============================
// SORT
// ===============================
document.addEventListener("DOMContentLoaded", () => {

    const sortBtnProducts = document.getElementById("sortArchivedDateProducts");
    const sortBtnCategories = document.getElementById("sortArchivedDateCategories");

    sortBtnProducts?.addEventListener("click", () => {
        sortDirectionProducts = sortDirectionProducts === "desc" ? "asc" : "desc";
        lastVisibleProducts = null;
        loadArchivedProducts(true);
    });

    sortBtnCategories?.addEventListener("click", () => {
        sortDirectionCategories = sortDirectionCategories === "desc" ? "asc" : "desc";
        lastVisibleCategories = null;
        loadArchivedCategories(true);
    });
});

// ===============================
// SIDEBAR TOGGLE
// ===============================
document.addEventListener("DOMContentLoaded", () => {
    const hamburgerBtn = document.getElementById('hamburgerBtn');
    const closeBtn = document.getElementById('closeBtn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('overlay');

    function toggleSidebar() {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', closeSidebar);
    }

    if (overlay) {
        overlay.addEventListener('click', closeSidebar);
    }
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
    document.getElementById('deleteModalOverlay').style.display = 'none';

    // Reset buttons
    const restoreBtn = document.getElementById('restoreConfirmBtn');
    const deleteBtn  = document.getElementById('deleteConfirmBtn');
    restoreBtn.disabled = false;
    restoreBtn.innerHTML = '<i class="fas fa-rotate-left"></i> Restore';
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete Forever';

    pendingAction = null;
}

function showSuccessModal(title, message) {
    document.getElementById('successModalTitle').textContent   = title;
    document.getElementById('successModalMessage').textContent = message;
    document.getElementById('successModalOverlay').style.display = 'flex';

    setTimeout(() => {
        document.getElementById('successModalOverlay').style.display = 'none';
    }, 2000);
}

// Wire modal buttons on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {

    // Backdrop clicks
    document.getElementById('restoreModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('restoreModalOverlay')) closeAllModals();
    });
    document.getElementById('deleteModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('deleteModalOverlay')) closeAllModals();
    });

    document.getElementById('restoreCancelBtn')?.addEventListener('click', closeAllModals);
    document.getElementById('deleteCancelBtn')?.addEventListener('click',  closeAllModals);

    // Restore confirm
    document.getElementById('restoreConfirmBtn')?.addEventListener('click', async () => {
        if (!pendingAction) return;
        const btn = document.getElementById('restoreConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Restoring...';

        const { itemType, id, name } = pendingAction;
        try {
            if (itemType === 'product') {
                await restoreProduct(id, name);
            } else {
                await restoreCategory(id, name);
            }
        } finally {
            closeAllModals();
        }
    });

    // Delete confirm
    document.getElementById('deleteConfirmBtn')?.addEventListener('click', async () => {
        if (!pendingAction) return;
        const btn = document.getElementById('deleteConfirmBtn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

        const { itemType, id, name } = pendingAction;
        try {
            if (itemType === 'product') {
                await permanentlyDeleteProduct(id, name);
            } else {
                await permanentlyDeleteCategory(id, name);
            }
        } finally {
            closeAllModals();
        }
    });
});

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle';
    
    toast.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}