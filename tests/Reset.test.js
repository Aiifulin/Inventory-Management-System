// tests/Forgot_Password.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePasswordReset } from "./Reset.js";

// --- HOISTED MOCKS ---
const { mockFetchMethods, mockSendReset } = vi.hoisted(() => ({
    mockFetchMethods: vi.fn(),
    mockSendReset: vi.fn()
}));

// --- MOCK FIREBASE ---
vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    fetchSignInMethodsForEmail: mockFetchMethods,
    sendPasswordResetEmail: mockSendReset
}));

describe("Forgot Password Logic", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // TEST 1: Validation
    it("should throw error if email is empty", async () => {
        await expect(handlePasswordReset("", {}))
            .rejects.toThrow("Please enter your email address");
        
        expect(mockFetchMethods).not.toHaveBeenCalled();
    });

    // TEST 2: Email Not Found
    it("should throw error if email does not exist in Firebase", async () => {
        // Mock returning an empty array (no sign-in methods found)
        mockFetchMethods.mockResolvedValue([]); 

        await expect(handlePasswordReset("unknown@user.com", {}))
            .rejects.toThrow("No account found with this email address.");
        
        // Ensure we did NOT send the email
        expect(mockSendReset).not.toHaveBeenCalled();
    });

    // TEST 3: Success Case
    it("should send reset email if account exists", async () => {
        // Mock returning a valid sign-in method
        mockFetchMethods.mockResolvedValue(['password']); 

        const result = await handlePasswordReset("existing@user.com", {});

        expect(mockFetchMethods).toHaveBeenCalledWith({}, "existing@user.com");
        expect(mockSendReset).toHaveBeenCalledWith({}, "existing@user.com");
        expect(result).toBe("Password reset email sent successfully. Check your inbox.");
    });

    // TEST 4: Firebase Specific Error Handling
    it("should handle invalid-email error code", async () => {
        // Simulate Firebase throwing a specific error code
        const firebaseError = new Error("Firebase Error");
        firebaseError.code = "auth/invalid-email";
        
        mockFetchMethods.mockRejectedValue(firebaseError);

        await expect(handlePasswordReset("bad-email", {}))
            .rejects.toThrow("Please enter a valid email address.");
    });
});