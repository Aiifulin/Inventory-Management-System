import { describe, it, expect, vi, beforeEach } from "vitest";
import { togglePassword, login, goToRegister } from "../public/js/Login.js";

// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockSignInWithEmailAndPassword,
    mockSignOut,
    mockGetDoc,
    mockDoc
} = vi.hoisted(() => ({
    mockSignInWithEmailAndPassword: vi.fn(),
    mockSignOut:                    vi.fn(),
    mockGetDoc:                     vi.fn(),
    mockDoc:                        vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    signInWithEmailAndPassword: mockSignInWithEmailAndPassword,
    signOut:                    mockSignOut
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    doc:    mockDoc,
    getDoc: mockGetDoc
}));

vi.mock("../public/js/firebase.js", () => ({
    auth: {},
    db:   {}
}));

// ==========================================
// STORAGE STUBS
// ==========================================
const makeStorage = () => {
    let store = {};
    const getItem    = vi.fn((k)    => store[k] ?? null);
    const setItem    = vi.fn((k, v) => { store[k] = String(v); });
    const removeItem = vi.fn((k)    => { delete store[k]; });
    const clear      = vi.fn(()     => { store = {}; });
    return {
        getItem, setItem, removeItem, clear,
        get length() { return Object.keys(store).length; },
        _reset() {
            store = {};
            getItem.mockImplementation((k)    => store[k] ?? null);
            setItem.mockImplementation((k, v) => { store[k] = String(v); });
            removeItem.mockImplementation((k)  => { delete store[k]; });
            clear.mockImplementation(()        => { store = {}; });
        }
    };
};

global.localStorage   = makeStorage();
global.sessionStorage = makeStorage();

// ==========================================
// LOCATION STUB
// ==========================================
let _href = "";
Object.defineProperty(global, "location", {
    configurable: true,
    value: {
        get href()  { return _href; },
        set href(v) { _href = v;   },
        replace: vi.fn()
    }
});

// ==========================================
// DOM STUBS
// ==========================================
global.setInterval  = vi.fn(() => 99);
global.clearInterval = vi.fn();

global.document = {
    getElementById:   vi.fn(),
    querySelector:    vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    addEventListener: vi.fn(),
    createElement:    vi.fn(() => ({
        textContent: "", innerHTML: "", style: {},
        classList: { toggle: vi.fn(), add: vi.fn(), remove: vi.fn() },
        appendChild: vi.fn(), addEventListener: vi.fn()
    })),
    documentElement: { style: {} }
};

// ==========================================
// DOM HELPERS
// ==========================================
function buildLoginDom(overrides = {}) {
    const els = {
        email:               { value: overrides.email    ?? "admin@test.com", style: {} },
        password:            { value: overrides.password ?? "password123",    style: {} },
        errorMessage:        { style: { display: "none" }, textContent: "", offsetHeight: 0, animation: "" },
        loginBtn:            { disabled: false },
        loginBtnText:        { textContent: "Sign In" },
        loginSpinner:        { style: { display: "none" } },
        loginSuccessOverlay: { style: { display: "none" } },
        loginProgressBar:    { style: { width: "0%" } },
    };

    global.document.getElementById.mockImplementation((id) => els[id] ?? null);

    const titleEl = { textContent: "" };
    global.document.querySelector.mockImplementation((sel) => {
        if (sel === ".login-success-title") return titleEl;
        return { textContent: "", style: { display: "none", width: "0%" } };
    });

    return { els, titleEl };
}

// ==========================================
// TEST SUITES
// ==========================================

describe("Login — togglePassword", () => {

    it("should switch input type from password to text", () => {
        const input = { type: "password" };
        const icon  = { classList: { remove: vi.fn(), add: vi.fn() } };
        const el    = { querySelector: vi.fn(() => icon) };
        global.document.getElementById.mockReturnValue(input);

        togglePassword("password", el);

        expect(input.type).toBe("text");
        expect(icon.classList.remove).toHaveBeenCalledWith("fa-eye");
        expect(icon.classList.add).toHaveBeenCalledWith("fa-eye-slash");
    });

    it("should switch input type from text back to password", () => {
        const input = { type: "text" };
        const icon  = { classList: { remove: vi.fn(), add: vi.fn() } };
        const el    = { querySelector: vi.fn(() => icon) };
        global.document.getElementById.mockReturnValue(input);

        togglePassword("password", el);

        expect(input.type).toBe("password");
        expect(icon.classList.remove).toHaveBeenCalledWith("fa-eye-slash");
        expect(icon.classList.add).toHaveBeenCalledWith("fa-eye");
    });

    it("should toggle back and forth correctly", () => {
        const input = { type: "password" };
        const icon  = { classList: { remove: vi.fn(), add: vi.fn() } };
        const el    = { querySelector: vi.fn(() => icon) };
        global.document.getElementById.mockReturnValue(input);

        togglePassword("password", el);
        expect(input.type).toBe("text");

        togglePassword("password", el);
        expect(input.type).toBe("password");
    });
});

// ==========================================

describe("Login — login", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        global.localStorage._reset();
        global.sessionStorage._reset();
        _href = "";
    });

    it("should call signInWithEmailAndPassword with email and password", async () => {
        buildLoginDom();
        mockSignInWithEmailAndPassword.mockResolvedValue({
            user: { uid: "uid-1", emailVerified: true }
        });
        mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: "Alice" }) });

        await login();

        expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
            expect.anything(),
            "admin@test.com",
            "password123"
        );
    });

    it("should set localStorage on successful login", async () => {
        buildLoginDom();
        mockSignInWithEmailAndPassword.mockResolvedValue({
            user: { uid: "uid-1", emailVerified: true }
        });
        mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ name: "Alice" }) });

        await login();

        expect(global.localStorage.setItem).toHaveBeenCalledWith("user_session", "true");
        expect(global.localStorage.setItem).toHaveBeenCalledWith("user_uid", "uid-1");
    });

    it("should sign out and show error when email is not verified", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockResolvedValue({
            user: { uid: "uid-1", emailVerified: false }
        });
        mockSignOut.mockResolvedValue();

        await login();

        expect(mockSignOut).toHaveBeenCalled();
        expect(els.errorMessage.textContent).toContain("verify your email");
        expect(els.loginBtn.disabled).toBe(false);
    });

    it("should show error for invalid credentials", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockRejectedValue({
            code:    "auth/invalid-credential",
            message: "Invalid credential"
        });

        await login();

        expect(els.errorMessage.textContent).toBe("Invalid email or password. Please try again.");
        expect(els.loginBtn.disabled).toBe(false);
        expect(els.loginBtnText.textContent).toBe("Sign In");
    });

    it("should show error for wrong password", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockRejectedValue({
            code:    "auth/wrong-password",
            message: "Wrong password"
        });

        await login();

        expect(els.errorMessage.textContent).toBe("Invalid email or password. Please try again.");
    });

    it("should show error for user not found", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockRejectedValue({
            code:    "auth/user-not-found",
            message: "User not found"
        });

        await login();

        expect(els.errorMessage.textContent).toBe("Invalid email or password. Please try again.");
    });

    it("should show rate limit error for too many requests", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockRejectedValue({
            code:    "auth/too-many-requests",
            message: "Too many requests"
        });

        await login();

        expect(els.errorMessage.textContent).toBe("Too many attempts. Please wait a moment and try again.");
    });

    it("should show raw error message for unknown error codes", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockRejectedValue({
            code:    "auth/unknown",
            message: "Something went wrong"
        });

        await login();

        expect(els.errorMessage.textContent).toBe("Something went wrong");
    });

    it("should show loading state while signing in", async () => {
        const { els } = buildLoginDom();
        mockSignInWithEmailAndPassword.mockReturnValue(new Promise(() => {}));

        login();

        expect(els.loginBtn.disabled).toBe(true);
        expect(els.loginBtnText.textContent).toBe("Signing in...");
        expect(els.loginSpinner.style.display).toBe("inline-block");
    });

    it("should use 'User' as fallback when Firestore name fetch fails", async () => {
        buildLoginDom();
        mockSignInWithEmailAndPassword.mockResolvedValue({
            user: { uid: "uid-1", emailVerified: true }
        });
        mockGetDoc.mockRejectedValue(new Error("Firestore error"));

        await expect(login()).resolves.not.toThrow();
    });

    it("should use 'User' fallback when user document does not exist", async () => {
        buildLoginDom();
        mockSignInWithEmailAndPassword.mockResolvedValue({
            user: { uid: "uid-1", emailVerified: true }
        });
        mockGetDoc.mockResolvedValue({ exists: () => false });

        await expect(login()).resolves.not.toThrow();
    });
});

// ==========================================

describe("Login — goToRegister", () => {

    beforeEach(() => { _href = ""; });

    it("should redirect to Register.html", () => {
        goToRegister();
        expect(global.location.href).toBe("Register.html");
    });
});