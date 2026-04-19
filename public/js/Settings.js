import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


const SETTINGS_DOC_ID = "global_config";

// ================================================
// PENDING USER CHANGES
// Map<userId, { originalRole, pendingRole, name, email }>
// Nothing hits Firestore until Save Changes is clicked.
// ================================================
const pendingUserChanges = new Map();

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
// AUTH
// ================================================
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    const main = document.getElementById('mainContent');
    main.style.visibility = 'visible';

    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };

    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        loadSettings(),
        loadUserTable()
    ]);

    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) nameEl.textContent = userData?.name || "User";

    const isAdmin = userData?.role?.toLowerCase() === 'admin';

    if (!isAdmin) {
        main.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;
                        justify-content:center;height:60vh;text-align:center;
                        color:var(--text-secondary);">
                <i class="fas fa-lock" style="font-size:48px;margin-bottom:16px;"></i>
                <h2 style="margin:0 0 8px;color:var(--text-main);font-size:20px;">Access Denied</h2>
                <p style="margin:0;font-size:14px;">You do not have permission to view Settings.</p>
            </div>`;
        return;
    }

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
    initUserDrawer();
});

// ================================================
// SUCCESS / CONFIRM MODALS
// ================================================
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

// ================================================
// DARK MODE
// ================================================
function initDarkMode() {
    const toggle       = document.getElementById('darkModeToggle');
    const currentTheme = localStorage.getItem('theme');
    if (currentTheme === 'dark' && toggle) toggle.checked = true;

    toggle?.addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    });
}

// ================================================
// LOAD USERS TABLE  (read-only display)
// ================================================
async function loadUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No users found.</td></tr>';
            return;
        }

        // Cache all users for the drawer
        window._allUsersCache = {};
        querySnapshot.forEach((docSnap) => {
            window._allUsersCache[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
        });

        renderUserTable();
    } catch (error) {
        console.error("Error loading users:", error);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:red;">Error loading users.</td></tr>';
    }
}

function renderUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody || !window._allUsersCache) return;

    const users = Object.values(window._allUsersCache);
    let html = '';

    users.forEach((u) => {
        const userId = u.id;
        const isSelf = userId === auth.currentUser?.uid;

        // Use pending role if one exists, otherwise use saved role
        const pending     = pendingUserChanges.get(userId);
        const displayRole = pending ? pending.pendingRole : (u.role || 'user');
        const hasPending  = !!pending;

        const badgeClass  = displayRole === 'admin' ? 'admin' : 'user';
        const badgeIcon   = displayRole === 'admin' ? 'fa-crown' : 'fa-user';
        const badgeLabel  = displayRole === 'admin' ? 'Admin' : 'User';

        html += `
            <tr data-user-id="${userId}">
                <td>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                        <span class="user-name">
                            ${u.name || 'No Name'}
                            ${isSelf ? '<span class="user-self-tag">YOU</span>' : ''}
                            ${hasPending ? '<span class="pending-dot" title="Unsaved change"></span>' : ''}
                        </span>
                        <span class="user-role-badge ${badgeClass}" style="display:none;" aria-hidden="true">
                            <i class="fas ${badgeIcon}"></i> ${badgeLabel}
                        </span>
                    </div>
                </td>
                <td style="color:var(--text-secondary);">${u.email}</td>
                <td>
                    <span class="user-role-badge ${badgeClass}">
                        <i class="fas ${badgeIcon}"></i> ${badgeLabel}
                    </span>
                </td>
                <td style="text-align:right;">
                    ${!isSelf
                        ? `<button class="btn-edit-user" data-user-id="${userId}">
                               <i class="fas fa-pen"></i> Edit
                           </button>`
                        : '<span style="font-size:12px;color:var(--text-secondary);font-style:italic;">Locked</span>'}
                </td>
            </tr>`;
    });

    tbody.innerHTML = html;
}

// ================================================
// USER DRAWER
// ================================================
function initUserDrawer() {
    // Event delegation on table — catches dynamically rendered edit buttons
    document.querySelector('#usersTable tbody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-edit-user');
        if (!btn) return;
        const userId = btn.dataset.userId;
        openUserDrawer(userId);
    });

    // Close via overlay click
    document.getElementById('drawerOverlay')?.addEventListener('click', closeUserDrawer);
    // Close via X button
    document.getElementById('drawerCloseBtn')?.addEventListener('click', closeUserDrawer);
    // Cancel button
    document.getElementById('drawerCancelBtn')?.addEventListener('click', closeUserDrawer);

    // Apply button — stages the change locally, updates table display
    document.getElementById('drawerApplyBtn')?.addEventListener('click', () => {
        const userId      = document.getElementById('userDrawer').dataset.userId;
        const newRole     = document.getElementById('drawerRoleSelect').value;
        const u           = window._allUsersCache[userId];
        const originalRole = u.role || 'user';

        if (newRole === originalRole) {
            // If back to original, remove any pending entry
            pendingUserChanges.delete(userId);
        } else {
            pendingUserChanges.set(userId, {
                originalRole,
                pendingRole: newRole,
                name:  u.name,
                email: u.email
            });
        }

        renderUserTable();
        updateSaveBtnLabel();
        closeUserDrawer();
    });

    // Role select change → update pending note visibility inside drawer
    document.getElementById('drawerRoleSelect')?.addEventListener('change', () => {
        refreshDrawerPendingNote();
    });
}

function openUserDrawer(userId) {
    const u = window._allUsersCache[userId];
    if (!u) return;

    const drawer  = document.getElementById('userDrawer');
    const overlay = document.getElementById('drawerOverlay');

    // Populate hero section
    document.getElementById('drawerUserName').textContent  = u.name  || 'No Name';
    document.getElementById('drawerUserEmail').textContent = u.email || '—';
    document.getElementById('drawerUserId').textContent    = userId;

    // Role select: prefer any already-staged pending value
    const pending   = pendingUserChanges.get(userId);
    const roleSelect = document.getElementById('drawerRoleSelect');
    roleSelect.value = pending ? pending.pendingRole : (u.role || 'user');

    // Store which user is open
    drawer.dataset.userId = userId;

    refreshDrawerPendingNote();

    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeUserDrawer() {
    document.getElementById('userDrawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
}

function refreshDrawerPendingNote() {
    const userId   = document.getElementById('userDrawer')?.dataset.userId;
    const u        = window._allUsersCache?.[userId];
    if (!u) return;

    const selected     = document.getElementById('drawerRoleSelect').value;
    const originalRole = u.role || 'user';
    const noteEl       = document.getElementById('drawerPendingNote');

    if (selected !== originalRole) {
        noteEl.classList.add('visible');
    } else {
        noteEl.classList.remove('visible');
    }
}

// Update the Save Changes button to show pending count
function updateSaveBtnLabel() {
    const saveBtn  = document.getElementById('saveSettingsBtn');
    const btnText  = saveBtn?.querySelector('.btn-text');
    if (!btnText) return;

    const count = pendingUserChanges.size;
    if (count > 0) {
        btnText.textContent = `Save Changes (${count} role${count > 1 ? 's' : ''} pending)`;
    } else {
        btnText.textContent = 'Save Changes';
    }
}

// ================================================
// ADMIN PROFILE
// ================================================
function populateAdminInfo(user) {
    const nameEl  = document.getElementById('adminNameDisplay');
    const emailEl = document.getElementById('adminEmailDisplay');
    const idEl    = document.getElementById('adminIdDisplay');
    if (nameEl)  nameEl.textContent  = user.displayName;
    if (emailEl) emailEl.textContent = user.email;
    if (idEl)    idEl.textContent    = user.uid;
}

// ================================================
// LOAD SETTINGS
// ================================================
async function loadSettings() {
    try {
        const docSnap     = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
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

// ================================================
// SAVE SETTINGS — commits inventory settings + ALL pending user role changes
// ================================================
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

        const originalContent = saveBtn.innerHTML;
        saveBtn.innerHTML     = `<i class="fas fa-spinner fa-spin"></i> <span class="btn-text">Saving...</span>`;
        saveBtn.disabled      = true;

        try {
            // 1. Save inventory settings
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

            // 2. Commit all pending user role changes
            if (pendingUserChanges.size > 0) {
                const updates = [...pendingUserChanges.entries()].map(([userId, change]) =>
                    updateDoc(doc(db, "users", userId), { role: change.pendingRole })
                );
                await Promise.all(updates);

                // Sync local cache & clear pending
                pendingUserChanges.forEach((change, userId) => {
                    if (window._allUsersCache[userId]) {
                        window._allUsersCache[userId].role = change.pendingRole;
                    }
                });
                pendingUserChanges.clear();
                renderUserTable();
            }

            updateSaveBtnLabel();
            showSuccessModal("Settings Saved", "Your settings and any role changes have been saved successfully.");
            await loadAutoBackupSettings();
        } catch (error) {
            console.error("Error saving settings:", error);
            showSuccessModal("Error", "An error occurred while saving. Please try again.");
        } finally {
            saveBtn.innerHTML = originalContent;
            saveBtn.disabled  = false;
        }
    });
}

// ================================================
// AUTO BACKUP
// ================================================
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
                ? data.lastBackupDate.toDate().toLocaleDateString("en-US", { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
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
                "Product Name":        p.name        || "",
                "Description":         p.description || "",
                "Category":            p.category    || "",
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

export { getCachedUserData, checkAndRunBackup };