// ==========================================
// 1. IMPORTS (Standard NPM)
// ==========================================
import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, doc, getDoc, setDoc, updateDoc, 
    collection, getDocs 
} from "firebase/firestore";

// ==========================================
// 2. CONFIGURATION
// ==========================================
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
} catch (e) {
    // Suppress errors if running in a test environment
}

const SETTINGS_DOC_ID = "global_config"; 

// ==========================================
// 3. EXPORTED LOGIC (Tested Functions)
// ==========================================

export async function checkAdminAccess(uid, dbInstance = db) {
    try {
        const userDoc = await getDoc(doc(dbInstance, "users", uid));
        if (userDoc.exists()) {
            const userData = userDoc.data();
            return userData.role === 'admin';
        }
        // Fallback for Legacy Admin
        const HARDCODED_ADMIN_ID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2";
        if (uid === HARDCODED_ADMIN_ID) return true;

        return false;
    } catch (e) {
        console.error("Error checking admin:", e);
        return false;
    }
}

export async function updateUserRoleLogic(userId, newRole, dbInstance = db) {
    if (!userId || !newRole) throw new Error("Invalid parameters");
    await updateDoc(doc(dbInstance, "users", userId), { role: newRole });
    return true;
}

export async function saveSettingsLogic(thresholdVal, currentUserUid, dbInstance = db) {
    if (isNaN(thresholdVal) || thresholdVal < 0) {
        throw new Error("Please enter a valid Low Stock Threshold.");
    }

    await setDoc(doc(dbInstance, "settings", SETTINGS_DOC_ID), {
        defaultLowStockThreshold: thresholdVal,
        updatedAt: new Date(),
        updatedBy: currentUserUid
    }, { merge: true });

    return true;
}

export async function loadUsersLogic(dbInstance = db) {
    const querySnapshot = await getDocs(collection(dbInstance, "users"));
    const users = [];
    querySnapshot.forEach((doc) => {
        users.push({ id: doc.id, ...doc.data() });
    });
    return users;
}

// ==========================================
// 4. BROWSER ONLY LOGIC
// ==========================================
if (typeof window !== 'undefined') {

    // --- Auth Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            displayUserRole(user.uid);

            const isAdmin = await checkAdminAccess(user.uid, db);
            if (!isAdmin) {
                alert("Access Denied: You do not have permission to view Settings.");
                window.location.href = "Dashboard.html";
                return;
            }

            populateAdminInfo(user);
            loadSettings();
            loadUserTable(); 

        } else {
            window.location.href = "Login.html";
        }
    });

    // --- UI Helpers ---

    async function displayUserRole(uid) {
        const roleEl = document.getElementById('userRoleDisplay');
        if (!roleEl) return;
        try {
            const userDoc = await getDoc(doc(db, "users", uid));
            if (userDoc.exists()) {
                let roleName = userDoc.data().role || "User";
                roleEl.textContent = roleName.charAt(0).toUpperCase() + roleName.slice(1);
            } else {
                roleEl.textContent = "User";
            }
        } catch (error) { roleEl.textContent = "User"; }
    }

    function populateAdminInfo(user) {
        const nameEl = document.getElementById('adminNameDisplay');
        const emailEl = document.getElementById('adminEmailDisplay');
        const idEl = document.getElementById('adminIdDisplay');

        if(nameEl) nameEl.textContent = user.displayName || "Admin User";
        if(emailEl) emailEl.textContent = user.email;
        if(idEl) idEl.textContent = user.uid;
    }

    async function loadSettings() {
        try {
            const docSnap = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
            const input = document.getElementById('defaultThreshold');
            if (input) {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    input.value = data.defaultLowStockThreshold || 10;
                } else {
                    input.value = 10;
                }
            }
        } catch (error) { console.error("Error loading settings:", error); }
    }

    async function loadUserTable() {
        const tbody = document.querySelector('#usersTable tbody');
        if(!tbody) return;

        try {
            const users = await loadUsersLogic(db);
            
            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No users found.</td></tr>';
                return;
            }

            let html = '';
            users.forEach(u => {
                const isSelf = (u.id === auth.currentUser.uid);
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
                        <td style="color:#4b5563;">${u.email}</td>
                        <td>
                            <select class="role-select" id="role-${u.id}" ${disabledState}>
                                <option value="user" ${userSelected}>User</option>
                                <option value="admin" ${adminSelected}>Admin</option>
                            </select>
                        </td>
                        <td style="text-align: right;">
                            ${!isSelf ? `<button class="btn-update" onclick="updateUserRole('${u.id}')">Update</button>` : '<span style="font-size:12px; color:#9ca3af; font-style:italic;">Locked</span>'}
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

    // --- Action Handlers ---

    window.updateUserRole = async function(userId) {
        const selectEl = document.getElementById(`role-${userId}`);
        const newRole = selectEl.value;
        const btn = selectEl.parentElement.nextElementSibling.querySelector('button');

        try {
            btn.textContent = "...";
            btn.disabled = true;
            await updateUserRoleLogic(userId, newRole, db);
            alert("User role updated successfully!");
        } catch (error) {
            console.error("Error updating role:", error);
            alert("Failed to update role.");
        } finally {
            btn.textContent = "Update";
            btn.disabled = false;
        }
    };

    const saveBtn = document.getElementById('saveSettingsBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
            const thresholdVal = parseInt(document.getElementById('defaultThreshold').value);
            const originalText = saveBtn.innerHTML;
            
            saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
            saveBtn.disabled = true;

            try {
                await saveSettingsLogic(thresholdVal, auth.currentUser.uid, db);
                alert("Settings saved successfully!");
            } catch (error) {
                alert("Error: " + error.message);
            } finally {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        });
    }

    window.logout = function() {
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("Login.html"));
    };
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}