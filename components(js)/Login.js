/************************************************
 * IMPORTS (Using CDN)
 ***********************************************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/************************************************
 * FIREBASE CONFIGURATION
 ***********************************************/
const firebaseConfig = {
  apiKey: "AIzaSyBeaF2VKovHASuzhvZHzOoE0yB7QnBDej0",
  authDomain: "inventory-management-sys-baccc.firebaseapp.com",
  projectId: "inventory-management-sys-baccc",
  storageBucket: "inventory-management-sys-baccc.firebasestorage.app",
  messagingSenderId: "304433839568",
  appId: "1:304433839568:web:50dafae1296e6bb0d30dd5",
  measurementId: "G-68CR9JCJV8"
};

// INIT
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/************************************************
 * LOGIN FUNCTION
 ***********************************************/
const login = function () {
    const email = document.getElementById("email").value.trim();
    const pass = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("errorMessage");

    // Clear previous errors
    if(errorBox) errorBox.style.display = "none";

    signInWithEmailAndPassword(auth, email, pass)
        .then((userCredential) => {
            // --- CRITICAL FIX: SAVE THE SESSION ---
            // Without this, the Dashboard will kick you out immediately.
            localStorage.setItem("user_session", "true");
            localStorage.setItem("user_uid", userCredential.user.uid);

            console.log("Logged in:", userCredential.user);
            window.location.href = "Dashboard.html";
        })
        .catch((err) => {
            // Login Failed
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
const togglePassword = function (id, el) {
    const input = document.getElementById(id);
    const icon = el.querySelector('i');

    if (input.type === "password") {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        input.type = "password";
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
};

/************************************************
 * NAVIGATION
 ***********************************************/
const goToRegister = function () {
    window.location.href = "Register.html";
};

// EXPOSE FUNCTIONS TO WINDOW
window.login = login;
window.togglePassword = togglePassword;
window.goToRegister = goToRegister;