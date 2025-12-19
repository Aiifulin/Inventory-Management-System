// Reset.js (NPM Version)

import { initializeApp } from "firebase/app";
import { 
    getAuth, 
    sendPasswordResetEmail, 
    fetchSignInMethodsForEmail 
} from "firebase/auth";

export const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

let app, auth;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
} catch (e) { /* Test Env */ }

// --- EXPORTED LOGIC ---

export async function handlePasswordReset(email, authInstance) {
    if (!email) throw new Error("Please enter your email address");

    try {
        const signInMethods = await fetchSignInMethodsForEmail(authInstance, email);
        if (signInMethods.length === 0) {
            throw new Error("No account found with this email address.");
        }
        await sendPasswordResetEmail(authInstance, email);
        return "Password reset email sent successfully. Check your inbox.";
    } catch (err) {
        if (err.code === "auth/invalid-email") throw new Error("Please enter a valid email address.");
        if (err.code === "auth/too-many-requests") throw new Error("Too many attempts. Please try again later.");
        throw err; 
    }
}

// --- BROWSER LOGIC ---
if (typeof window !== 'undefined') {

    window.goToLogin = function () {
        window.location.href = "Login.html";
    };

    function showError(msg) {
        const errorBox = document.getElementById("error-box");
        if(errorBox) {
            errorBox.style.display = "block";
            errorBox.textContent = msg;
        }
    }

    function showSuccess(msg) {
        const successBox = document.getElementById("success-box");
        if(successBox) {
            successBox.style.display = "block";
            successBox.textContent = msg;
        }
    }

    const passwordResetForm = document.getElementById("password-reset-form");

    if (passwordResetForm) {
        passwordResetForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const email = document.getElementById("email").value.trim();
            const errorBox = document.getElementById("error-box");
            const successBox = document.getElementById("success-box");

            // Reset UI
            if(errorBox) { errorBox.style.display = "none"; errorBox.textContent = ""; }
            if(successBox) { successBox.style.display = "none"; successBox.textContent = ""; }

            try {
                // Call Logic
                const successMsg = await handlePasswordReset(email, auth);
                showSuccess(successMsg);
                passwordResetForm.reset();
            } catch (err) {
                console.error(err);
                showError(err.message);
            }
        });
    }
}