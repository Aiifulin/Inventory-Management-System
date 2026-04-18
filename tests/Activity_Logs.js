// Activity_Logs.js (NPM/Test Version)
import { initializeApp } from "firebase/app";
import { getFirestore, collection, query, orderBy, getDocs, doc, getDoc } from "firebase/firestore";
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
    const db = initializeFirestore(app, {});
    auth = getAuth(app);
} catch (e) { /* Test env */ }

// ─── EXPORTED LOGIC ──────────────────────────────────────────────────────────

export async function fetchLogsLogic(dbInstance = db) {
    const q = query(collection(dbInstance, "activities"), orderBy("timestamp", "desc"));
    const snapshot = await getDocs(q);
    const logs = [];
    snapshot.forEach(d => {
        const data = d.data();
        logs.push({
            id:        d.id,
            action:    data.action    || '',
            target:    data.target    || '',
            user:      data.user      || 'Admin',
            timestamp: data.timestamp ? data.timestamp.toDate().toISOString() : null
        });
    });
    return logs;
}

export function filterLogsLogic(logs, searchTerm) {
    const term = searchTerm.toLowerCase();
    if (!term) return logs;
    return logs.filter(log =>
        log.action.toLowerCase().includes(term) ||
        log.target.toLowerCase().includes(term) ||
        log.user.toLowerCase().includes(term)
    );
}

export function sortLogsLogic(logs, direction = 'desc') {
    return [...logs].sort((a, b) => {
        const tA = a.timestamp ? new Date(a.timestamp) : 0;
        const tB = b.timestamp ? new Date(b.timestamp) : 0;
        return direction === 'desc' ? tB - tA : tA - tB;
    });
}

export function paginateLogsLogic(logs, page, pageSize) {
    const totalPages = Math.max(1, Math.ceil(logs.length / pageSize));
    const safePage   = Math.min(Math.max(1, page), totalPages);
    const start      = (safePage - 1) * pageSize;
    return {
        rows: logs.slice(start, start + pageSize),
        totalPages,
        currentPage: safePage
    };
}

export function getLogBadgeClass(action) {
    const a = (action || '').toLowerCase();
    if (a.includes('add'))     return 'green';
    if (a.includes('delete'))  return 'red';
    if (a.includes('archive') || a.includes('restore')) return 'orange';
    return 'blue';
}

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const snap = await getDoc(doc(dbInstance, "users", uid));
        if (snap.exists()) return snap.data().role?.toLowerCase() === 'admin';
        return false;
    } catch { return false; }
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}