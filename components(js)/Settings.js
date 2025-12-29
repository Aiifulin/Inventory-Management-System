import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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

// --- AUTH LISTENER & SECURITY CHECK ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Check if CURRENT user is Admin
        const isAdmin = await checkAdminAccess(user.uid);
        
        if (!isAdmin) {
            alert("Access Denied: You do not have permission to view Settings.");
            window.location.href = "Dashboard.html";
            return;
        }

        // 2. Fetch fresh user data from Firestore to get the name
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        
        // Merge Auth user with Firestore data for display
        const fullUser = {
            ...user,
            displayName: userData.name || user.displayName || "Admin User",
            role: userData.role || "User"
        };

        // 3. Update UI
        displayUserRole(fullUser);
        populateAdminInfo(fullUser);
        loadSettings();
        loadUserTable(); 
        
        // 4. Initialize Dark Mode
        initDarkMode();

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

// --- HELPER: DISPLAY USER ROLE (Sidebar) ---
function displayUserRole(user) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;

    let roleName = user.role || "User";
    // Capitalize first letter
    roleName = roleName.charAt(0).toUpperCase() + roleName.slice(1);
    roleEl.textContent = roleName;
}

// --- SECURITY CHECK FUNCTION ---
async function checkAdminAccess(uid) {
    try {
        const userDoc = await getDoc(doc(db, "users", uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            // Check if role is admin
            return userData.role === 'admin';
        }
        // Fallback for hardcoded Admin ID (Legacy support)
        const HARDCODED_ADMIN_ID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2";
        if (uid === HARDCODED_ADMIN_ID) return true;

        return false;
    } catch (e) {
        console.error("Error checking admin:", e);
        return false;
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

// --- LOGOUT ---
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