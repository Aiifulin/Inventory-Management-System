import { collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc, query} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { getCountFromServer } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { db, auth, storage } from "./firebase.js";


// --- GLOBAL STATE ---
let allCategories      = [];
let filteredCategories = []; 
let currentSortDir     = 'asc';
let currentUser        = null;
let isAdmin            = false;
let isCategoriesLoading = true;

// Add near the top with other state variables
const CATEGORIES_CACHE_KEY = 'categories_cache';

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

// ================================================
// AUTH — parallel: user data + categories fire at the same time
// ================================================
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

    // Re-render so admin action icons appear
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

// --- FETCH DATA ---
async function fetchCategories() {
    setCategoriesLoading(true);

    const cached = loadCategoriesCache();
    if (cached) {
        allCategories = cached;
        setCategoriesLoading(false);
        applyFilters();
        return; // ← skip Firestore + count queries entirely
    }

    try {
        const q = query(collection(db, "categories"), where("archived", "==", false));
        const querySnapshot = await getDocs(q);

        allCategories = querySnapshot.docs.map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data(),
            itemCount: 0
        }));

        setCategoriesLoading(false);
        applyFilters();

        // Load counts then save the complete data to cache
        await loadCategoryCounts(querySnapshot.docs);
        saveCategoriesCache(allCategories); // ← save AFTER counts are patched in

    } catch (error) {
        console.error("Error loading categories:", error);
        allCategories = [];
        setCategoriesLoading(false);
    }
}

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

// --- FILTER & SORT ---
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

async function loadCategoryCounts(docs) {
    // 🔥 All count queries in parallel
    const updates = await Promise.all(
        docs.map(async (docSnap) => {
            const data = docSnap.data();
            if (data.archived === true) return null;
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

    updates.forEach(update => {
        if (!update) return;
        const cat = allCategories.find(c => c.id === update.id);
        if (cat) cat.itemCount = update.count;
    });

    applyFilters(); // smooth patch update
}

// --- RENDER TABLE ---
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

// --- EDIT FUNCTION ---
window.editCategory = function(id) {
    if (isAdmin) {
        window.location.href = `Edit_Category.html?id=${id}`;
    } else {
        showToast("Access Denied: Only Admin can edit categories.", "error");
    }
}

// --- MODAL STATE ---
let pendingDeleteId   = null;
let pendingDeleteName = null;

function openDeleteModal(id, name) {
    pendingDeleteId   = id;
    pendingDeleteName = name;
    document.getElementById('deleteCategoryName').textContent = `"${name}"`;
    document.getElementById('deleteModalOverlay').style.display = 'flex';
}

function closeDeleteModal() {
    pendingDeleteId   = null;
    pendingDeleteName = null;
    document.getElementById('deleteModalOverlay').style.display = 'none';
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.disabled = false;
    confirmBtn.innerHTML = '<i class="fas fa-archive"></i> Archive';
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById('modalCancelBtn')?.addEventListener('click', closeDeleteModal);

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
            await updateDoc(doc(db, "categories", pendingDeleteId), {
                archived: true, archivedAt: serverTimestamp()
            });
            
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
            sessionStorage.removeItem('dashboard_cache');
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

export { getCachedUserData, logActivity, fetchCategories, applyFilters, loadCategoryCounts, saveCategoriesCache, loadCategoriesCache, };