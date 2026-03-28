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
    serverTimestamp, 
    addDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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

// ===============================
// AUTH LISTENER
// ===============================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        await displayUserRole(user.uid);
        await checkAdminRole(user.uid);
        loadArchivedProducts(true);
        loadArchivedCategories(true);
    } else {
        window.location.href = "Login.html";
    }
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
    } catch {
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
    if (reset || !lastVisibleProducts) {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", "desc"),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "products"),
            where("archived", "==", true),
            orderBy("archivedAt", "desc"),
            startAfter(lastVisibleProducts),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);
    const tableBody = document.getElementById("archiveTableProductsBody");
    if (!tableBody) return;
    if (reset) tableBody.innerHTML = "";

    if (snapshot.empty) {
        tableBody.innerHTML = `
            <tr><td colspan="5" style="text-align:center;padding:20px;color:#999;">
                No archived products found.
            </td></tr>`;
        return;
    }

    // ✅ Limit to 10 rows
    const docsToRender = snapshot.docs.slice(0, 10);

    docsToRender.forEach(docSnap => {
        const product = docSnap.data();
        const id = docSnap.id;
        const archivedDate = product.archivedAt ? product.archivedAt.toDate().toLocaleString() : "—";
        const imageUrl = product.imageUrl || "placeholder.png";

        tableBody.innerHTML += `
            <tr>
                <td><img src="${imageUrl}" alt="${product.name}" class="product-img"></td>
                <td>${product.name || ""}</td>
                <td>${product.category || ""}</td>
                <td>${archivedDate}</td>
                <td>
                    <button class="btn-restore" data-id="${id}">Restore</button>
                    <button class="btn-delete admin-only" data-id="${id}">Delete Permanently</button>
                </td>
            </tr>`;
    });

    lastVisibleProducts = snapshot.docs[snapshot.docs.length - 1];
    attachProductEvents();
}

// ===============================
//  LOAD ARCHIVED CATEGORIES
// ===============================
async function loadArchivedCategories(reset = true) {
    let q;
    if (reset || !lastVisibleCategories) {
        q = query(
            collection(db, "categories"),
            where("archived", "==", true),
            orderBy("archivedAt", "desc"),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "categories"),
            where("archived", "==", true),
            orderBy("archivedAt", "desc"),
            startAfter(lastVisibleCategories),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);
    const tableBody = document.getElementById("archiveTableCategoriesBody");
    if (!tableBody) return;
    if (reset) tableBody.innerHTML = "";

    if (snapshot.empty) {
        tableBody.innerHTML = `
            <tr><td colspan="4" style="text-align:center;padding:20px;color:#999;">
                No archived categories found.
            </td></tr>`;
        return;
    }

    // ✅ Limit to 10 rows
    const docsToRender = snapshot.docs.slice(0, 10);

    docsToRender.forEach(docSnap => {
        const category = docSnap.data();
        const id = docSnap.id;
        const archivedDate = category.archivedAt ? category.archivedAt.toDate().toLocaleString() : "—";

        tableBody.innerHTML += `
            <tr>
                <td>${category.name || ""}</td>
                <td>${category.description || ""}</td>
                <td>${archivedDate}</td>
                <td>
                    <button class="btn-restore" data-id="${id}">Restore</button>
                    <button class="btn-delete admin-only" data-id="${id}">Delete Permanently</button>
                </td>
            </tr>`;
    });

    lastVisibleCategories = snapshot.docs[snapshot.docs.length - 1];
    attachCategoryEvents();
}

// ===============================
// RESTORE / DELETE PRODUCTS
// ===============================
async function restoreProduct(id) {
    await updateDoc(doc(db, "products", id), { archived: false, archivedAt: null });
    alert("Product restored successfully.");
    loadArchivedProducts(true);
}

async function permanentlyDeleteProduct(id) {
    if (!confirm("This will permanently delete the product. Continue?")) return;
    await deleteDoc(doc(db, "products", id));
    alert("Product permanently deleted.");
    loadArchivedProducts(true);
}

// ===============================
// RESTORE / DELETE CATEGORIES
// ===============================
async function restoreCategory(id) {
    await updateDoc(doc(db, "categories", id), { archived: false, archivedAt: null });
    alert("Category restored successfully.");
    loadArchivedCategories(true);
}

async function permanentlyDeleteCategory(id) {
    if (!confirm("This will permanently delete the category. Continue?")) return;
    await deleteDoc(doc(db, "categories", id));
    alert("Category permanently deleted.");
    loadArchivedCategories(true);
}

// ===============================
// EVENT BINDING
// ===============================
function attachProductEvents() {
    document.querySelectorAll(".btn-restore").forEach(btn => {
        btn.addEventListener("click", () => restoreProduct(btn.dataset.id));
    });
    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => permanentlyDeleteProduct(btn.dataset.id));
    });
}

function attachCategoryEvents() {
    document.querySelectorAll(".btn-restore").forEach(btn => {
        btn.addEventListener("click", () => restoreCategory(btn.dataset.id));
    });
    document.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => permanentlyDeleteCategory(btn.dataset.id));
    });
}
