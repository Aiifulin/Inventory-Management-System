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

        // Shared logout setup for both admin and non-admin users
        const doSignOut = () => {
            localStorage.removeItem("user_session"); localStorage.removeItem("user_uid"); localStorage.removeItem("user_role");
            sessionStorage.clear();
            signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
        };
        const openLogoutModal = initLogoutModal(doSignOut);
        window.logout = function () { if (openLogoutModal) openLogoutModal(); };

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

        initAutoBackup();
        await loadAutoBackupSettings();

        main.style.visibility = 'visible';
        //startTestAutoBackup(); for testing auto backup every 1 minute

    } else {
        window.location.href = "index.html";
    }
});

function showSuccessModal(title, message) {
    const overlay = document.getElementById("successModalOverlay");
    const titleEl = document.getElementById("successTitle");
    const msgEl = document.getElementById("successMessage");
    const okBtn = document.getElementById("successOkBtn");

    titleEl.textContent = title;
    msgEl.textContent = message;

    overlay.style.display = "flex";

    okBtn.onclick = () => {
        overlay.style.display = "none";
    };
}

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

        showSuccessModal("Role Updated", "User role updated successfully!");
    } catch (error) {
        console.error("Error updating role:", error);
        showSuccessModal("Failed to update role.", "An error occurred while updating the user role.");
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

// --- SAVE SETTINGS (UPDATED) ---
const saveBtn = document.getElementById('saveSettingsBtn');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const thresholdVal = parseInt(document.getElementById('defaultThreshold').value);
        const autoBackupEnabled = document.getElementById('autoBackupToggle').checked;
        const backupIntervalDays = parseInt(document.getElementById('backupInterval').value);

        if (isNaN(thresholdVal) || thresholdVal < 0) {
            showSuccessModal("Invalid Input", "Please enter a valid Low Stock Threshold.");
            return;
        }

        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
        saveBtn.disabled = true;

        try {
            const settingsData = {
                defaultLowStockThreshold: thresholdVal,
                autoBackupEnabled: autoBackupEnabled,
                backupIntervalDays: backupIntervalDays,
                updatedAt: new Date(),
                updatedBy: auth.currentUser.uid
            };

            // If auto backup was just enabled, set initial lastBackupDate
            if (autoBackupEnabled) {
                const docRef = doc(db, "settings", SETTINGS_DOC_ID);
                const docSnap = await getDoc(docRef);
                
                if (!docSnap.exists() || !docSnap.data().lastBackupDate) {
                    settingsData.lastBackupDate = new Date();
                }
            }

            await setDoc(doc(db, "settings", SETTINGS_DOC_ID), settingsData, { merge: true });

            showSuccessModal("Settings Saved", "Your settings have been updated successfully.");
            
            // Reload settings to update UI
            await loadAutoBackupSettings();

        } catch (error) {
            console.error("Error saving settings:", error);
            showSuccessModal("Error", "An error occurred while saving settings.");
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled = false;
        }
    });
}
// --- AUTO BACKUP LOGIC ---
function initAutoBackup() {
    const toggle = document.getElementById('autoBackupToggle');
    const intervalContainer = document.getElementById('backupIntervalContainer');
    const intervalSelect = document.getElementById('backupInterval');

    // Show/hide interval selector
    if (toggle) {
        toggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                intervalContainer.style.display = 'block';
            } else {
                intervalContainer.style.display = 'none';
            }
        });
    }
}

// --- LOAD AUTO BACKUP SETTINGS ---
async function loadAutoBackupSettings() {
    try {
        const docRef = doc(db, "settings", SETTINGS_DOC_ID);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            
            // Load auto backup toggle
            const toggle = document.getElementById('autoBackupToggle');
            const intervalSelect = document.getElementById('backupInterval');
            const intervalContainer = document.getElementById('backupIntervalContainer');
            const lastBackupSpan = document.getElementById('lastBackupDate');

            if (data.autoBackupEnabled) {
                toggle.checked = true;
                intervalContainer.style.display = 'block';
            }

            if (data.backupIntervalDays) {
                intervalSelect.value = data.backupIntervalDays;
            }

            // Display last backup date
            if (data.lastBackupDate) {
                const lastDate = data.lastBackupDate.toDate();
                lastBackupSpan.textContent = lastDate.toLocaleDateString("en-US", { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            } else {
                lastBackupSpan.textContent = "Never";
            }

            // Check if backup is due
            if (data.autoBackupEnabled && data.lastBackupDate) {
                checkAndRunBackup(data.backupIntervalDays, data.lastBackupDate.toDate());
            }
        }
    } catch (error) {
        console.error("Error loading auto backup settings:", error);
    }
}

// --- CHECK AND RUN BACKUP IF DUE ---
async function checkAndRunBackup(intervalDays, lastBackupDate) {
    const now = new Date();
    const daysSinceBackup = Math.floor((now - lastBackupDate) / (1000 * 60 * 60 * 24));

    if (daysSinceBackup >= intervalDays) {
        console.log(`Auto backup is due (${daysSinceBackup} days since last backup)`);
        await performAutoBackup();
    } else {
        console.log(`Next backup in ${intervalDays - daysSinceBackup} days`);
    }
}

// --- PERFORM AUTO BACKUP ---
async function performAutoBackup() {
    try {
        // Fetch all products
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.archived !== true) {
                products.push({ id: docSnap.id, ...data });
            }
        });

        if (products.length === 0) {
            console.log("No products to backup");
            return;
        }

        // Map products to export format
        const dataToExport = products.map(p => {
            const firstVariation = p.variations && p.variations[0] ? p.variations[0] : {};
            const firstAttribute = p.attributes && p.attributes[0] ? p.attributes[0] : {};

            return {
                "Product Name": p.name || "",
                "Description": p.description || "",
                "Category": p.category || "",
                "Price": Number(p.price) || 0,
                "Stock": Number(p.stock) || 0,
                "Low Stock Threshold": Number(p.lowStockThreshold) || 10,
                "Size": firstVariation.size || "",
                "Color": firstVariation.color || "",
                "Custom Variation": firstVariation.custom || "",
                "Attribute Name": firstAttribute.name || "",
                "Attribute Value": firstAttribute.value || ""
            };
        });

        // Create Excel file
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

        // Download file
        const fileName = `Auto_Backup_${new Date().toISOString().split('T')[0]}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        // Update last backup timestamp
        await setDoc(doc(db, "settings", SETTINGS_DOC_ID), {
            lastBackupDate: new Date()
        }, { merge: true });

        console.log("Auto backup completed successfully");
        
        // Reload settings to update UI
        await loadAutoBackupSettings();

    } catch (error) {
        console.error("Auto backup failed:", error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const manualBtn = document.getElementById('manualBackupBtn');
    
    if (manualBtn) {
        manualBtn.addEventListener('click', async () => {
            // Visual feedback
            const originalContent = manualBtn.innerHTML;
            manualBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> Generating...`;
            manualBtn.disabled = true;

            try {
                // Call the function you already wrote
                await performAutoBackup(); 
                showSuccessModal("Backup Generated", "Your backup has been downloaded successfully.");
            } catch (error) {
                console.error("Manual backup failed:", error);
                alert("Failed to generate backup. Check the console.");
            } finally {
                // Restore button state
                manualBtn.innerHTML = originalContent;
                manualBtn.disabled = false;
            }
        });
    }
});


//TEST FOR AUTO BAK

function startTestAutoBackup() {
    console.log(" TEST MODE: Auto backup every 1 minute started");

    setInterval(async () => {
        console.log("⏱ Running test auto backup...");
        await performAutoBackup();
        showSuccessModal("Auto Backup", "Test auto backup executed.");
    }, 60000); // 60,000 ms = 1 minute
}