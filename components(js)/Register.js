import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
// Added setDoc and doc to imports
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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
const db = getFirestore(app);

window.togglePassword = function(id, el) {
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

window.register = async function () {
    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    const errorBox = document.getElementById("errorMessage");

    errorBox.style.display = "none";

    // Validation
    if (!name || !email || !password || !confirmPassword) {
        errorBox.innerText = "Please fill out all fields.";
        errorBox.style.display = "block";
        return;
    }

    const emailChecking = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
    if (!emailChecking.test(email)) {
        errorBox.innerText = "Please enter a valid email address.";
        errorBox.style.display = "block";
        return;
    }

    if (password !== confirmPassword) {
        errorBox.innerText = "Passwords do not match.";
        errorBox.style.display = "block";
        return;
    }

    if (password.length < 6) {
        errorBox.innerText = "Password must be at least 6 characters.";
        errorBox.style.display = "block";
        return;
    }

    try {
        // 1. Create Auth User
        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCred.user;

        // 2. Save User Details to Firestore (The Mirror)
        // We set the default role to 'user' here
        await setDoc(doc(db, "users", user.uid), {
            uid: user.uid,
            name: name,
            email: email,
            role: "user", // DEFAULT ROLE
            createdAt: new Date()
        });

        console.log("Account created and saved to DB");
        const popup = document.getElementById("successPopup");
        popup.style.display = "flex";

    } catch (err) {
        errorBox.innerText = err.message;
        errorBox.style.display = "block";
        console.error(err);
    }
};

window.goToLogin = function() {
    window.location.href = "Login.html";
};