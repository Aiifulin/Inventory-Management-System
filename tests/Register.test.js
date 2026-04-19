import { describe, it, expect, vi, beforeEach } from "vitest";
import { showError } from "../public/js/Register.js";

// ==========================================
// HOISTED MOCKS
// ==========================================
const {
    mockCreateUser,
    mockSendVerification,
    mockDeleteUser,
    mockSetDoc,
    mockDoc
} = vi.hoisted(() => ({
    mockCreateUser:      vi.fn(),
    mockSendVerification: vi.fn(),
    mockDeleteUser:      vi.fn(),
    mockSetDoc:          vi.fn(),
    mockDoc:             vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    createUserWithEmailAndPassword: mockCreateUser,
    sendEmailVerification:          mockSendVerification,
    deleteUser:                     mockDeleteUser
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    doc:    mockDoc,
    setDoc: mockSetDoc
}));

vi.mock("../public/js/firebase.js", () => ({
    auth: {},
    db:   {}
}));

// ==========================================
// DOM STUBS
// ==========================================
const makeSafeEl = (overrides = {}) => ({
    value:           "",
    textContent:     "",
    innerHTML:       "",
    type:            "text",
    style:           { display: "none", animation: "", width: "0%" },
    disabled:        false,
    offsetHeight:    0,
    classList:       { remove: vi.fn(), add: vi.fn(), toggle: vi.fn() },
    addEventListener: vi.fn(),
    querySelector:   vi.fn(() => makeSafeEl()),
    appendChild:     vi.fn(),
    ...overrides
});

let _href = "";
Object.defineProperty(global, "location", {
    configurable: true,
    value: {
        get href()  { return _href; },
        set href(v) { _href = v; },
        replace: vi.fn()
    }
});

global.setInterval  = vi.fn(() => 42);
global.clearInterval = vi.fn();

// Build a fresh DOM map for every test
let domMap;
function buildRegisterDom(overrides = {}) {
    domMap = {
        name:              makeSafeEl({ value: overrides.name            ?? "Alice" }),
        email:             makeSafeEl({ value: overrides.email           ?? "alice@test.com" }),
        password:          makeSafeEl({ value: overrides.password        ?? "password123", type: "password" }),
        confirmPassword:   makeSafeEl({ value: overrides.confirmPassword ?? "password123", type: "password" }),
        errorMessage:      makeSafeEl({ style: { display: "none", animation: "" } }),
        registerBtn:       makeSafeEl({ disabled: false }),
        registerBtnText:   makeSafeEl({ textContent: "Create Account" }),
        registerSpinner:   makeSafeEl({ style: { display: "none" } }),
        verifyEmailDisplay: makeSafeEl(),
        verifyOverlay:     makeSafeEl({ style: { display: "none" } }),
        verifyStatus:      makeSafeEl(),
        verifyActions:     makeSafeEl(),
        successOverlay:    makeSafeEl({ style: { display: "none" } }),
        registerProgressBar: makeSafeEl({ style: { width: "0%" } }),
        resendBtnText:     makeSafeEl({ textContent: "Resend email" }),
    };

    global.document = {
        getElementById:   vi.fn((id) => domMap[id] ?? makeSafeEl()),
        querySelector:    vi.fn(() => makeSafeEl()),
        querySelectorAll: vi.fn(() => []),
        addEventListener: vi.fn(),
        createElement:    vi.fn(() => makeSafeEl()),
        body:             { insertAdjacentHTML: vi.fn() },
        documentElement:  { style: {} }
    };

    return domMap;
}

// ==========================================
// TESTS
// ==========================================

describe("Register — showError", () => {

    it("should set textContent and display block on the error box", () => {
        const box = makeSafeEl({ style: { display: "none", animation: "" } });
        showError(box, "Something went wrong");
        expect(box.textContent).toBe("Something went wrong");
        expect(box.style.display).toBe("block");
    });

    it("should reset animation to re-trigger shake", () => {
        const box = makeSafeEl({ style: { display: "none", animation: "shake 0.3s" } });
        showError(box, "Error");
        // animation is set to "none" then cleared to ""
        expect(box.style.animation).toBe("");
    });
});

// ==========================================

describe("Register — window.register validation", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        _href = "";
        buildRegisterDom();
    });

    it("should show error when name is empty", async () => {
        domMap.name.value = "";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please fill out all fields.");
        expect(mockCreateUser).not.toHaveBeenCalled();
    });

    it("should show error when email is empty", async () => {
        domMap.email.value = "";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please fill out all fields.");
    });

    it("should show error when password is empty", async () => {
        domMap.password.value = "";
        domMap.confirmPassword.value = "";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please fill out all fields.");
    });

    it("should show error for invalid email (no @)", async () => {
        domMap.email.value = "invalidemail";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please enter a valid email address.");
    });

    it("should show error for invalid email (no TLD)", async () => {
        domMap.email.value = "user@domain";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please enter a valid email address.");
    });

    it("should show error when password is shorter than 6 characters", async () => {
        domMap.password.value        = "12345";
        domMap.confirmPassword.value = "12345";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Password must be at least 6 characters.");
    });

    it("should show error when passwords do not match", async () => {
        domMap.confirmPassword.value = "different";
        await register();
        expect(domMap.errorMessage.textContent).toBe("Passwords do not match.");
    });

    it("should show loading state while creating account", async () => {
        // Never resolves — lets us observe the synchronous loading state
        mockCreateUser.mockReturnValue(new Promise(() => {}));
        register();
        expect(domMap.registerBtn.disabled).toBe(true);
        expect(domMap.registerBtnText.textContent).toBe("Creating account...");
        expect(domMap.registerSpinner.style.display).toBe("inline-block");
    });
});

// ==========================================

describe("Register — window.register Firebase flow", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        _href = "";
        buildRegisterDom();
    });

    it("should call createUserWithEmailAndPassword with email and password", async () => {
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();

        await register();

        expect(mockCreateUser).toHaveBeenCalledWith(
            expect.anything(),
            "alice@test.com",
            "password123"
        );
    });

    it("should send email verification after account creation", async () => {
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();

        await register();

        expect(mockSendVerification).toHaveBeenCalledWith(mockUser);
    });

    it("should show the verify overlay after successful creation", async () => {
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();

        await register();

        expect(domMap.verifyOverlay.style.display).toBe("flex");
    });

    it("should reset button state after successful creation", async () => {
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();

        await register();

        expect(domMap.registerBtn.disabled).toBe(false);
        expect(domMap.registerBtnText.textContent).toBe("Create Account");
        expect(domMap.registerSpinner.style.display).toBe("none");
    });

    it("should show error for auth/email-already-in-use", async () => {
        mockCreateUser.mockRejectedValue({ code: "auth/email-already-in-use", message: "exists" });
        await register();
        expect(domMap.errorMessage.textContent).toBe("An account with this email already exists.");
    });

    it("should show error for auth/invalid-email", async () => {
        mockCreateUser.mockRejectedValue({ code: "auth/invalid-email", message: "invalid" });
        await register();
        expect(domMap.errorMessage.textContent).toBe("Please enter a valid email address.");
    });

    it("should show error for auth/weak-password", async () => {
        mockCreateUser.mockRejectedValue({ code: "auth/weak-password", message: "weak" });
        await register();
        expect(domMap.errorMessage.textContent).toBe("Password must be at least 6 characters.");
    });

    it("should show raw error message for unknown Firebase errors", async () => {
        mockCreateUser.mockRejectedValue({ code: "auth/unknown", message: "Something broke" });
        await register();
        expect(domMap.errorMessage.textContent).toBe("Something broke");
    });

    it("should reset button after a Firebase error", async () => {
        mockCreateUser.mockRejectedValue({ code: "auth/unknown", message: "err" });
        await register();
        expect(domMap.registerBtn.disabled).toBe(false);
        expect(domMap.registerBtnText.textContent).toBe("Create Account");
    });
});

// ==========================================

describe("Register — window.togglePassword", () => {

    beforeEach(() => buildRegisterDom());

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
});

// ==========================================

describe("Register — window.goToLogin", () => {

    beforeEach(() => { _href = ""; });

    it("should redirect to index.html", () => {
        goToLogin();
        expect(global.location.href).toBe("index.html");
    });
});

// ==========================================

describe("Register — window.cancelVerification", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        buildRegisterDom();
    });

    it("should hide the verify overlay", async () => {
        domMap.verifyOverlay.style.display = "flex";
        mockDeleteUser.mockResolvedValue();
        await cancelVerification();
        expect(domMap.verifyOverlay.style.display).toBe("none");
    });

    it("should call clearInterval to stop polling", async () => {
        mockDeleteUser.mockResolvedValue();
        await cancelVerification();
        expect(global.clearInterval).toHaveBeenCalled();
    });

    it("should call deleteUser to clean up the unverified account", async () => {
        mockDeleteUser.mockResolvedValue();
        // Trigger register first to set currentUser
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();
        await register();

        await cancelVerification();
        expect(mockDeleteUser).toHaveBeenCalledWith(mockUser);
    });

    it("should not throw if deleteUser fails", async () => {
        mockDeleteUser.mockRejectedValue(new Error("delete failed"));
        await expect(cancelVerification()).resolves.not.toThrow();
    });
});

// ==========================================

describe("Register — window.resendVerification", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        buildRegisterDom();
    });

    it("should call sendEmailVerification and show Sent! temporarily", async () => {
        // Set currentUser via a register flow
        const mockUser = { uid: "uid-1", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();
        await register();

        vi.useFakeTimers();
        mockSendVerification.mockResolvedValue();
        await resendVerification();

        expect(domMap.resendBtnText.textContent).toBe("Sent!");

        vi.advanceTimersByTime(3000);
        expect(domMap.resendBtnText.textContent).toBe("Resend email");
        vi.useRealTimers();
    });

    it("should show 'Try again later' when resend fails", async () => {
        const mockUser = { uid: "uid-2", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification
            .mockResolvedValueOnce()   // first call: during register
            .mockRejectedValueOnce(new Error("rate limit")); // second call: resend
        await register();

        vi.useFakeTimers();
        await resendVerification();

        expect(domMap.resendBtnText.textContent).toBe("Try again later");
        vi.advanceTimersByTime(3000);
        expect(domMap.resendBtnText.textContent).toBe("Resend email");
        vi.useRealTimers();
    });
});

// ==========================================

describe("Register — window.proceedAfterVerify", () => {

    beforeEach(() => {
        vi.clearAllMocks();
        buildRegisterDom();
    });

    it("should call setDoc to save pending user data to Firestore", async () => {
        // Run register to populate pendingUserData
        const mockUser = { uid: "uid-99", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();
        await register();

        mockSetDoc.mockResolvedValue();
        await proceedAfterVerify();

        expect(mockSetDoc).toHaveBeenCalledTimes(1);
        const savedData = mockSetDoc.mock.calls[0][1];
        expect(savedData.uid).toBe("uid-99");
        expect(savedData.name).toBe("Alice");
        expect(savedData.role).toBe("user");
    });

    it("should hide the verify overlay after proceeding", async () => {
        const mockUser = { uid: "uid-99", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();
        await register();

        domMap.verifyOverlay.style.display = "flex";
        mockSetDoc.mockResolvedValue();
        await proceedAfterVerify();

        expect(domMap.verifyOverlay.style.display).toBe("none");
    });

    it("should not throw if setDoc fails", async () => {
        const mockUser = { uid: "uid-99", emailVerified: false, reload: vi.fn() };
        mockCreateUser.mockResolvedValue({ user: mockUser });
        mockSendVerification.mockResolvedValue();
        await register();

        mockSetDoc.mockRejectedValue(new Error("Firestore error"));
        await expect(proceedAfterVerify()).resolves.not.toThrow();
    });
});