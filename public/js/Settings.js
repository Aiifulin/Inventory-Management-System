// ============================================================
// Settings.js
// Handles all logic for the Settings page: loading and saving
// global inventory settings, managing user roles via a slide-in
// drawer with a pending-changes pattern, dark mode toggling,
// and automatic/manual product data backups.
// Only accessible to admin users — non-admins see an
// "Access Denied" message instead of the settings content.
// ============================================================

import { doc, getDoc, setDoc, updateDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { initLogoutModal } from "./logout-modal.js";
import { db, auth, storage } from "./firebase.js";


// ============================================================
// GLOBALS
// SETTINGS_DOC_ID    — Firestore document ID for the single
//   global settings document under the "settings" collection.
// pendingUserChanges — a Map that stages role edits locally
//   before the admin clicks "Save Changes". Nothing is written
//   to Firestore until that final commit. This prevents partial
//   saves if the user closes the drawer mid-edit.
//   Shape: Map<userId, { originalRole, pendingRole, name, email }>
// ============================================================
const SETTINGS_DOC_ID = "global_config";

const pendingUserChanges = new Map();


// ============================================================
// SECTION 1 — USER DATA & LOADING STATE
// Shared helpers used across multiple sections below.
// ============================================================

/**
 * Fetches the current user's Firestore document (name, role, etc.).
 * Caches the result per-UID in sessionStorage so repeat page visits
 * don't cost an extra Firestore read.
 *
 * @param {string} uid — Firebase Auth UID
 * @returns {Object|null} — user data object, or null on failure
 */
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

/**
 * Toggles between the skeleton loading placeholder and the real
 * settings content area. Called once all async setup is complete.
 *
 * @param {boolean} loading — true to show skeleton, false to show content
 */
function setSettingsLoading(loading) {
    const skeleton = document.getElementById('settingsSkeleton');
    const content  = document.getElementById('settingsContent');
    if (skeleton) skeleton.style.display = loading ? 'flex' : 'none';
    if (content)  content.style.display  = loading ? 'none' : 'flex';
}


// ============================================================
// SECTION 2 — AUTH & ACCESS CONTROL
// Checks authentication on page load. Non-admin users see an
// access-denied message. Admin users get the full settings UI.
// All async setup (settings, user table, backup config) is fired
// in parallel via Promise.all to minimise total load time.
// ============================================================

/**
 * Firebase Auth state listener — runs once on page load.
 * Redirects unauthenticated users to the login page.
 * For authenticated users, fetches user data, global settings,
 * and the user table in parallel.
 * Non-admins receive an access-denied placeholder; admins
 * proceed to the full settings panel and additional setup calls.
 * Also wires up the sidebar name badge and logout modal.
 */
onAuthStateChanged(auth, async (user) => {
    if (!user) { window.location.href = "index.html"; return; }

    const main = document.getElementById('mainContent');
    main.style.visibility = 'visible';

    // Wire up the logout modal early so it works regardless of role.
    const doSignOut = () => {
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("index.html")).catch(() => window.location.replace("index.html"));
    };
    const openLogoutModal = initLogoutModal(doSignOut);
    window.logout = function () { if (openLogoutModal) openLogoutModal(); };

    // Fire all three async operations in parallel.
    const [userData] = await Promise.all([
        getCachedUserData(user.uid),
        loadSettings(),
        loadUserTable()
    ]);

    // Update the sidebar name badge.
    const nameEl = document.getElementById('userNameDisplay');
    if (nameEl) {
        const name = userData?.name || "User";
        const role = userData?.role || "user";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        nameEl.innerHTML = `${name} <span style="font-size:11px; color: #FFA500; font-weight:600; opacity:0.7;">(${roleLabel})</span>`;
    }

    const isAdmin = userData?.role?.toLowerCase() === 'admin';

    // Replace main content with an access-denied message for non-admins.
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

    // Merge Firestore user data with the Firebase Auth user object
    // so populateAdminInfo() has a consistent shape to read from.
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


// ============================================================
// SECTION 3 — MODALS
// Reusable overlay modal for success messages and confirmations.
// ============================================================

/**
 * Opens the success modal overlay with a custom title and message.
 * The OK button simply closes the overlay.
 *
 * @param {string} title   — modal heading text
 * @param {string} message — modal body text
 */
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


// ============================================================
// SECTION 4 — DARK MODE
// Reads the persisted theme from localStorage on init and wires
// up the toggle to apply the theme in real time and save it.
// ============================================================

/**
 * Initialises the dark mode toggle.
 * Reads the saved theme from localStorage and checks the toggle
 * if dark mode was previously enabled. The change event applies
 * the chosen theme to the document root and persists it.
 */
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


// ============================================================
// SECTION 5 — USER TABLE
// Fetches all users from Firestore once and caches them in
// window._allUsersCache. The table is rendered from that cache
// so re-renders (after staging a role change) don't cost extra
// Firestore reads. The logged-in admin's own row is locked
// (cannot edit their own role).
// ============================================================

/**
 * Fetches all users from Firestore, stores them in
 * window._allUsersCache keyed by UID, then calls renderUserTable()
 * to build the HTML.
 * Shows an error row if the Firestore query fails.
 */
async function loadUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody) return;
    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        if (querySnapshot.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No users found.</td></tr>';
            return;
        }

        // Build the in-memory cache used by the drawer and re-renders.
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

/**
 * Re-renders the user table from window._allUsersCache.
 * Called after a role change is staged or cleared so the table
 * reflects the latest pending state without re-fetching Firestore.
 *
 * Pending changes are indicated by an orange dot next to the name.
 * The currently logged-in admin's row shows "Locked" instead of
 * an edit button to prevent self-role modification.
 *
 * Role badge colour and icon are derived from the pending role
 * (if one exists) or the saved Firestore role.
 */
function renderUserTable() {
    const tbody = document.querySelector('#usersTable tbody');
    if (!tbody || !window._allUsersCache) return;

    const users = Object.values(window._allUsersCache);
    let html = '';

    users.forEach((u) => {
        const userId = u.id;
        const isSelf = userId === auth.currentUser?.uid;

        // Prefer the pending (unsaved) role for display if one is staged.
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


// ============================================================
// SECTION 6 — USER DRAWER (ROLE EDITOR)
// A slide-in drawer lets admins change a user's role. Changes
// are staged locally in pendingUserChanges and only written to
// Firestore when "Save Changes" is clicked (see Section 7).
// This prevents partial commits when editing multiple users.
// ============================================================

/**
 * Wires up all event listeners for the user role drawer:
 *   - Table click delegation for the "Edit" buttons
 *   - Overlay click and X button to close the drawer
 *   - Cancel button to close without staging a change
 *   - Apply button to stage the selected role locally
 *   - Role select change to refresh the "pending" note in the drawer
 */
function initUserDrawer() {
    // Event delegation handles Edit buttons added by renderUserTable().
    document.querySelector('#usersTable tbody')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-edit-user');
        if (!btn) return;
        openUserDrawer(btn.dataset.userId);
    });

    document.getElementById('drawerOverlay')?.addEventListener('click', closeUserDrawer);
    document.getElementById('drawerCloseBtn')?.addEventListener('click', closeUserDrawer);
    document.getElementById('drawerCancelBtn')?.addEventListener('click', closeUserDrawer);

    // Apply — stages the selected role in pendingUserChanges and refreshes the table.
    document.getElementById('drawerApplyBtn')?.addEventListener('click', () => {
        const userId       = document.getElementById('userDrawer').dataset.userId;
        const newRole      = document.getElementById('drawerRoleSelect').value;
        const u            = window._allUsersCache[userId];
        const originalRole = u.role || 'user';

        if (newRole === originalRole) {
            // Role was reset to its saved value — remove any pending entry.
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

    // Live update the pending note as the admin changes the select value.
    document.getElementById('drawerRoleSelect')?.addEventListener('change', () => {
        refreshDrawerPendingNote();
    });
}

/**
 * Opens the user drawer for a given user ID.
 * Populates the hero section (name, email, UID) and pre-selects
 * the role dropdown with any already-staged pending value, or
 * falls back to the saved Firestore role.
 *
 * @param {string} userId — Firestore UID of the user to edit
 */
function openUserDrawer(userId) {
    const u = window._allUsersCache[userId];
    if (!u) return;

    const drawer  = document.getElementById('userDrawer');
    const overlay = document.getElementById('drawerOverlay');

    document.getElementById('drawerUserName').textContent  = u.name  || 'No Name';
    document.getElementById('drawerUserEmail').textContent = u.email || '—';
    document.getElementById('drawerUserId').textContent    = userId;

    // Pre-fill with the pending role if one has already been staged.
    const pending    = pendingUserChanges.get(userId);
    const roleSelect = document.getElementById('drawerRoleSelect');
    roleSelect.value = pending ? pending.pendingRole : (u.role || 'user');

    drawer.dataset.userId = userId;

    refreshDrawerPendingNote();

    overlay.classList.add('open');
    drawer.classList.add('open');
    document.body.style.overflow = 'hidden'; // Prevent background scroll while drawer is open.
}

/**
 * Closes the user drawer and re-enables background scrolling.
 */
function closeUserDrawer() {
    document.getElementById('userDrawer')?.classList.remove('open');
    document.getElementById('drawerOverlay')?.classList.remove('open');
    document.body.style.overflow = '';
}

/**
 * Shows or hides the "pending change" note inside the drawer based
 * on whether the currently selected role differs from the saved role.
 * Called on drawer open and whenever the role select changes.
 */
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

/**
 * Updates the "Save Changes" button label to show how many role
 * changes are currently staged. Resets to the default label when
 * the pending map is empty.
 * Called after every Apply or successful save.
 */
function updateSaveBtnLabel() {
    const saveBtn = document.getElementById('saveSettingsBtn');
    const btnText = saveBtn?.querySelector('.btn-text');
    if (!btnText) return;

    const count = pendingUserChanges.size;
    if (count > 0) {
        btnText.textContent = `Save Changes (${count} role${count > 1 ? 's' : ''} pending)`;
    } else {
        btnText.textContent = 'Save Changes';
    }
}


// ============================================================
// SECTION 7 — ADMIN PROFILE DISPLAY
// Populates the read-only admin info card with the logged-in
// admin's name, email, and UID.
// ============================================================

/**
 * Populates the admin info card with the current user's details.
 * Reads from the merged fullUser object built in the Auth listener.
 *
 * @param {Object} user — merged object with displayName, email, and uid
 */
function populateAdminInfo(user) {
    const nameEl  = document.getElementById('adminNameDisplay');
    const emailEl = document.getElementById('adminEmailDisplay');
    const idEl    = document.getElementById('adminIdDisplay');
    if (nameEl)  nameEl.textContent  = user.displayName;
    if (emailEl) emailEl.textContent = user.email;
    if (idEl)    idEl.textContent    = user.uid;
}


// ============================================================
// SECTION 8 — LOAD & SAVE SETTINGS
// loadSettings() reads the global_config document and pre-fills
// the form. The Save button commits both the inventory settings
// and all pending user role changes in a single operation so
// the admin only needs one click.
// ============================================================

/**
 * Reads the global_config Firestore document and pre-fills the
 * default low-stock threshold input. Falls back to 10 if no
 * document exists or the field is missing.
 */
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

/**
 * "Save Changes" click handler.
 *
 * Performs two operations atomically (via Promise.all):
 *   1. Writes inventory settings (threshold, backup config) to
 *      the global_config document using merge: true so other
 *      fields are preserved.
 *   2. Commits all pending user role changes by calling updateDoc
 *      on each affected user document, then syncs the local cache
 *      and clears pendingUserChanges.
 *
 * Sets lastBackupDate on the settings doc when enabling auto-backup
 * for the first time (so the interval countdown starts from now).
 * Shows a success or error modal when complete.
 */
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

        // Show a loading spinner on the button while saving.
        const originalContent = saveBtn.innerHTML;
        saveBtn.innerHTML     = `<i class="fas fa-spinner fa-spin"></i> <span class="btn-text">Saving...</span>`;
        saveBtn.disabled      = true;

        try {
            const settingsData = {
                defaultLowStockThreshold: thresholdVal,
                autoBackupEnabled,
                backupIntervalDays,
                updatedAt: new Date(),
                updatedBy: auth.currentUser.uid
            };

            // If enabling auto-backup for the first time, seed lastBackupDate
            // so the interval starts from today rather than an empty value.
            if (autoBackupEnabled) {
                const docSnap = await getDoc(doc(db, "settings", SETTINGS_DOC_ID));
                if (!docSnap.exists() || !docSnap.data().lastBackupDate) {
                    settingsData.lastBackupDate = new Date();
                }
            }

            await setDoc(doc(db, "settings", SETTINGS_DOC_ID), settingsData, { merge: true });

            // Commit all staged role changes in parallel.
            if (pendingUserChanges.size > 0) {
                const updates = [...pendingUserChanges.entries()].map(([userId, change]) =>
                    updateDoc(doc(db, "users", userId), { role: change.pendingRole })
                );
                await Promise.all(updates);

                // Sync the local cache so the table shows saved roles immediately.
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


// ============================================================
// SECTION 9 — AUTO BACKUP
// initAutoBackup() wires up the toggle that shows/hides the
// interval selector. loadAutoBackupSettings() reads the saved
// config and triggers checkAndRunBackup() if the interval has
// elapsed. performAutoBackup() exports all active products to
// an Excel file and updates lastBackupDate in Firestore.
// ============================================================

/**
 * Wires up the Auto Backup toggle so the interval selector
 * is shown when backup is enabled and hidden when disabled.
 */
function initAutoBackup() {
    const toggle            = document.getElementById('autoBackupToggle');
    const intervalContainer = document.getElementById('backupIntervalContainer');
    toggle?.addEventListener('change', (e) => {
        intervalContainer.style.display = e.target.checked ? 'block' : 'none';
    });
}

/**
 * Reads the backup configuration from Firestore and updates the UI:
 *   - Checks the auto-backup toggle if enabled
 *   - Populates the interval select with the saved value
 *   - Displays the last backup date (or "Never")
 *   - Calls checkAndRunBackup() if auto-backup is enabled and a
 *     previous backup date exists
 */
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

/**
 * Checks whether enough time has passed since the last backup and
 * triggers performAutoBackup() if the interval has been met or exceeded.
 *
 * @param {number} intervalDays  — configured backup frequency in days
 * @param {Date}   lastBackupDate — timestamp of the most recent backup
 */
async function checkAndRunBackup(intervalDays, lastBackupDate) {
    const daysSinceBackup = Math.floor((new Date() - lastBackupDate) / (1000 * 60 * 60 * 24));
    if (daysSinceBackup >= intervalDays) await performAutoBackup();
}

/**
 * Exports all active (non-archived) products to an Excel file and
 * updates lastBackupDate in Firestore.
 *
 * Product data is flattened: the first variation and first attribute
 * entry are inlined as individual columns since Excel cannot
 * represent nested arrays. The file is named with today's date
 * (e.g. "Auto_Backup_2025-04-22.xlsx").
 *
 * Silently returns early if there are no active products to export.
 */
async function performAutoBackup() {
    try {
        const querySnapshot = await getDocs(collection(db, "products"));
        const products = [];
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.archived !== true) products.push({ id: docSnap.id, ...data });
        });
        if (products.length === 0) return;

        // Flatten each product for spreadsheet compatibility.
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

        // Stamp the backup time so the next interval check is correct.
        await setDoc(doc(db, "settings", SETTINGS_DOC_ID), { lastBackupDate: new Date() }, { merge: true });
        await loadAutoBackupSettings();
    } catch (error) {
        console.error("Auto backup failed:", error);
    }
}


// ============================================================
// SECTION 10 — MANUAL BACKUP BUTTON
// Registered inside DOMContentLoaded to guarantee the button
// element exists before we attach the listener.
// Reuses performAutoBackup() and shows the success modal on
// completion instead of running silently like the auto version.
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const manualBtn = document.getElementById('manualBackupBtn');
    if (manualBtn) {
        /**
         * Click handler for the "Download Backup Now" button.
         * Shows a spinner on the button, calls performAutoBackup(),
         * then shows a success modal or logs an error on failure.
         */
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


// ============================================================
// EXPORTS
// Named exports allow other modules or unit tests to reuse
// individual helpers without importing the full module.
// ============================================================
export { getCachedUserData, checkAndRunBackup };