import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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
const auth = getAuth(app); // FIXED: Was missing

// --- HARDCODED ADMIN ID ---
const ADMIN_UID = "eisTKTAY9LfdMpXZ7ebo0spRDAN2"; // FIXED: Was missing

// GLOBAL VARIABLE TO STORE IMAGE STRING
let base64ImageString = "";

// --- STRICT AUTH CHECK ---
onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = "Login.html";
    } else if (user.uid !== ADMIN_UID) {
        alert("Access Denied: Only Admin can add products.");
        window.location.href = "Products.html";
    } else {
        // User is Admin. Script continues...
        console.log("Admin verified.");
    }
});

document.addEventListener("DOMContentLoaded", () => {
    
    // --- 1. IMAGE UPLOAD LOGIC ---
    const fileInput = document.getElementById('fileInput');
    const preview = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');

    if(fileInput) {
        fileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;

            // FIXED: Firestore Limit is 1MB. Base64 adds 33% overhead.
            // Limit file to ~750KB to be safe.
            if (file.size > 750000) { 
                alert("File is too large! Please select an image under 750KB.");
                // Reset input
                fileInput.value = ""; 
                return;
            }

            const reader = new FileReader();
            reader.onloadend = function() {
                base64ImageString = reader.result;
                preview.src = reader.result;
                preview.style.display = "block";
                placeholder.style.display = "none";
            }
            reader.readAsDataURL(file);
        });
    }

    // --- 2. ROW LOGIC (Variations) ---
    const variationContainer = document.getElementById("variation-container");
    const addVarBtn = document.getElementById("add-main-variation-btn");

    if(addVarBtn && variationContainer) {
        addVarBtn.addEventListener("click", () => {
            const newRow = document.createElement("div");
            newRow.classList.add("variations-row");
            newRow.innerHTML = `
                <div class="input-group"><input type="text" class="var-size" placeholder="Ex: Large" required></div>
                <div class="input-group"><input type="text" class="var-color" placeholder="Ex: Red" required></div>
                <div class="input-group"><input type="text" class="var-custom" placeholder="Optional"></div>
                <button type="button" class="btn-delete remove-row-btn"><i class="fas fa-trash"></i></button>
            `;
            variationContainer.appendChild(newRow);
        });

        variationContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".remove-row-btn");
            if (btn && variationContainer.querySelectorAll('.variations-row').length > 1) {
                btn.closest(".variations-row").remove();
            }
        });
    }

    // --- 3. ROW LOGIC (Attributes) ---
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
            if (btn && attrContainer.querySelectorAll('.custom-attr-row').length > 1) {
                btn.closest(".custom-attr-row").remove();
            }
        });
    }

    // --- 4. SAVE LOGIC ---
    const submitBtn = document.querySelector('.btn-submit');
    const form = document.querySelector('form');

    if(submitBtn && form) {
        submitBtn.addEventListener("click", async (e) => {
            if (!form.checkValidity()) {
                form.reportValidity();
                return;
            }
            e.preventDefault();

            const originalText = submitBtn.innerText;
            submitBtn.innerText = "Saving...";
            submitBtn.disabled = true;

            try {
                const productData = {
                    name: document.querySelector('input[placeholder="Enter product name"]').value,
                    description: document.querySelector('textarea').value,
                    category: document.querySelector('select').value,
                    price: parseFloat(document.querySelector('input[type="number"][step="0.01"]').value) || 0,
                    stock: parseInt(document.querySelector('input[placeholder="0"]').value) || 0,
                    lowStockThreshold: parseInt(document.querySelector('input[placeholder="10"]').value) || 10,
                    imageUrl: base64ImageString, 
                    createdAt: serverTimestamp(),
                    createdBy: auth.currentUser.uid, // Track who added it
                    variations: [],
                    attributes: []
                };

                // Gather Variations
                document.querySelectorAll('.variations-row').forEach(row => {
                    const size = row.querySelector('.var-size').value;
                    const color = row.querySelector('.var-color').value;
                    const custom = row.querySelector('.var-custom').value;
                    if(size && color) productData.variations.push({ size, color, custom });
                });

                // Gather Attributes
                document.querySelectorAll('.custom-attr-row').forEach(row => {
                    const name = row.querySelector('.attr-name').value;
                    const value = row.querySelector('.attr-value').value;
                    if(name && value) productData.attributes.push({ name, value });
                });

                if (productData.variations.length === 0) {
                    throw new Error("Please add at least one valid Product Variation.");
                }

                await addDoc(collection(db, "products"), productData);
                
                alert("Product Saved Successfully!");
                window.location.href = "Dashboard.html";

            } catch (error) {
                console.error("Error:", error);
                alert("Error saving: " + error.message);
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
        });
    }
});