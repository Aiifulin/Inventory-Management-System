import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { firebaseConfig, togglePassword } from "./Login.js";

// --- MOCK FIREBASE ---
vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    signInWithEmailAndPassword: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn()
}));

describe("firebaseConfig", () => {
    it("should have all required Firebase configuration properties", () => {
        expect(firebaseConfig).toHaveProperty("apiKey");
        expect(firebaseConfig).toHaveProperty("authDomain");
        expect(firebaseConfig).toHaveProperty("projectId");
        expect(firebaseConfig).toHaveProperty("storageBucket");
        expect(firebaseConfig).toHaveProperty("messagingSenderId");
        expect(firebaseConfig).toHaveProperty("appId");
        expect(firebaseConfig).toHaveProperty("measurementId");
    });

    it("should have non-empty string values for all properties", () => {
        Object.values(firebaseConfig).forEach((value) => {
            expect(typeof value).toBe("string");
            expect(value.length).toBeGreaterThan(0);
        });
    });

    it("should have valid Firebase project configuration format", () => {
        expect(firebaseConfig.projectId).toMatch(/^[a-z0-9-]+$/);
        expect(firebaseConfig.authDomain).toMatch(/\.firebaseapp\.com$/);
        expect(firebaseConfig.storageBucket).toMatch(/\.firebasestorage\.app$/);
        expect(firebaseConfig.messagingSenderId).toMatch(/^\d+$/);
    });

    it("should have a valid apiKey format", () => {
        expect(firebaseConfig.apiKey).toMatch(/^AIza[0-9A-Za-z_-]{35}$/);
    });

    it("should have a valid appId format", () => {
        expect(firebaseConfig.appId).toMatch(/^1:\d+:web:[0-9a-f]{22}$/);
    });

    it("should not have any properties with null values", () => {
        Object.values(firebaseConfig).forEach((value) => {
            expect(value).not.toBeNull();
        });
    });

    it("should have a valid measurementId format", () => {
        expect(firebaseConfig.measurementId).toMatch(/^G-[A-Z0-9]{10}$/);
    });

    it("should contain a valid projectId", () => {
        expect(firebaseConfig.projectId).toBe("inventory-management-sys-baccc");
    });
});

describe("togglePassword", () => {
    let input;
    let icon;
    let button;
    const inputId = "test-password-input";

    beforeEach(() => {
        document.body.innerHTML = `
            <button id="toggle-button">
                <i id="test-icon" class="fa-eye"></i>
            </button>
            <input id="${inputId}" type="password"/>
        `;
        input = document.getElementById(inputId);
        icon = document.getElementById("test-icon");
        button = document.getElementById("toggle-button");

        delete window.location;
        window.location = { href: "Initial.html" };
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it("should change input type from 'password' to 'text'", () => {
        expect(input.type).toBe("password");
        togglePassword(inputId, button);
        expect(input.type).toBe("text");
    });

    it("should change input type from 'text' back to 'password'", () => {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        togglePassword(inputId, button);
        expect(input.type).toBe("password");
    });

    it("should toggle icon class from 'fa-eye' to 'fa-eye-slash'", () => {
        expect(icon.classList.contains('fa-eye')).toBe(true);
        togglePassword(inputId, button);
        expect(icon.classList.contains('fa-eye')).toBe(false);
        expect(icon.classList.contains('fa-eye-slash')).toBe(true);
    });

    it("should toggle icon class from 'fa-eye-slash' back to 'fa-eye'", () => {
        input.type = "text";
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
        togglePassword(inputId, button);
        expect(icon.classList.contains('fa-eye-slash')).toBe(false);
        expect(icon.classList.contains('fa-eye')).toBe(true);
    });

    it("should not throw when called on a non-existent input ID", () => {
        expect(() => togglePassword("non-existent-id", button)).not.toThrow();
    });

    it("should be idempotent when toggled twice (back to original state)", () => {
        togglePassword(inputId, button);
        togglePassword(inputId, button);
        expect(input.type).toBe("password");
        expect(icon.classList.contains('fa-eye')).toBe(true);
    });
});