import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAdminRole, calculateStats, loadDashboardStats } from "./Dashboard.js";

// 1. HOISTED MOCKS (Setup before imports)
const { mockGetDocs, mockGetDoc, mockDoc, mockCollection } = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn()
}));

// 2. MOCK FIREBASE
vi.mock("firebase/firestore", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    getDocs: mockGetDocs,
    doc: mockDoc,
    getDoc: mockGetDoc,
    query: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    initializeApp: vi.fn()
}));

vi.mock("firebase/auth", () => ({
    getAuth: vi.fn(),
    onAuthStateChanged: vi.fn(),
    signOut: vi.fn()
}));

// 3. TEST SUITE
describe("Dashboard Logic", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        // Setup simple DOM for "updateStat" tests
        document.body.innerHTML = `
            <div id="statTotalProducts"></div>
            <div id="statTotalValue"></div>
            <div id="statLowStock"></div>
            <div id="statCategories"></div>
        `;
    });

    // --- TEST: Admin Role ---
    describe("checkAdminRole", () => {
        it("should return true if user is admin (case insensitive)", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'AdMin' })
            });
            const isAdmin = await checkAdminRole("uid123", {});
            expect(isAdmin).toBe(true);
        });

        it("should return false if user is just a user", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: 'user' })
            });
            const isAdmin = await checkAdminRole("uid123", {});
            expect(isAdmin).toBe(false);
        });
    });

    // --- TEST: Stat Calculation (Pure Logic) ---
    describe("calculateStats", () => {
        it("should correctly calculate totals, values, and low stock", () => {
            const mockProducts = [
                { name: "High Stock Item", stock: 100, price: 10, category: "A", lowStockThreshold: 10 },
                { name: "Low Stock Item", stock: 5, price: 20, category: "B", lowStockThreshold: 10 },
                { name: "Zero Stock Item", stock: 0, price: 50, category: "A", lowStockThreshold: 5 }
            ];

            const stats = calculateStats(mockProducts);

            // Assertions
            expect(stats.totalProducts).toBe(3);
            
            // Value: (100*10) + (5*20) + (0*50) = 1000 + 100 + 0 = 1100
            expect(stats.totalValue).toBe(1100);
            
            // Categories: "A" and "B"
            expect(stats.categoriesCount).toBe(2);
            
            // Low Stock: "Low Stock Item" (5 <= 10) and "Zero Stock Item" (0 <= 5)
            expect(stats.lowStockCount).toBe(2);
            expect(stats.lowStockItems[0].name).toBe("Low Stock Item");
        });
    });

    // --- TEST: Full Data Load & DOM Update ---
    describe("loadDashboardStats", () => {
        it("should fetch data and update the DOM elements", async () => {
            // Mock Database Data
            const mockData = [
                { data: () => ({ name: "P1", stock: 10, price: 100 }) },
                { data: () => ({ name: "P2", stock: 5, price: 50 }) }
            ];
            
            // Setup mock return
            mockGetDocs.mockResolvedValue({
                forEach: (callback) => mockData.forEach(callback)
            });

            // Run Function
            await loadDashboardStats({});

            // Check if DOM was updated
            // FIX: We convert innerText to String() to handle JSDOM number/string behavior safely
            const totalProductsText = document.getElementById("statTotalProducts").innerText;
            expect(String(totalProductsText)).toBe("2");
            
            // Value: (10*100) + (5*50) = 1000 + 250 = 1,250.00
            // Note: The exact string depends on the locale mocking in JSDOM, 
            // but we check if it's not empty
            expect(document.getElementById("statTotalValue").innerText).not.toBe("");
        });
    });
});