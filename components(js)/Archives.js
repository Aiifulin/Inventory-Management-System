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
let sortDirection = "desc"

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

    // ✅ Reveal page immediately for admin
    document.documentElement.style.visibility = "visible";

    // THEN load content
    loadArchivedProducts(true); 
    // or loadLogs(true) on activity page

});

// ===============================
// 👤 DISPLAY ROLE
// ===============================
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    try {
        const docRef = doc(db, "users", uid);
        const snap = await getDoc(docRef);

        if (snap.exists()) {
            let role = snap.data().role || "User";
            role = role.charAt(0).toUpperCase() + role.slice(1);
            roleEl.textContent = role;
        } else {
            roleEl.textContent = "User";
        }
    } catch (err) {
        roleEl.textContent = "User";
    }
}

// ===============================
// 🛡 ADMIN CHECK
// ===============================
async function checkAdminRole(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return false;

    const isAdmin = snap.data().role?.toLowerCase() === "admin";

    if (!isAdmin) {
        document.querySelectorAll(".admin-only")
            .forEach(el => el.style.display = "none");
    }

    return isAdmin;
}

// ===============================
//  LOAD ARCHIVED PRODUCTS
// ===============================
async function loadArchivedProducts(reset = true) {

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

    const table = document.getElementById("archiveTable");
    if (!table) return;

    if (reset) table.innerHTML = "";

    if (snapshot.empty) {
        table.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;padding:20px;color:#999;">
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

    table.innerHTML += `
        <tr>
            <td>
                <img src="${imageUrl}" 
                     alt="${product.name}" 
                     class="product-img">
            </td>
            <td>${product.name || ""}</td>
            <td>${product.category || ""}</td>
            <td>${archivedDate}</td>
            <td>
                <button class="btn-restore" data-id="${id}">
                    Restore
                </button>
                <button class="btn-delete admin-only" data-id="${id}">
                    Delete Permanently
                </button>
            </td>
        </tr>
    `;
});

    lastVisible = snapshot.docs[snapshot.docs.length - 1];

    attachArchiveEvents();
}

// ===============================
// RESTORE PRODUCT
// ===============================
async function restoreProduct(id) {

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
//  PERMANENT DELETE
// ===============================
async function permanentlyDelete(id) {

    const confirmDelete = confirm("This will permanently delete the product. Continue?");
    if (!confirmDelete) return;

    const docRef = doc(db, "products", id);
    const snap = await getDoc(docRef);
    const product = snap.data();

    await deleteDoc(docRef);

    await logActivity("Delete Product Permanently", product.name);

    loadArchivedProducts(true);
}

// ===============================
//  EVENT BINDING
// ===============================
function attachArchiveEvents() {

    document.querySelectorAll(".btn-restore").forEach(btn => {
        btn.addEventListener("click", () => {
            restoreProduct(btn.dataset.id);
        });
    });

    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => {
            permanentlyDelete(btn.dataset.id);
        });
    });
}

// ===============================
//  ACTIVITY LOGGER
// ===============================
async function logActivity(action, target) {

    const user = auth.currentUser;

    await addDoc(collection(db, "activities"), {
        action: action,
        target: target,
        user: user?.email || "Unknown",
        timestamp: serverTimestamp()
    });
}

document.addEventListener("input", function(e){

    if(e.target.id !== "archiveSearch") return;

    const search = e.target.value.toLowerCase();

    const rows = document.querySelectorAll("#archiveTable tr");

    rows.forEach(row => {

        const name = row.children[1]?.textContent.toLowerCase() || "";
        const category = row.children[2]?.textContent.toLowerCase() || "";

        if(name.includes(search) || category.includes(search)){
            row.style.display = "";
        } else {
            row.style.display = "none";
        }

    });

});

document.addEventListener("DOMContentLoaded", () => {

    const sortBtn = document.getElementById("sortArchivedDate");
    if (!sortBtn) return;

    sortBtn.addEventListener("click", () => {

        sortDirection = sortDirection === "desc" ? "asc" : "desc";

        lastVisible = null;
        loadArchivedProducts(true);

    });

});

window.addEventListener("load", () => {
    document.documentElement.style.visibility = "visible";
});