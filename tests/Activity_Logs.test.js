import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    fetchLogsLogic,
    filterLogsLogic,
    sortLogsLogic,
    paginateLogsLogic,
    getLogBadgeClass,
    checkAdminRole,
    doSignOut
} from "./Activity_Logs.js";

import { signOut } from "firebase/auth";

const { mockGetDocs, mockGetDoc, mockDoc, mockCollection, mockQuery, mockOrderBy } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockQuery: vi.fn(),
    mockOrderBy: vi.fn()
}));

vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    query: mockQuery,
    orderBy: mockOrderBy,
    getDocs: mockGetDocs,
    doc: mockDoc,
    getDoc: mockGetDoc
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

// Helper to create a mock Firestore timestamp
const mockTimestamp = (isoString) => ({
    toDate: () => new Date(isoString)
});

describe("Activity Logs Logic", () => {

    beforeEach(() => vi.clearAllMocks());

    // ─── fetchLogsLogic ───────────────────────────────────────────────────────
    describe("fetchLogsLogic", () => {
        it("should fetch and format logs correctly", async () => {
            const mockData = [
                {
                    id: "log1",
                    data: () => ({
                        action: "Added Product",
                        target: "Gaming Chair",
                        user: "admin@test.com",
                        timestamp: mockTimestamp("2024-01-15T10:00:00.000Z")
                    })
                },
                {
                    id: "log2",
                    data: () => ({
                        action: "Deleted Product",
                        target: "Old Item",
                        user: "user@test.com",
                        timestamp: null
                    })
                }
            ];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });

            const logs = await fetchLogsLogic({});
            expect(logs).toHaveLength(2);
            expect(logs[0].action).toBe("Added Product");
            expect(logs[0].id).toBe("log1");
            expect(logs[1].timestamp).toBeNull();
        });

        it("should default missing fields to empty strings / 'Admin'", async () => {
            const mockData = [{ id: "l1", data: () => ({}) }];
            mockGetDocs.mockResolvedValue({ forEach: (cb) => mockData.forEach(cb) });

            const logs = await fetchLogsLogic({});
            expect(logs[0].action).toBe('');
            expect(logs[0].user).toBe('Admin');
        });

        it("should return empty array when no logs exist", async () => {
            mockGetDocs.mockResolvedValue({ forEach: () => {} });
            const logs = await fetchLogsLogic({});
            expect(logs).toHaveLength(0);
        });
    });

    // ─── filterLogsLogic ──────────────────────────────────────────────────────
    describe("filterLogsLogic", () => {
        const logs = [
            { action: "Added Product",   target: "Laptop",       user: "alice@test.com", timestamp: null },
            { action: "Deleted Product", target: "Old Mouse",    user: "bob@test.com",   timestamp: null },
            { action: "Updated Product", target: "Gaming Chair", user: "alice@test.com", timestamp: null }
        ];

        it("should filter by action keyword", () => {
            const result = filterLogsLogic(logs, "deleted");
            expect(result).toHaveLength(1);
            expect(result[0].target).toBe("Old Mouse");
        });

        it("should filter by target keyword", () => {
            const result = filterLogsLogic(logs, "laptop");
            expect(result).toHaveLength(1);
        });

        it("should filter by user email", () => {
            const result = filterLogsLogic(logs, "alice");
            expect(result).toHaveLength(2);
        });

        it("should return all logs when search is empty", () => {
            expect(filterLogsLogic(logs, "")).toHaveLength(3);
        });

        it("should return empty array when nothing matches", () => {
            expect(filterLogsLogic(logs, "zzznomatch")).toHaveLength(0);
        });

        it("should be case insensitive", () => {
            expect(filterLogsLogic(logs, "ADDED")).toHaveLength(1);
        });
    });

    // ─── sortLogsLogic ────────────────────────────────────────────────────────
    describe("sortLogsLogic", () => {
        const logs = [
            { action: "A", timestamp: "2024-01-01T00:00:00.000Z" },
            { action: "B", timestamp: "2024-03-01T00:00:00.000Z" },
            { action: "C", timestamp: "2024-02-01T00:00:00.000Z" }
        ];

        it("should sort descending (newest first) by default", () => {
            const sorted = sortLogsLogic(logs, 'desc');
            expect(sorted[0].action).toBe("B");
            expect(sorted[2].action).toBe("A");
        });

        it("should sort ascending (oldest first)", () => {
            const sorted = sortLogsLogic(logs, 'asc');
            expect(sorted[0].action).toBe("A");
            expect(sorted[2].action).toBe("B");
        });

        it("should not mutate the original array", () => {
            const original = [...logs];
            sortLogsLogic(logs, 'asc');
            expect(logs[0].action).toBe(original[0].action);
        });
    });

    // ─── paginateLogsLogic ────────────────────────────────────────────────────
    describe("paginateLogsLogic", () => {
        const logs = Array.from({ length: 25 }, (_, i) => ({ action: `Log ${i + 1}` }));

        it("should return the correct page of results", () => {
            const { rows } = paginateLogsLogic(logs, 1, 10);
            expect(rows).toHaveLength(10);
            expect(rows[0].action).toBe("Log 1");
        });

        it("should return partial last page correctly", () => {
            const { rows } = paginateLogsLogic(logs, 3, 10);
            expect(rows).toHaveLength(5);
        });

        it("should calculate totalPages correctly", () => {
            const { totalPages } = paginateLogsLogic(logs, 1, 10);
            expect(totalPages).toBe(3);
        });

        it("should clamp page to totalPages if page is too large", () => {
            const { currentPage } = paginateLogsLogic(logs, 999, 10);
            expect(currentPage).toBe(3);
        });

        it("should clamp page to 1 if page is 0 or negative", () => {
            const { currentPage } = paginateLogsLogic(logs, 0, 10);
            expect(currentPage).toBe(1);
        });

        it("should return totalPages of 1 for an empty log list", () => {
            const { totalPages, rows } = paginateLogsLogic([], 1, 10);
            expect(totalPages).toBe(1);
            expect(rows).toHaveLength(0);
        });
    });

    // ─── getLogBadgeClass ─────────────────────────────────────────────────────
    describe("getLogBadgeClass", () => {
        it("should return 'green' for add actions", () => {
            expect(getLogBadgeClass("Added Product")).toBe("green");
        });

        it("should return 'red' for delete actions", () => {
            expect(getLogBadgeClass("Deleted Product")).toBe("red");
        });

        it("should return 'orange' for archive actions", () => {
            expect(getLogBadgeClass("Archived Category")).toBe("orange");
        });

        it("should return 'orange' for restore actions", () => {
            expect(getLogBadgeClass("Restore Product")).toBe("orange");
        });

        it("should return 'blue' for update/edit actions", () => {
            expect(getLogBadgeClass("Updated Product")).toBe("blue");
        });

        it("should return 'blue' for unknown actions", () => {
            expect(getLogBadgeClass("Unknown action")).toBe("blue");
        });

        it("should be case insensitive", () => {
            expect(getLogBadgeClass("ADDED PRODUCT")).toBe("green");
        });

        it("should return 'blue' for null/empty input", () => {
            expect(getLogBadgeClass(null)).toBe("blue");
            expect(getLogBadgeClass("")).toBe("blue");
        });
    });

    // ─── checkAdminRole ───────────────────────────────────────────────────────
    describe("checkAdminRole", () => {
        it("should return true for admin", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'admin' }) });
            expect(await checkAdminRole("uid1", {})).toBe(true);
        });

        it("should return false for non-admin", async () => {
            mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ role: 'user' }) });
            expect(await checkAdminRole("uid1", {})).toBe(false);
        });
    });

    describe("Sign Out", () => {
        it("should clear storage and call signOut", async () => {
            // Arrange
            localStorage.setItem("user_session", "test");
            localStorage.setItem("user_uid", "123");
            localStorage.setItem("user_role", "admin");
            sessionStorage.setItem("something", "value");
        
            signOut.mockResolvedValue(); // mock Firebase signOut
        
            // Act
            await doSignOut({}); // pass fake auth instance
        
            // Assert
            expect(localStorage.getItem("user_session")).toBeNull();
            expect(localStorage.getItem("user_uid")).toBeNull();
            expect(localStorage.getItem("user_role")).toBeNull();
            expect(sessionStorage.length).toBe(0);
        
            expect(signOut).toHaveBeenCalled();
        });
    });
});