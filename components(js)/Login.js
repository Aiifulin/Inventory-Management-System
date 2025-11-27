/************************************************
 * required for firebase
 ***********************************************/
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";

import { 
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

/************************************************
 * WAG GALAWIN
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
 * PASSWORD TOGGLE
 ***********************************************/
window.togglePassword = function (id, el) {
    const input = document.getElementById(id);
    const icon = el.querySelector('i');

    if(input.type === "password") {
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
window.goToLogin = function () {
    window.location.href = "Login.html";
};

window.goToRegister = function () {
    window.location.href = "Register.html";
};

/************************************************
 * LOGIN    
 ***********************************************/
window.login = function () {
    const email = document.getElementById("email").value.trim();
    const pass = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("errorMessage");

    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            window.location.href = "main.html";
        })
        .catch((err) => {
            errorBox.style.display = "block";
            errorBox.textContent = err.message;
        });
};


/************************************************
 * SHOW ERROR MESSAGE
 ***********************************************/
function showError(msg) {
    const errorBox = document.getElementById("error-box");
    errorBox.style.display = "block";
    errorBox.textContent = msg;
}


