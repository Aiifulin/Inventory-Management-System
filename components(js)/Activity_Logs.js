import { initializeApp } 
from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import { 
    getFirestore, 
    collection, 
    query, 
    orderBy, 
    limit, 
    getDocs, 
    startAfter,
    where,
    doc,
    getDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { 
    getAuth, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// --- CONFIG ---
const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- AUTH LISTENER ---(Abstracion Example)
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // visual display of user role
        displayUserRole(user.uid);

        // handles decision for admin and non-admin users
        const isAdmin = await checkAdminRole(user.uid);

        // if not admin then hide add button
        if (!isAdmin) {
            const addBtn = document.querySelector('.btn-add'); 
            if (addBtn) addBtn.style.display = 'none';
        }

    } else {
        window.location.href = "Login.html";
    }
});

// --- HELPER: TIME FORMATTER ---
function formatTimeAgo(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return "Just now";

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 2) {
        return `${diffInHours} hour${diffInHours !== 1 ? 's' : ''} ago`;
    }

    return date.toLocaleString('en-US', { 
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
    });
}

// --- HELPER: DISPLAY USER ROLE ---
async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    try {
        const docRef = doc(db, "users", uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            let roleName = data.role || "User";
            roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
            roleEl.textContent = roleName;
        } else {
            roleEl.textContent = "User"; 
        }
    } catch (error) {
        console.error("Error displaying role:", error);
        roleEl.textContent = "User";
    }
}

// --- role checker for admins ---(Encapsulation Example)
async function checkAdminRole(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
        // basically if the role is admin return true 
        if (userSnap.exists()) {
            const userData = userSnap.data();
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
        return false;
    } catch (error) {
        console.error("Error checking role:", error);
        return false; 
    }
}

let lastVisible = null;
const pageSize = 50;

async function loadLogs(reset = true) {

    const selectedAction =
        document.querySelector('input[name="actionFilter"]:checked')?.value;

    let q;

    // FIRST PAGE
    if (reset || !lastVisible) {

        if (selectedAction && selectedAction !== "all") {
            q = query(
                collection(db, "activities"),
                where("action", "==", selectedAction),
                orderBy("timestamp", "desc"),
                limit(pageSize)
            );
        } else {
            q = query(
                collection(db, "activities"),
                orderBy("timestamp", "desc"),
                limit(pageSize)
            );
        }

} else {

    if (selectedAction && selectedAction !== "all") {
        q = query(
            collection(db, "activities"),
            where("action", "==", selectedAction),
            orderBy("timestamp", "desc"),
            startAfter(lastVisible),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "activities"),
            orderBy("timestamp", "desc"),
            startAfter(lastVisible),
            limit(pageSize)
        );
    }
}

    const snapshot = await getDocs(q);
    console.log("Query result size:", snapshot.size);

    const table = document.getElementById("logTable");
    if (!table) return;

    if (reset) table.innerHTML = "";

    if (snapshot.empty) {
        table.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;padding:20px;color:#999;">
                    No activity logs found.
                </td>
            </tr>`;
        return;
    }

    snapshot.forEach(doc => {
        const log = doc.data();

        const date = log.timestamp
            ? log.timestamp.toDate().toLocaleString()
            : "Just now";

        let badgeClass = "blue";

        const action = (log.action || "").toLowerCase();
        if (action.includes("add")) badgeClass = "green";
        if (action.includes("delete")) badgeClass = "red";

        table.innerHTML += `
            <tr>
                <td>${date}</td>
                <td><span class="badge ${badgeClass}">${log.action || ""}</span></td>
                <td class="product-name">${log.target || ""}</td>
                <td>${log.user || ""}</td>
            </tr>
        `;
    });

    lastVisible = snapshot.docs[snapshot.docs.length - 1];
}

loadLogs(true);

document.querySelectorAll('input[name="actionFilter"]').forEach(radio => {
    radio.addEventListener("change", () => {
        lastVisible = null;
        loadLogs(true);
    });
});