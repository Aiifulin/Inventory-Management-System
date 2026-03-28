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

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Fetch User Role from 'users' collection
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            alert("Access Denied: Only Admins can access archives.");
            window.location.href = "Products.html";
        } else {
            console.log("Admin verified.");
            // Only load page logic if admin is verified
            displayUserRole(user.uid);
            loadArchivedProducts(true);
            loadArchivedCategories(true);
            document.documentElement.style.visibility = "visible";
        }
    } else {
        window.location.href = "Login.html";
    }
});

// ===============================
// DISPLAY ROLE
// ===============================
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    try {
        const snap = await getDoc(doc(db, "users", uid));

        if (snap.exists()) {
            let role = snap.data().role || "User";
            role = role.charAt(0).toUpperCase() + role.slice(1);
            roleEl.textContent = role;
        } else {
            roleEl.textContent = "User";
        }
    } catch {
        roleEl.textContent = "User";
    }
}

// ===============================
// ADMIN CHECK
// ===============================
async function checkAdminRole(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return false;

    return snap.data().role?.toLowerCase() === "admin";
}

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
            ? product.archivedAt.toDate().toLocaleString()
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
            ? category.archivedAt.toDate().toLocaleString()
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
document.addEventListener("click", (e) => {

    const restoreBtn = e.target.closest(".btn-restore");
    const deleteBtn = e.target.closest(".btn-delete");

    if (restoreBtn) {
        if (!auth.currentUser) return;
        const id = restoreBtn.dataset.id;
        const type = restoreBtn.dataset.type;
        
        if (type === "product") {
            restoreProduct(id);
        } else if (type === "category") {
            restoreCategory(id);
        }
    }

    if (deleteBtn) {
        if (!auth.currentUser) return;
        const id = deleteBtn.dataset.id;
        const type = deleteBtn.dataset.type;
        
        if (type === "product") {
            permanentlyDeleteProduct(id);
        } else if (type === "category") {
            permanentlyDeleteCategory(id);
        }
    }
});

// ===============================
// RESTORE PRODUCT
// ===============================
async function restoreProduct(id) {

    if (!auth.currentUser) return;

    const confirmRestore = confirm("Restore this product?");
    if (!confirmRestore) return;

    try {
        const docRef = doc(db, "products", id);
        const snap = await getDoc(docRef);
        const product = snap.data();

        await updateDoc(docRef, {
            archived: false,
            archivedAt: null
        });

        await logActivity("Restore Product", product.name);
        loadArchivedProducts(true);
        alert("Product restored successfully.");
    } catch (error) {
        console.error("Error restoring product:", error);
        alert("Error restoring product.");
    }
}

// ===============================
// DELETE PRODUCT PERMANENTLY
// ===============================
async function permanentlyDeleteProduct(id) {

    if (!auth.currentUser) return;

    const confirmDelete = confirm("Delete permanently? This cannot be undone.");
    if (!confirmDelete) return;

    try {
        const docRef = doc(db, "products", id);
        const snap = await getDoc(docRef);
        const product = snap.data();

        await deleteDoc(docRef);

        await logActivity("Delete Product Permanently", product.name);
        loadArchivedProducts(true);
        alert("Product permanently deleted.");
    } catch (error) {
        console.error("Error deleting product:", error);
        alert("Error deleting product.");
    }
}

// ===============================
// RESTORE CATEGORY
// ===============================
async function restoreCategory(id) {

    if (!auth.currentUser) return;

    const confirmRestore = confirm("Restore this category?");
    if (!confirmRestore) return;

    try {
        const docRef = doc(db, "categories", id);
        const snap = await getDoc(docRef);
        const category = snap.data();

        await updateDoc(docRef, {
            archived: false,
            archivedAt: null
        });

        await logActivity("Restore Category", category.name);
        loadArchivedCategories(true);
        alert("Category restored successfully.");
    } catch (error) {
        console.error("Error restoring category:", error);
        alert("Error restoring category.");
    }
}

// ===============================
// DELETE CATEGORY PERMANENTLY
// ===============================
async function permanentlyDeleteCategory(id) {

    if (!auth.currentUser) return;

    const confirmDelete = confirm("Delete permanently? This cannot be undone.");
    if (!confirmDelete) return;

    try {
        const docRef = doc(db, "categories", id);
        const snap = await getDoc(docRef);
        const category = snap.data();

        await deleteDoc(docRef);

        await logActivity("Delete Category Permanently", category.name);
        loadArchivedCategories(true);
        alert("Category permanently deleted.");
    } catch (error) {
        console.error("Error deleting category:", error);
        alert("Error deleting category.");
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

        row.style.display =
            (name.includes(search) || category.includes(search))
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

        row.style.display = categoryName.includes(search) ? "" : "none";
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
// LOGOUT
// ===============================
window.logout = function() {
    // Clear LOCAL storage now
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    
    // Also clear session just in case
    sessionStorage.clear();

    signOut(auth).then(() => {
        window.location.replace("Login.html");
    }).catch((error) => {
        console.error("Logout Error:", error);
        window.location.replace("Login.html");
    });
};