import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


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

function setSettingsLoading(loading) {
    const skeleton = document.getElementById('settingsSkeleton');
    const content  = document.getElementById('settingsContent');
    if (skeleton) skeleton.style.display = loading ? 'flex' : 'none';
    if (content)  content.style.display  = loading ? 'none' : 'flex';
}

// ================================================
// AUTH — parallel: user data + settings + users table fire at the same time
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    const main = document.getElementById('mainContent');
    main.style.visibility = 'visible';

    // Logout modal setup (needed regardless of role)
    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };

    // 🔥 Fire user data AND settings/users loads simultaneously
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        // Pre-load settings and users in background — access check below
        loadSettings(),
        loadUserTable()
    ]);

    const nameEl  = document.getElementById('userNameDisplay');
    if (nameEl) nameEl.textContent = userData?.name || "User";

    const isAdmin = userData?.role?.toLowerCase() === 'admin';

    if (!isAdmin) {
        main.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:center; 
                        justify-content:center; height:60vh; text-align:center; 
                        color:var(--text-secondary);">
                <i class="fas fa-lock" style="font-size:48px; margin-bottom:16px;"></i>
                <h2 style="margin:0 0 8px; color:var(--text-main); font-size:20px;">Access Denied</h2>
                <p style="margin:0; font-size:14px;">You do not have permission to view Settings.</p>
            </div>`;
        return;
    }

    // Admin-only setup
    const fullUser = {
        ...user,
        displayName: userData?.name || user.displayName || "Admin User",
        role:        userData?.role || "User"
    };

    populateAdminInfo(fullUser);
    setSettingsLoading(false);
    initDarkMode();
    initAutoBackup();
    await loadAutoBackupSettings();
});

function showSuccessModal(title, message) {
    const overlay = document.getElementById("successModalOverlay");
    const titleEl = document.getElementById("successTitle");
    const msgEl   = document.getElementById("successMessage");
    const okBtn   = document.getElementById("successOkBtn");

    titleEl.textContent = title;
    msgEl.textContent   = message;
    overlay.style.display = "flex";
    okBtn.onclick = () => { overlay.style.display = "none"; };
}

// --- DARK MODE ---
function initDarkMode() {
    const toggle       = document.getElementById('darkModeToggle');
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark' && toggle) toggle.checked = true;

    toggle?.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.setAttribute('data-theme', 'light');
            localStorage.setItem('theme', 'light');
        }
    });
}

// --- LOAD USERS TABLE ---
async function loadUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No users found.</td></tr>';
            return;
        }

        let html = '';
        querySnapshot.forEach((docSnap) => {
            const u      = docSnap.data();
            const userId = docSnap.id;
            const isSelf = (userId === auth.currentUser?.uid);

            const adminSelected = u.role === 'admin' ? 'selected' : '';
            const userSelected  = u.role === 'user'  ? 'selected' : '';
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
                            <option value="user"  ${userSelected}>User</option>
                            <option value="admin" ${adminSelected}>Admin</option>
                        </select>
                    </td>
                    <td style="text-align: right;">
                        ${!isSelf
                            ? `<button class="btn-update" onclick="updateUserRole('${userId}')">Update</button>`
                            : '<span style="font-size:12px; color: var(--text-secondary); font-style:italic;">Locked</span>'}
                    </td>
                </tr>`;
        });
        tbody.innerHTML = html;
    } catch (error) {
        console.error("Error loading users:", error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Error loading users.</td></tr>';
    }
}

window.updateUserRole = async function(userId) {
    const selectEl = document.getElementById(`role-${userId}`);
    const newRole  = selectEl.value;
    const btn      = selectEl.parentElement.nextElementSibling.querySelector('button');
    try {
        btn.textContent = "...";
        btn.disabled    = true;
        await updateDoc(doc(db, "users", userId), { role: newRole });
        showSuccessModal("Role Updated", "User role updated successfully!");
    } catch (error) {
        console.error("Error updating role:", error);
        showSuccessModal("Error", "An error occurred while updating the user role.");
    } finally {
        btn.textContent = "Update";
        btn.disabled    = false;
    }
};

function populateAdminInfo(user) {
    const nameEl  = document.getElementById('adminNameDisplay');
    const emailEl = document.getElementById('adminEmailDisplay');
    const idEl    = document.getElementById('adminIdDisplay');
    if (nameEl)  nameEl.textContent  = user.displayName;
    if (emailEl) emailEl.textContent = user.email;
    if (idEl)    idEl.textContent    = user.uid;
}

// --- LOAD SETTINGS ---
async function loadSettings() {
    try {
        const docSnap = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
        const thresholdEl = document.getElementById('defaultThreshold');
        if (thresholdEl) {
            thresholdEl.value = docSnap.exists() && docSnap.data().defaultLowStockThreshold
                ? docSnap.data().defaultLowStockThreshold
                : 10;
        }
    } catch (error) {
        console.error("Error loading settings:", error);
    }
}

// --- SAVE SETTINGS ---
const saveBtn = document.getElementById('saveSettingsBtn');
if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
        const thresholdVal       = parseInt(document.getElementById('defaultThreshold').value);
        const autoBackupEnabled  = document.getElementById('autoBackupToggle').checked;
        const backupIntervalDays = parseInt(document.getElementById('backupInterval').value);

        if (isNaN(thresholdVal) || thresholdVal < 0) {
            showSuccessModal("Invalid Input", "Please enter a valid Low Stock Threshold.");
            return;
        }

        const originalText    = saveBtn.innerHTML;
        saveBtn.innerHTML     = `<i class="fas fa-spinner fa-spin"></i> Saving...`;
        saveBtn.disabled      = true;

        try {
            const settingsData = {
                defaultLowStockThreshold: thresholdVal,
                autoBackupEnabled,
                backupIntervalDays,
                updatedAt: new Date(),
                updatedBy: auth.currentUser.uid
            };

            if (autoBackupEnabled) {
                const docSnap = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
                if (!docSnap.exists() || !docSnap.data().lastBackupDate) {
                    settingsData.lastBackupDate = new Date();
                }
            }

            await setDoc(doc(db, "settings", SETTINGS_DOC_ID), settingsData, { merge: true });
            showSuccessModal("Settings Saved", "Your settings have been updated successfully.");
            await loadAutoBackupSettings();
        } catch (error) {
            console.error("Error saving settings:", error);
            showSuccessModal("Error", "An error occurred while saving settings.");
        } finally {
            saveBtn.innerHTML = originalText;
            saveBtn.disabled  = false;
        }
    });
}

// --- AUTO BACKUP LOGIC ---
function initAutoBackup() {
    const toggle            = document.getElementById('autoBackupToggle');
    const intervalContainer = document.getElementById('backupIntervalContainer');

    toggle?.addEventListener('change', (e) => {
        intervalContainer.style.display = e.target.checked ? 'block' : 'none';
    });
}

async function loadAutoBackupSettings() {
    try {
        const docSnap = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
        if (!docSnap.exists()) return;

        const data              = docSnap.data();
        const toggle            = document.getElementById('autoBackupToggle');
        const intervalSelect    = document.getElementById('backupInterval');
        const intervalContainer = document.getElementById('backupIntervalContainer');
        const lastBackupSpan    = document.getElementById('lastBackupDate');

        if (data.autoBackupEnabled && toggle) {
            toggle.checked = true;
            if (intervalContainer) intervalContainer.style.display = 'block';
        }
        if (data.backupIntervalDays && intervalSelect) intervalSelect.value = data.backupIntervalDays;

        if (lastBackupSpan) {
            lastBackupSpan.textContent = data.lastBackupDate
                ? data.lastBackupDate.toDate().toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : "Never";
        }

        if (data.autoBackupEnabled && data.lastBackupDate) {
            checkAndRunBackup(data.backupIntervalDays, data.lastBackupDate.toDate());
        }
    } catch (error) {
        console.error("Error loading auto backup settings:", error);
    }
}

async function checkAndRunBackup(intervalDays, lastBackupDate) {
    const daysSinceBackup = Math.floor((new Date() - lastBackupDate) / (1000 * 60 * 60 * 24));
    if (daysSinceBackup >= intervalDays) await performAutoBackup();
}

async function performAutoBackup() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.archived !== true) products.push({ id: docSnap.id, ...data });
        });
        if (products.length === 0) return;

        const dataToExport = products.map(p => {
            const firstVariation = p.variations?.[0] || {};
            const firstAttribute = p.attributes?.[0]  || {};
            return {
                "Product Name":        p.name || "",
                "Description":         p.description || "",
                "Category":            p.category || "",
                "Price":               Number(p.price) || 0,
                "Stock":               Number(p.stock) || 0,
                "Low Stock Threshold": Number(p.lowStockThreshold) || 10,
                "Size":                firstVariation.size   || "",
                "Color":               firstVariation.color  || "",
                "Custom Variation":    firstVariation.custom || "",
                "Attribute Name":      firstAttribute.name   || "",
                "Attribute Value":     firstAttribute.value  || ""
            };
        });

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook  = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Products");
        XLSX.writeFile(workbook, `Auto_Backup_${new Date().toISOString().split('T')[0]}.xlsx`);

        await setDoc(doc(db, "settings", SETTINGS_DOC_ID), { lastBackupDate: new Date() }, { merge: true });
        await loadAutoBackupSettings();
    } catch (error) {
        console.error("Auto backup failed:", error);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const manualBtn = document.getElementById('manualBackupBtn');
    if (manualBtn) {
        manualBtn.addEventListener('click', async () => {
            const originalContent = manualBtn.innerHTML;
            manualBtn.innerHTML   = `<i class="fas fa-spinner fa-spin"></i> Generating...`;
            manualBtn.disabled    = true;
            try {
                await performAutoBackup();
                showSuccessModal("Backup Generated", "Your backup has been downloaded successfully.");
            } catch (error) {
                console.error("Manual backup failed:", error);
                alert("Failed to generate backup. Check the console.");
            } finally {
                manualBtn.innerHTML = originalContent;
                manualBtn.disabled  = false;
            }
        });
    }
});