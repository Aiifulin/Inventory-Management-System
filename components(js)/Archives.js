import { initializeApp } 
from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

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

import { 
    getAuth, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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

let lastVisible = null;
const pageSize = 25;
let sortDirection = "desc";

// ===============================
// AUTH LISTENER
// ===============================
onAuthStateChanged(auth, async (user) => {

    if (!user) {
        window.location.href = "Login.html";
        return;
    }

    await displayUserRole(user.uid);

    const isAdmin = await checkAdminRole(user.uid);

    if (!isAdmin) {
        window.location.href = "Dashboard.html";
        return;
    }

    document.documentElement.style.visibility = "visible";
    loadArchivedProducts(true);
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

    // 🔥 STOP if logged out mid-process
    if (!auth.currentUser) return;

    let q;

    if (reset || !lastVisible) {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirection),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", sortDirection),
            startAfter(lastVisible),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);

    // 🔥 STOP if logged out during fetch
    if (!auth.currentUser) return;

    const table = document.getElementById("archiveTable");
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
                     class="product-img">
            </td>
            <td>${product.name || ""}</td>
            <td>${product.category || ""}</td>
            <td>${archivedDate}</td>
            <td>
    <div class="action-buttons">
        <button class="btn-restore" data-id="${id}">
            Restore
        </button>
        <button class="btn-delete admin-only" data-id="${id}">
            Delete Permanently
        </button>
    </div>
</td>
        `;

        table.appendChild(row);
    });

    lastVisible = snapshot.docs[snapshot.docs.length - 1];
}

// ===============================
// EVENT DELEGATION (FIXED)
// ===============================
document.getElementById("archiveTable").addEventListener("click", (e) => {

    const restoreBtn = e.target.closest(".btn-restore");
    const deleteBtn = e.target.closest(".btn-delete");

    if (restoreBtn) {
        if (!auth.currentUser) return;
        restoreProduct(restoreBtn.dataset.id);
    }

    if (deleteBtn) {
        if (!auth.currentUser) return;
        permanentlyDelete(deleteBtn.dataset.id);
    }
});

// ===============================
// RESTORE PRODUCT
// ===============================
async function restoreProduct(id) {

    if (!auth.currentUser) return;

    const confirmRestore = confirm("Restore this product?");
    if (!confirmRestore) return;

    const docRef = doc(db, "products", id);
    const snap = await getDoc(docRef);
    const product = snap.data();

    await updateDoc(docRef, {
        archived: false,
        archivedAt: null
    });

    await logActivity("Restore Product", product.name);

    loadArchivedProducts(true);
}

// ===============================
// DELETE PRODUCT
// ===============================
async function permanentlyDelete(id) {

    if (!auth.currentUser) return;

    const confirmDelete = confirm("Delete permanently?");
    if (!confirmDelete) return;

    const docRef = doc(db, "products", id);
    const snap = await getDoc(docRef);
    const product = snap.data();

    await deleteDoc(docRef);

    await logActivity("Delete Product Permanently", product.name);

    loadArchivedProducts(true);
}

// ===============================
// ACTIVITY LOGGER
// ===============================
async function logActivity(action, target) {

    if (!auth.currentUser) return;

    await addDoc(collection(db, "activities"), {
        action,
        target,
        user: auth.currentUser.email || "Unknown",
        timestamp: serverTimestamp()
    });
}

// ===============================
// SEARCH
// ===============================
document.addEventListener("input", function(e){

    if(e.target.id !== "archiveSearch") return;

    const search = e.target.value.toLowerCase();

    document.querySelectorAll("#archiveTable tr").forEach(row => {

        const name = row.children[1]?.textContent.toLowerCase() || "";
        const category = row.children[2]?.textContent.toLowerCase() || "";

        row.style.display =
            (name.includes(search) || category.includes(search))
            ? ""
            : "none";
    });
});

// ===============================
// SORT
// ===============================
document.addEventListener("DOMContentLoaded", () => {

    const sortBtn = document.getElementById("sortArchivedDate");

    sortBtn?.addEventListener("click", () => {
        sortDirection = sortDirection === "desc" ? "asc" : "desc";
        lastVisible = null;
        loadArchivedProducts(true);
    });
});

// ===============================
// LOGOUT (FIXED)
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

// Logout Helper
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
