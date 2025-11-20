import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

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


const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/************************************************
 * MAKE FUNCTIONS ACCESSIBLE TO HTML BUTTONS
 ***********************************************/
window.togglePassword = function () {
    const pass = document.getElementById("password");
    pass.type = pass.type === "password" ? "text" : "password";
};

window.login = function () {
    const email = document.getElementById("email").value.trim();
    const pass = document.getElementById("password").value.trim();
    const errorBox = document.getElementById("errorMessage");

    signInWithEmailAndPassword(auth, email, pass)
        .then(() => {
            // Redirect to main page on success
            window.location.href = "main.html";
        })
        .catch((err) => {
            errorBox.style.display = "block";
            errorBox.textContent = err.message;
        });
};

/************************************************
 * this redirects to main page if already logged in
 ***********************************************/
onAuthStateChanged(auth, (user) => {
    if (user) {
        window.location.href = "main.html";
    }
});
