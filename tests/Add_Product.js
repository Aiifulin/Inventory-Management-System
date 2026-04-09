// ==========================================
// 1. IMPORTS (Standard NPM for Testing support)
// ==========================================
import { initializeApp } from "firebase/app";
import { 
    getFirestore, collection, addDoc, serverTimestamp, 
    query, where, getDocs, doc, getDoc 
} from "firebase/firestore";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";

// ==========================================
// 2. CONFIGURATION & INIT
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
    // Suppress errors during test execution if Firebase is mocked
}

// Global State
let base64ImageString = "";
let isFormDirty = false;

// ==========================================
// 3. EXPORTED HELPERS (Tested Functions)
// ==========================================

export function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    // Secure sanitization compatible with Node.js/Vitest
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function checkAdminRole(uid, dbInstance = db) {
    try {
        const userDocRef = doc(dbInstance, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
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

export async function logActivity(action, targetName, user, dbInstance = db) {
    try {
        const userEmail = user ? user.email : "Admin"; 
        await addDoc(collection(dbInstance, "activities"), {
            action: action,
            target: targetName,
            user: userEmail,
            timestamp: serverTimestamp()
        });
        return true;
    } catch (e) {
        console.error("Error logging activity", e);
        return false;
    }
}

// ==========================================
// 4. CORE SUBMIT LOGIC (Exported for Test)
// ==========================================
export async function handleFormSubmit(e, authInstance, dbInstance) {
    if (e) e.preventDefault();

    const submitBtn = document.querySelector('.btn-submit');
    if (submitBtn) {
        submitBtn.innerText = "Saving...";
        submitBtn.disabled = true;
    }

    try {
        // --- 1. SELECTORS (Support both Test DOM and Real DOM) ---
        const priceInput = document.querySelector('input[name="price"]') || document.querySelector('input[type="number"][step="0.01"]');
        const stockInput = document.querySelector('input[name="stock"]') || document.querySelector('input[placeholder="0"]');
        const threshInput = document.querySelector('input[name="threshold"]') || document.querySelector('input[placeholder="10"]');
        const nameInput = document.querySelector('input[name="productName"]') || document.querySelector('input[placeholder="Enter product name"]');
        const descInput = document.querySelector('textarea');
        const catInput = document.querySelector('select');

        // Extract values safely
        const priceVal = priceInput ? (parseFloat(priceInput.value) || 0) : 0;
        const stockVal = stockInput ? (parseInt(stockInput.value) || 0) : 0;
        const thresholdVal = threshInput ? (parseInt(threshInput.value) || 10) : 10;
        const rawName = nameInput ? nameInput.value.trim() : "";
        const rawDesc = descInput ? descInput.value : "";
        const category = catInput ? catInput.value : "General";

        // --- 2. VALIDATION ---
        if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
            throw new Error("Price and Stock values cannot be negative.");
        }

        if (priceVal === 0 && typeof window !== 'undefined' && window.confirm) {
            const confirmZero = window.confirm("⚠️ Warning: Price is 0.00. Is this correct?");
            if (!confirmZero) {
                if (submitBtn) { submitBtn.innerText = "Add Product"; submitBtn.disabled = false; }
                return; 
            }
        }

        // --- 3. DUPLICATE CHECK ---
        const q = query(collection(dbInstance, "products"), where("name", "==", rawName));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            throw new Error(`Product name "${rawName}" already exists!`);
        }

        // --- 4. DATA CONSTRUCTION ---
        const productData = {
            name: sanitizeInput(rawName), 
            description: sanitizeInput(rawDesc), 
            category: category, 
            price: priceVal, 
            stock: stockVal,
            lowStockThreshold: thresholdVal,
            imageUrl: base64ImageString, 
            createdAt: serverTimestamp(),
            createdBy: (authInstance.currentUser) ? authInstance.currentUser.uid : "unknown", 
            variations: [],
            attributes: []
        };

        // Harvest Variations
        document.querySelectorAll('.variations-row').forEach(row => {
            const size = sanitizeInput(row.querySelector('.var-size').value);
            const color = sanitizeInput(row.querySelector('.var-color').value);
            const custom = sanitizeInput(row.querySelector('.var-custom').value);
            if(size && color) productData.variations.push({ size, color, custom });
        });

        // Harvest Attributes
        document.querySelectorAll('.custom-attr-row').forEach(row => {
            const name = sanitizeInput(row.querySelector('.attr-name').value);
            const value = sanitizeInput(row.querySelector('.attr-value').value);
            if(name && value) productData.attributes.push({ name, value });
        });

        // --- 5. SAVE ---
        await addDoc(collection(dbInstance, "products"), productData);
        
        isFormDirty = false; 

        await logActivity("Added Product", productData.name, authInstance.currentUser, dbInstance);

        // --- 6. UI FEEDBACK ---
        if (typeof window !== 'undefined' && window.alert) {
             // Only alert if we are in a real browser or full JSDOM env
             if(e) { // e exists means it was a real form submit
                alert("Product Saved Successfully!");
                window.location.href = "Dashboard.html";
             }
        }
        
        return { success: true, data: productData };

    } catch (error) {
        console.error("Error:", error);
        if (typeof window !== 'undefined' && window.alert) alert("Error saving: " + error.message);
        
        if (submitBtn) {
            submitBtn.innerText = "Add Product"; 
            submitBtn.disabled = false;
        }
        throw error; // Re-throw for Test verification
    }
}

// ==========================================
// 5. BROWSER INTERACTION (DOM Logic)
// ==========================================
if (typeof window !== 'undefined') {

    // --- Logout ---
    window.logout = function() {
        sessionStorage.clear();
        signOut(auth).then(() => window.location.replace("Login.html"));
    };

    // --- Auth Listener ---
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            displayUserRole(user.uid); // Call helper
            const isAdmin = await checkAdminRole(user.uid, db);

            if (!isAdmin) {
                alert("Access Denied: Only Admins can add products.");
                window.location.href = "Products.html";
            } else {
                console.log("Admin verified.");
                loadDefaultThreshold();
            }
        } else {
            window.location.href = "Login.html";
        }
    });

    // --- DOM Loaded ---
    document.addEventListener("DOMContentLoaded", () => {
        const form = document.querySelector('form');

        // Data Loss Prevention
        if (form) {
            form.addEventListener('input', () => isFormDirty = true);
            form.addEventListener('change', () => isFormDirty = true);
            // ATTACH SUBMIT HANDLER
            form.addEventListener("submit", (e) => handleFormSubmit(e, auth, db));
        }

        window.addEventListener('beforeunload', (e) => {
            if (isFormDirty) { e.preventDefault(); e.returnValue = ''; }
        });

        // Input Logic
        const nameInput = document.querySelector('input[placeholder="Enter product name"]');
        if(nameInput) {
            nameInput.setAttribute("maxlength", "30");
            nameInput.addEventListener("input", function() {
                this.style.borderColor = (this.value.length >= 30) ? "red" : "";
            });
        }
        document.querySelectorAll('input[type="number"]').forEach(inp => {
            inp.addEventListener('input', function() { if (this.value < 0) this.value = 0; });
        });

        // Image Logic
        setupImageUpload();

        // Row Logic
        setupDynamicRows();
    });
}

// ==========================================
// 6. BROWSER HELPERS (Not Exported)
// ==========================================

async function displayUserRole(uid) {
    const roleEl = document.getElementById('userRoleDisplay');
    if (!roleEl) return;
    try {
        const docSnap = await getDoc(doc(db, "users", uid));
        if (docSnap.exists()) {
            const data = docSnap.data();
            let roleName = data.role || "User";
            roleEl.textContent = roleName.charAt(0).toUpperCase() + roleName.slice(1);
        } else {
            roleEl.textContent = "User";
        }
    } catch (error) { roleEl.textContent = "User"; }
}

async function loadDefaultThreshold() {
    try {
        const docSnap = await getDoc(doc(db, "settings", "global_config"));
        if (docSnap.exists()) {
            const setting = docSnap.data().defaultLowStockThreshold;
            const input = document.querySelector('input[placeholder="10"]');
            if (input && setting) input.value = setting;
        }
    } catch (error) { console.log("Using default fallback."); }
}

function setupImageUpload() {
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    const uploadBox = document.querySelector('.image-upload-box');

    if (!fileInput || !uploadBox) return;

    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.className = 'btn-remove-image';
    removeBtn.type = 'button'; 
    removeBtn.style.display = 'none'; 
    uploadBox.appendChild(removeBtn);

    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.value = "";
        base64ImageString = "";
        preview.src = "";
        preview.style.display = "none";
        placeholder.style.display = "block";
        removeBtn.style.display = "none";
        isFormDirty = true;
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 750000) { 
            alert("File too large (>750KB)"); 
            fileInput.value = ""; 
            return; 
        }
        const reader = new FileReader();
        reader.onloadend = function() {
            base64ImageString = reader.result;
            preview.src = reader.result;
            preview.style.display = "block";
            placeholder.style.display = "none";
            removeBtn.style.display = "flex";
            isFormDirty = true;
        }
        reader.readAsDataURL(file);
    });
}

function setupDynamicRows() {
    // Variations
    const varContainer = document.getElementById("variation-container");
    const addVarBtn = document.getElementById("add-main-variation-btn");
    if(addVarBtn && varContainer) {
        addVarBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("variations-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
            `;
            varContainer.appendChild(newRow);
        });
        varContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-row-btn");
            if (btn) btn.closest(".variations-row").remove();
        });
    }

    // Attributes
    const attrContainer = document.getElementById("custom-attributes-container");
    const addAttrBtn = document.getElementById("add-custom-attr-main-btn");
    if(addAttrBtn && attrContainer) {
        addAttrBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("custom-attr-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="attr-name" placeholder="Name"></div>
                <div class="input-group"><input type="text" class="attr-value" placeholder="Value"></div>
                <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
            `;
            attrContainer.appendChild(newRow);
        });
        attrContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-attr-btn");
            if (btn) btn.closest(".custom-attr-row").remove();
        });
    }
}

export function doSignOut(authInstance) {
    localStorage.removeItem("user_session");
    localStorage.removeItem("user_uid");
    localStorage.removeItem("user_role");
    sessionStorage.clear();
    return signOut(authInstance);
}