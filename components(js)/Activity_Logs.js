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
let sortDirection = "desc"; // default (newest first)
let lastVisible = null;
const pageSize = 50;


const dateHeader = document.getElementById("dateHeader");

dateHeader.addEventListener("click", () => {

    sortDirection = (sortDirection === "desc") ? "asc" : "desc";

    lastVisible = null;

    updateDateHeader();

    loadLogs(true);
});

function updateDateHeader() {
    const header = document.getElementById("dateHeader");

    header.textContent = sortDirection === "desc"
        ? "Date ↓"
        : "Date ↑";
}


async function loadLogs(reset = true) {

    let q;

    if (reset || !lastVisible) {
        q = query(
            collection(db, "activities"),
            orderBy("timestamp", sortDirection),
            limit(pageSize)
        );
    } else {
        q = query(
            collection(db, "activities"),
            orderBy("timestamp", sortDirection),
            startAfter(lastVisible),
            limit(pageSize)
        );
    }

    const snapshot = await getDocs(q);

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

document.addEventListener("input", function(e){

    if(e.target.id !== "logSearch") return;

    const search = e.target.value.toLowerCase();

    const rows = document.querySelectorAll("#logTable tr");

    rows.forEach(row => {

        const action = row.children[1]?.textContent.toLowerCase() || "";
        const product = row.children[2]?.textContent.toLowerCase() || "";

        if(action.includes(search) || product.includes(search)){
            row.style.display = "";
        } else {
            row.style.display = "none";
        }

    });

});

window.addEventListener("load", () => {
    document.documentElement.style.visibility = "visible";
});

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