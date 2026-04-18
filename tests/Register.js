// Register.js (NPM Version)

import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc } from "firebase/firestore";

export const firebaseConfig = {
    apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
    authDomain: "inventory-management-sys-baccc.firebaseapp.com",
    projectId: "inventory-management-sys-baccc",
    storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
    messagingSenderId: "304433839568",
    appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
    measurementId: "G-68CR9JCJV8"
};

let app, auth, db;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    const db = initializeFirestore(app, {});
} catch (e) { /* Test Env */ }

// --- EXPORTED LOGIC ---

export function validateRegistration(name, email, password, confirmPassword) {
    if (!name || !email || !password || !confirmPassword) return "Please fill out all fields.";
    const emailChecking = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailChecking.test(email)) return "Please enter a valid email address.";
    if (password !== confirmPassword) return "Passwords do not match.";
    if (password.length < 6) return "Password must be at least 6 characters.";
    return null;
}

export async function registerUserLogic(name, email, password, authInstance, dbInstance) {
    const userCred = await createUserWithEmailAndPassword(authInstance, email, password);
    const user = userCred.user;
    await setDoc(doc(dbInstance, "users", user.uid), {
        uid: user.uid,
        name: name,
        email: email,
        role: "user",
        createdAt: new Date()
    });
    return user;
}

// --- BROWSER LOGIC ---
if (typeof window !== 'undefined') {

    window.togglePassword = function(id, el) {
        const input = document.getElementById(id);
        const icon = el.querySelector('i');
        if(input.type === "password") {
            input.type = "text";
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = "password";
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    window.register = async function () {
        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const confirmPassword = document.getElementById("confirmPassword").value;
        const errorBox = document.getElementById("errorMessage");

        errorBox.style.display = "none";

        // 1. Validation Logic
        const error = validateRegistration(name, email, password, confirmPassword);
        if (error) {
            errorBox.innerText = error;
            errorBox.style.display = "block";
            return;
        }

        try {
            // 2. Register Logic
            await registerUserLogic(name, email, password, auth, db);

            console.log("Account created and saved to DB");
            document.getElementById("successPopup").style.display = "flex";

        } catch (err) {
            errorBox.innerText = err.message;
            errorBox.style.display = "block";
            console.error(err);
        }
    };

    window.goToLogin = function() {
        window.location.href = "Login.html";
    }
}