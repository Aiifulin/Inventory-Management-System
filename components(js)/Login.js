/************************************************
 * required for firebase
 ***********************************************/
import { initializeApp } from 'firebase/app';
import { 
    getAuth,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    onAuthStateChanged
} from "firebase/auth";

import {
    getFirestore,
    doc,
    setDoc
} from "firebase/firestore";

/************************************************
 * WAG GALAWIN
 ***********************************************/
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
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);


/************************************************
 * LOGIN    
 ***********************************************/
const login = function () {
    window.location.href = "Login.html";
    const email = document.getElementById("email").value.trim();
    const pass = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("errorMessage");

    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            window.location.href = "Dashboard.html";
        })
        .catch((err) => {
            errorBox.style.display = "block";
            errorBox.textContent = err.message;
        });


};

/************************************************
 * PASSWORD TOGGLE
 ***********************************************/
const togglePassword = function (id, el) {
    window.location.href = "Login.html";
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
const goToLogin = function () {
    window.location.href = "Login.html";
};

const goToRegister = function () {
    window.location.href = "Register.html";
};

if (typeof window !== "undefined") {
    window.goToLogin = goToLogin;
    window.goToRegister = goToRegister;
    window.login = login;
}

export { goToLogin, goToRegister, login, togglePassword };





/************************************************
 * SHOW ERROR MESSAGE
 ***********************************************/
function showError(msg) {
    const errorBox = document.getElementById("error-box");
    errorBox.style.display = "block";
    errorBox.textContent = msg;
}


