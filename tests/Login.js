/************************************************
 * IMPORTS (Refactored for Testing/Bundlers)
 ***********************************************/
// If using a bundler (Vite/Webpack) or Node/Vitest:
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

/************************************************
 * FIREBASE CONFIGURATION
 ***********************************************/
// Added 'export' so the test can read this object
export const firebaseConfig = {
  apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
  authDomain: "inventory-management-sys-baccc.firebaseapp.com",
  projectId: "inventory-management-sys-baccc",
  storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
  messagingSenderId: "304433839568",
  appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
  measurementId: "G-68CR9JCJV8"
};

// INIT
// We wrap this in a try-catch or check environment to prevent
// tests from crashing if they don't mock firebase fully.
let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    const db = initializeFirestore(app, {});
} catch (e) {
    console.warn("Firebase not initialized (expected during simple unit testing)");
}

/************************************************
 * LOGIN FUNCTION
 ***********************************************/
// Added 'export'
export const login = function () {
    // Check if document exists (for SSR/Test safety)
    if (typeof document === 'undefined') return;

    const emailInput = document.getElementById("email");
    const passInput = document.getElementById("password");
    
    // Safety check if elements exist
    if (!emailInput || !passInput) return;

    const email = emailInput.value.trim();
    const pass = passInput.value.trim();
    const errorBox = document.getElementById("errorMessage");

    // Clear previous errors
    if (errorBox) errorBox.style.display = "none";

    signInWithEmailAndPassword(auth, email, pass)
        .then((userCredential) => {
            sessionStorage.setItem("user_session", "true");
            sessionStorage.setItem("user_uid", userCredential.user.uid);

            console.log("Logged in:", userCredential.user);
            window.location.href = "Dashboard.html";
        })
        .catch((err) => {
            console.error(err.code, err.message);
            if (errorBox) {
                errorBox.style.display = "block";
                if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
                    errorBox.textContent = "Invalid Email or Password";
                } else {
                    errorBox.textContent = err.message;
                }
            } else {
                alert(err.message);
            }
        });
};

/************************************************
 * PASSWORD TOGGLE
 ***********************************************/
// Added 'export'
export const togglePassword = function (id, el) {
    if (typeof document === 'undefined') return;

    const input = document.getElementById(id);
    // Safety check
    if (!input) return;

    const icon = el.querySelector('i');

    if (input.type === "password") {
        input.type = "text";
        if (icon) {
            icon.classList.remove('fa-eye');
            icon.classList.add('fa-eye-slash');
        }
    } else {
        input.type = "password";
        if (icon) {
            icon.classList.remove('fa-eye-slash');
            icon.classList.add('fa-eye');
        }
    }
};

/************************************************
 * NAVIGATION
 ***********************************************/
export const goToRegister = function () {
    window.location.href = "Register.html";
};

// EXPOSE FUNCTIONS TO WINDOW (For HTML onclick attributes)
if (typeof window !== 'undefined') {
    window.login = login;
    window.togglePassword = togglePassword;
    window.goToRegister = goToRegister;
}