// Categories.js (NPM/Test Version)
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, addDoc, serverTimestamp, getDoc, where, updateDoc, query } from "firebase/firestore";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";

export const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    const db = initializeFirestore(app, {});
    auth = getAuth(app);
} catch (e) { /* Test env */ }

// ─── EXPORTED LOGIC ──────────────────────────────────────────────────────────

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const snap = await getDoc(doc(dbInstance, "users", uid));
        if (snap.exists()) {
            return snap.data().role?.toLowerCase() === 'admin';
        }
        return false;
    } catch { return false; }
}

export function sanitizeCategoryInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function fetchCategoriesLogic(dbInstance = db) {
    const snap = await getDocs(collection(dbInstance, "categories"));
    const categories = [];
    snap.forEach(d => {
        const data = d.data();
        if (data.archived !== true) {
            categories.push({ id: d.id, ...data });
        }
    });
    return categories;
}

export async function archiveCategoryLogic(categoryId, categoryName, dbInstance, authInstance) {
    await updateDoc(doc(dbInstance, "categories", categoryId), {
        archived: true,
        archivedAt: serverTimestamp()
    });
    const userEmail = authInstance?.currentUser?.email ?? "Admin";
    await addDoc(collection(dbInstance, "activities"), {
        action: "Archived Category",
        target: categoryName,
        user: userEmail,
        timestamp: serverTimestamp()
    });
    return true;
}

export function filterCategoriesLogic(categories, searchVal) {
    const term = searchVal.toLowerCase();
    return categories.filter(c => (c.name || "").toLowerCase().includes(term));
}

export async function checkDuplicateCategoryName(name, dbInstance = db) {
    const q = query(
        collection(dbInstance, "categories"),
        where("name", "==", name)
    );
    const snap = await getDocs(q);
    return snap.docs.filter(d => d.data().archived !== true).length > 0;
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}