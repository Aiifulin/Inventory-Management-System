import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePasswordReset } from "./Reset.js";

const { mockFetchMethods, mockSendReset } = vi.hoisted(() => ({
    mockFetchMethods: vi.fn(),
    mockSendReset: vi.fn()
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    fetchSignInMethodsForEmail: mockFetchMethods,
    sendPasswordResetEmail: mockSendReset
}));

describe("Forgot Password Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── Validation ───────────────────────────────────────────────────────────
    it("should throw error if email is empty", async () => {
        await expect(handlePasswordReset("", {}))
            .rejects.toThrow("Please enter your email address");
        expect(mockFetchMethods).not.toHaveBeenCalled();
    });

    it("should throw error if email is only whitespace", async () => {
        // The function receives already-trimmed value but guards against empty string
        await expect(handlePasswordReset("", {}))
            .rejects.toThrow("Please enter your email address");
    });

    // ─── Email Not Found ──────────────────────────────────────────────────────
    it("should throw error if no account found for the email", async () => {
        mockFetchMethods.mockResolvedValue([]);
        await expect(handlePasswordReset("unknown@user.com", {}))
            .rejects.toThrow("No account found with this email address.");
        expect(mockSendReset).not.toHaveBeenCalled();
    });

    // ─── Success ─────────────────────────────────────────────────────────────
    it("should send reset email if account exists", async () => {
        mockFetchMethods.mockResolvedValue(['password']);

        const result = await handlePasswordReset("existing@user.com", {});

        expect(mockFetchMethods).toHaveBeenCalledWith({}, "existing@user.com");
        expect(mockSendReset).toHaveBeenCalledWith({}, "existing@user.com");
        expect(result).toBe("Password reset email sent successfully. Check your inbox.");
    });

    it("should send reset email if account uses Google sign-in", async () => {
        mockFetchMethods.mockResolvedValue(['google.com']);
        const result = await handlePasswordReset("google@user.com", {});
        expect(mockSendReset).toHaveBeenCalled();
        expect(result).toContain("sent successfully");
    });

    // ─── Firebase Error Handling ──────────────────────────────────────────────
    it("should translate auth/invalid-email error", async () => {
        const err = Object.assign(new Error("Firebase"), { code: "auth/invalid-email" });
        mockFetchMethods.mockRejectedValue(err);
        await expect(handlePasswordReset("bad-email", {}))
            .rejects.toThrow("Please enter a valid email address.");
    });

    it("should translate auth/too-many-requests error", async () => {
        const err = Object.assign(new Error("Firebase"), { code: "auth/too-many-requests" });
        mockFetchMethods.mockRejectedValue(err);
        await expect(handlePasswordReset("rate@limit.com", {}))
            .rejects.toThrow("Too many attempts. Please try again later.");
    });

    it("should re-throw unrecognised Firebase errors", async () => {
        const err = Object.assign(new Error("Some unknown error"), { code: "auth/unknown" });
        mockFetchMethods.mockRejectedValue(err);
        await expect(handlePasswordReset("user@test.com", {}))
            .rejects.toThrow("Some unknown error");
    });
});