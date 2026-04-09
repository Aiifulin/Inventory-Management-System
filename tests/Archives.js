// Archives.js (NPM/Test Version)
import { initializeApp } from "firebase/app";
import {
    getFirestore, collection, query, where, orderBy, limit,
    getDocs, doc, updateDoc, deleteDoc, getDoc, addDoc, serverTimestamp
} from "firebase/firestore";
import { getAuth, signOut } from "firebase/auth";

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
    db = getFirestore(app);
    auth = getAuth(app);
} catch (e) { /* Test env */ }

// ─── EXPORTED LOGIC ──────────────────────────────────────────────────────────

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const snap = await getDoc(doc(dbInstance, "users", uid));
        if (snap.exists()) return snap.data().role?.toLowerCase() === 'admin';
        return false;
    } catch { return false; }
}

export async function restoreItemLogic(collectionName, itemId, itemName, dbInstance, authInstance) {
    await updateDoc(doc(dbInstance, collectionName, itemId), {
        archived: false,
        archivedAt: null
    });
    const userEmail = authInstance?.currentUser?.email ?? "Admin";
    const action = collectionName === 'products' ? "Restore Product" : "Restore Category";
    await addDoc(collection(dbInstance, "activities"), {
        action,
        target: itemName,
        user: userEmail,
        timestamp: serverTimestamp()
    });
    return true;
}

export async function permanentDeleteLogic(collectionName, itemId, itemName, dbInstance, authInstance) {
    await deleteDoc(doc(dbInstance, collectionName, itemId));
    const userEmail = authInstance?.currentUser?.email ?? "Admin";
    const action = collectionName === 'products'
        ? "Delete Product Permanently"
        : "Delete Category Permanently";
    await addDoc(collection(dbInstance, "activities"), {
        action,
        target: itemName,
        user: userEmail,
        timestamp: serverTimestamp()
    });
    return true;
}

export async function fetchArchivedItemsLogic(collectionName, dbInstance = db) {
    const q = query(
        collection(dbInstance, collectionName),
        where("archived", "==", true)
    );
    const snap = await getDocs(q);
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    return items;
}

export function searchArchivedItems(items, searchTerm) {
    const term = searchTerm.toLowerCase();
    if (!term) return items;
    return items.filter(item =>
        (item.name     || '').toLowerCase().includes(term) ||
        (item.category || '').toLowerCase().includes(term)
    );
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}