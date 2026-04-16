import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getAuth,
    sendPasswordResetEmail,
    fetchSignInMethodsForEmail
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// --- HELPERS ---
function showError(msg) {
    const box = document.getElementById("error-box");
    const successBox = document.getElementById("success-box");

    successBox.style.display = "none";
    box.textContent   = msg;
    box.style.display = "block";

    // Re-trigger shake
    box.style.animation = "none";
    box.offsetHeight;
    box.style.animation = "";
}

function showSuccess(msg) {
    const box = document.getElementById("success-box");
    const errorBox = document.getElementById("error-box");

    errorBox.style.display = "none";
    box.textContent   = msg;
    box.style.display = "block";
}

function setLoading(isLoading) {
    const btn     = document.getElementById("resetBtn");
    const btnText = document.getElementById("resetBtnText");
    const spinner = document.getElementById("resetSpinner");

    btn.disabled          = isLoading;
    spinner.style.display = isLoading ? "inline-block" : "none";
    btnText.textContent   = isLoading ? "Sending..." : "Send Reset Link";
}

// --- FORM SUBMIT ---
document.getElementById("password-reset-form")
    .addEventListener("submit", async (e) => {
        e.preventDefault();

        const email      = document.getElementById("email").value.trim();
        const errorBox   = document.getElementById("error-box");
        const successBox = document.getElementById("success-box");

        // Clear both boxes
        errorBox.style.display   = "none";
        successBox.style.display = "none";

        if (!email) {
            showError("Please enter your email address.");
            return;
        }

        setLoading(true);

        try {
            // 1. Check if email exists
            const methods = await fetchSignInMethodsForEmail(auth, email);
        
            if (methods.length === 0) {
                showError("No account found with this email address.");
                setLoading(false);
                return;
            }
        
            // 2. Define exactly where the user should go back to
            const actionCodeSettings = {
                // This MUST be the full URL of your login page on the DEPLOYED site
                url: 'https://grouprokuinventorymanagement.web.app/index.html', 
                handleCodeInApp: true,
            };
        
            // 3. Pass the settings to the reset function
            await sendPasswordResetEmail(auth, email, actionCodeSettings);
        
            showSuccess("Reset link sent! Check your inbox.");
            document.getElementById("password-reset-form").reset();

        } catch (err) {
            console.error(err);

            if (err.code === "auth/invalid-email") {
                showError("Please enter a valid email address.");
            } else if (err.code === "auth/too-many-requests") {
                showError("Too many attempts. Please wait a moment and try again.");
            } else {
                showError(err.message);
            }
        } finally {
            setLoading(false);
        }
    });