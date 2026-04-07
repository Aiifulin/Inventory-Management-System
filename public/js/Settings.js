import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";

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
const db = getFirestore(app);
const auth = getAuth(app);

const SETTINGS_DOC_ID = "global_config"; 
async function getCachedUserData(uid) {
    const key    = `user_data_${uid}`;
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached);

    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            sessionStorage.setItem(key, JSON.stringify(snap.data()));
            return snap.data();
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

async function checkAdminRole(uid) {
    const data = await getCachedUserData(uid);
    return data?.role?.toLowerCase() === 'admin';
}

async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    const data = await getCachedUserData(uid);
    const role = data?.role || "User";

    roleEl.textContent = role.charAt(0).toUpperCase() + role.slice(1);
}

// --- AUTH LISTENER & SECURITY CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const main = document.getElementById('mainContent');

        // ✅ SHOW ROLE FIRST (instant UI)
        await displayUserRole(user.uid);

        // ✅ GET ADMIN STATUS (from cache)
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            main.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; 
                            justify-content:center; height:60vh; text-align:center; 
                            color:var(--text-secondary);">
                    <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
                    <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
                    <p style="margin:0; font-size:14px;">You do not have permission to view Settings.</p>
                </div>`;
            main.style.visibility = 'visible';
            return;
        }

        // ✅ GET USER DATA (cached)
        const data = await getCachedUserData(user.uid);

        const fullUser = {
            ...user,
            displayName: data?.name || user.displayName || "Admin User",
            role: data?.role || "User"
        };

        populateAdminInfo(fullUser);
        loadSettings();
        loadUserTable();
        initDarkMode();

        main.style.visibility = 'visible';
        // =======================================================
        // Logout Confirmation Modal (shared pattern with Dashboard)
        // =======================================================
        const doSignOut = () => {
            localStorage.removeItem("user_session"); localStorage.removeItem("user_uid"); localStorage.removeItem("user_role");
            sessionStorage.clear();
            signOut(auth).then(() => window.location.replace("Login.html")).catch(() => window.location.replace("Login.html"));
        };
        const openLogoutModal = initLogoutModal(doSignOut);
        window.logout = function () { if (openLogoutModal) openLogoutModal(); }; 

    } else {
        window.location.href = "Login.html";
    }
});

// --- DARK MODE LOGIC ---
function initDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    const currentTheme = localStorage.getItem('theme');

    // Set initial toggle state based on storage
    if (currentTheme === 'dark') {
        if (toggle) toggle.checked = true;
    }

    // Listener
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('theme', 'dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                localStorage.setItem('theme', 'light');
            }
        });
    }
}



// --- LOAD USERS TABLE ---
async function loadUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No users found.</td></tr>';
            return;
        }

        let html = '';
        querySnapshot.forEach((doc) => {
            const u = doc.data();
            const userId = doc.id;
            const isSelf = (userId === auth.currentUser.uid);

            const adminSelected = u.role === 'admin' ? 'selected' : '';
            const userSelected = u.role === 'user' ? 'selected' : '';
            const disabledState = isSelf ? 'disabled' : '';

            html += `
                <tr>
                    <td>
                        <div class="user-info-cell">
                            <span class="user-name">
                                ${u.name || 'No Name'} 
                                ${isSelf ? '<span class="user-self-tag">YOU</span>' : ''}
                            </span>
                        </div>
                    </td>
                    <td style="color: var(--text-secondary);">${u.email}</td>
                    <td>
                        <select class="role-select" id="role-${userId}" ${disabledState}>
                            <option value="user" ${userSelected}>User</option>
                            <option value="admin" ${adminSelected}>Admin</option>
                        </select>
                    </td>
                    <td style="text-align: right;">
                        ${!isSelf ? `<button class="btn-update" onclick="updateUserRole('${userId}')">Update</button>` : '<span style="font-size:12px; color: var(--text-secondary); font-style:italic;">Locked</span>'}
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;

    } catch (error) {
        console.error("Error loading users:", error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Error loading users.</td></tr>';
    }
}

// --- UPDATE USER ROLE FUNCTION ---
window.updateUserRole = async function(userId) {
    const selectEl = document.getElementById(`role-${userId}`);
    const newRole = selectEl.value;
    const btn = selectEl.parentElement.nextElementSibling.querySelector('button');

    try {
        btn.textContent = "...";
        btn.disabled = true;

        await updateDoc(doc(db, "users", userId), {
            role: newRole
        });

        alert("User role updated successfully!");
    } catch (error) {
        console.error("Error updating role:", error);
        alert("Failed to update role.");
    } finally {
        btn.textContent = "Update";
        btn.disabled = false;
    }
};

// --- POPULATE ADMIN INFO (Profile Card) ---
function populateAdminInfo(user) {
    const nameEl = document.getElementById('adminNameDisplay');
    const emailEl = document.getElementById('adminEmailDisplay');
    const idEl = document.getElementById('adminIdDisplay');

    // Display Name: Prioritize DB name -> Auth DisplayName -> Default
    nameEl.textContent = user.displayName;
    emailEl.textContent = user.email;
    idEl.textContent = user.uid;
}

// --- LOAD SETTINGS ---
async function loadSettings() {
    try {
        const docRef = doc(db, "settings", SETTINGS_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.defaultLowStockThreshold) {
                document.getElementById('defaultThreshold').value = data.defaultLowStockThreshold;
            } else {
                document.getElementById('defaultThreshold').value = 10;
            }
        } else {
            document.getElementById('defaultThreshold').value = 10;
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

// --- SAVE SETTINGS ---
const saveBtn = document.getElementById('saveSettingsBtn');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const thresholdVal = parseInt(document.getElementById('defaultThreshold').value);

        if (isNaN(thresholdVal) || thresholdVal < 0) {
            alert("Please enter a valid Low Stock Threshold.");
            return;
        }

        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
        saveBtn.disabled = true;

        try {
            await setDoc(doc(db, "settings", SETTINGS_DOC_ID), {
                defaultLowStockThreshold: thresholdVal,
                updatedAt: new Date(),
                updatedBy: auth.currentUser.uid
            }, { merge: true });

            alert("Settings saved successfully!");
        } catch (error) {
            console.error("Error saving settings:", error);
            alert("Error: " + error.message);
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    });
}
