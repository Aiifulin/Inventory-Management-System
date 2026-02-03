import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
// Added doc and getDoc for role checking
import { getFirestore, collection, addDoc, serverTimestamp, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
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

let base64ImageString = "";
let isFormDirty = false;

// --- AUTH CHECK WITH ROLE VALIDATION ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        // 1. Fetch User Role from 'users' collection
        const isAdmin = await checkAdminRole(user.uid);

        if (!isAdmin) {
            alert("Access Denied: Only Admins can add products.");
            window.location.href = "Products.html";
        } else {
            console.log("Admin verified.");
            // Only load page logic if admin is verified
            loadDefaultThreshold();
        }
    } else {
        window.location.href = "Login.html";
    }
});

// --- HELPER: CHECK ADMIN ROLE ---
async function checkAdminRole(uid) {
    try {
        const userDocRef = doc(db, "users", uid);
        const userSnap = await getDoc(userDocRef);
        
        if (userSnap.exists()) {
            const userData = userSnap.data();
            // Check if role is 'admin' (case-insensitive for safety)
            return (userData.role && userData.role.toLowerCase() === 'admin');
        }
        
        // Fallback: If user not found in DB (legacy accounts), assume NOT admin
        return false;
    } catch (error) {
        console.error("Error checking role:", error);
        return false; 
    }
}

// --- HELPER: ACTIVITY LOGGING FUNCTION ---
async function logActivity(action, targetName) {
    try {
        const userEmail = auth.currentUser ? auth.currentUser.email : "Admin"; 
        
        await addDoc(collection(db, "activities"), {
            action: action,          // e.g., "Added Product"
            target: targetName,      // e.g., "Gaming Chair"
            user: userEmail,         // Logs who performed the action
            timestamp: serverTimestamp()
        });
        console.log("Activity logged successfully");
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

// --- HELPER: LOAD DEFAULT SETTINGS ---
async function loadDefaultThreshold() {
    try {
        const docRef = doc(db, "settings", "global_config");
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const settingValue = data.defaultLowStockThreshold;
            
            const thresholdInput = document.querySelector('input[placeholder="10"]');
            
            if (thresholdInput && settingValue) {
                thresholdInput.value = settingValue;
            }
        }
    } catch (error) {
        console.log("Could not load default settings, using hardcoded fallback.");
    }
}

document.addEventListener("DOMContentLoaded", () => {

    // --- 1. DATA LOSS PREVENTION ---
    const form = document.querySelector('form');
    
    if (form) {
        form.addEventListener('input', () => isFormDirty = true);
        form.addEventListener('change', () => isFormDirty = true);
    }

    window.addEventListener('beforeunload', (e) => {
        if (isFormDirty) {
            e.preventDefault();
            e.returnValue = ''; 
        }
    });

    // --- 2. SANITIZERS & HELPERS --- this prevents XSS attacks by sanitizing inputs using DOM methods
    function sanitizeInput(str) {
        if (!str) return "";
        if (typeof str !== 'string') return String(str);
        const div = document.createElement('div');
        div.innerText = str; 
        return div.innerHTML;
    }

    function applyCharLimit(input) {
        if (!input) return;
        input.setAttribute("maxlength", "30");
        input.addEventListener("input", function() {
            if (this.value.length >= 30) {
                this.style.borderColor = "red";
                this.style.outlineColor = "red"; 
            } else {
                this.style.borderColor = "";
                this.style.outlineColor = "";
            }
        });
    }

    function preventNegatives(input) {
        input.addEventListener('input', function() {
            if (this.value < 0) this.value = 0; 
        });
    }
    
    const nameInput = document.querySelector('input[placeholder="Enter product name"]');
    if(nameInput) applyCharLimit(nameInput);
    document.querySelectorAll('input[type="number"]').forEach(inp => preventNegatives(inp));

    // --- 3. IMAGE UPLOAD & REMOVE LOGIC ---
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    const uploadBox = document.querySelector('.image-upload-box');

    // Create Remove Button Dynamically
    const removeBtn = document.createElement('button');
    removeBtn.innerHTML = '<i class="fas fa-times"></i>';
    removeBtn.className = 'btn-remove-image';
    removeBtn.type = 'button'; 
    removeBtn.title = "Remove Image";
    removeBtn.style.display = 'none'; 

    if(uploadBox) uploadBox.appendChild(removeBtn);

    function resetImage(e) {
        if(e) e.stopPropagation(); 
        fileInput.value = "";
        base64ImageString = "";
        preview.src = "";
        preview.style.display = "none";
        placeholder.style.display = "block";
        removeBtn.style.display = "none"; 
        isFormDirty = true;
    }

    removeBtn.addEventListener('click', resetImage);

    if(fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            if (file.size > 750000) { 
                alert("File is too large! Please select an image under 750KB.");
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

    // --- ROW LOGIC ---
    const variationContainer = document.getElementById("variation-container");
    const addVarBtn = document.getElementById("add-main-variation-btn");

    if(addVarBtn && variationContainer) {
        variationContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        addVarBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("variations-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
            `;
            newRow.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
            variationContainer.appendChild(newRow);
        });
        variationContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-row-btn");
            if (btn && variationContainer.querySelectorAll('.variations-row').length > 1) {
                btn.closest(".variations-row").remove();
            }
        });
    }

    const attrContainer = document.getElementById("custom-attributes-container");
    const addAttrBtn = document.getElementById("add-custom-attr-main-btn");

    if(addAttrBtn && attrContainer) {
        attrContainer.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
        addAttrBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("custom-attr-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="attr-name" placeholder="Name"></div>
                <div class="input-group"><input type="text" class="attr-value" placeholder="Value"></div>
                <button type="button" class="btn-delete remove-attr-btn"><i class="fas fa-trash"></i></button>
            `;
            newRow.querySelectorAll('input').forEach(inp => applyCharLimit(inp));
            attrContainer.appendChild(newRow);
        });
        attrContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-attr-btn");
            if (btn && attrContainer.querySelectorAll('.custom-attr-row').length > 1) {
                btn.closest(".custom-attr-row").remove();
            }
        });
    }

    // --- 4. SAVE LOGIC WITH LOGGING ---
    const submitBtn = document.querySelector('.btn-submit');

    if(form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault(); 

            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const priceVal = parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0;
                const stockVal = parseInt(document.querySelector('input[placeholder="0"]').value) || 0;
                const thresholdVal = parseInt(document.querySelector('input[placeholder="10"]').value) || 10;

                // VALIDATION 1: Check Negatives
                if (priceVal < 0 || stockVal < 0 || thresholdVal < 0) {
                    throw new Error("Price and Stock values cannot be negative.");
                }

                // VALIDATION 2: Check for 0 Price with Confirmation
                if (priceVal === 0) {
                    const confirmZero = confirm("⚠️ Warning: You are setting the Price to 0.00.\n\nAre you sure this product is free?");
                    if (!confirmZero) {
                        submitBtn.innerText = "Add Product"; 
                        submitBtn.disabled = false;
                        return; 
                    }
                }

                const rawName = document.querySelector('input[placeholder="Enter product name"]').value.trim();
                const rawDesc = document.querySelector('textarea').value;

                // DUPLICATE CHECK
                const q = query(collection(db, "products"), where("name", "==", rawName));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    throw new Error(`Product name "${rawName}" already exists!`);
                }

                const productData = {
                    name: sanitizeInput(rawName), 
                    description: sanitizeInput(rawDesc), 
                    category: document.querySelector('select').value, 
                    price: priceVal, 
                    stock: stockVal,
                    lowStockThreshold: thresholdVal,
                    imageUrl: base64ImageString, 
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid, 
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

                if (productData.variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                // 1. SAVE PRODUCT
                await addDoc(collection(db, "products"), productData);
                
                isFormDirty = false; 

                // 2. LOG ACTIVITY
                await logActivity("Added Product", productData.name);

                alert("Product Saved Successfully!");
                window.location.href = "Dashboard.html";

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = "Add Product"; 
                submitBtn.disabled = false;
            }
        });
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