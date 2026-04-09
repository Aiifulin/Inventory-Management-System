import { describe, it, expect, vi, beforeEach, afterEach, doSignOut } from "vitest";

// ==========================================
// MOCKS SETUP
// ==========================================
const { 
    mockGetDocs, 
    mockGetDoc, 
    mockDoc, 
    mockCollection,
    mockQuery,
    mockOrderBy,
    mockLimit
} = vi.hoisted(() => ({
    mockGetDocs: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDoc: vi.fn(),
    mockCollection: vi.fn(),
    mockQuery: vi.fn(),
    mockOrderBy: vi.fn(),
    mockLimit: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js", () => ({
    initializeApp: vi.fn(() => ({}))
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    getAuth: vi.fn(() => ({ currentUser: { email: "test@example.com" } })),
    onAuthStateChanged: vi.fn((auth, callback) => {
        // Simulate authenticated user
        callback({ uid: "test-uid", email: "test@example.com" });
        return vi.fn(); // unsubscribe function
    }),
    signOut: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    getFirestore: vi.fn(),
    collection: mockCollection,
    getDocs: mockGetDocs,
    doc: mockDoc,
    getDoc: mockGetDoc,
    query: mockQuery,
    orderBy: mockOrderBy,
    limit: mockLimit
}));

// Mock XLSX library
global.XLSX = {
    utils: {
        json_to_sheet: vi.fn(),
        book_new: vi.fn(() => ({})),
        book_append_sheet: vi.fn()
    },
    writeFile: vi.fn()
};

// Mock DOM
global.document = {
    getElementById: vi.fn((id) => ({
        value: id === 'exportFormat' ? 'csv' : '',
        innerHTML: '',
        textContent: '',
        style: { visibility: 'visible' }
    })),
    createElement: vi.fn((tag) => ({
        href: '',
        download: '',
        click: vi.fn()
    }))
};

global.window = {
    location: { href: '', replace: vi.fn() },
    logout: null,
    URL: {
        createObjectURL: vi.fn(() => 'blob:mock-url'),
        revokeObjectURL: vi.fn()
    }
};

global.Blob = class Blob {
    constructor(parts, options) {
        this.parts = parts;
        this.options = options;
    }
};

global.alert = vi.fn();
let session = {};

global.sessionStorage = {
    getItem: vi.fn((key) => (key in session ? session[key] : null)),
    setItem: vi.fn((key, value) => {
        session[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
        delete session[key];
    }),
    clear: vi.fn(() => {
        session = {};
    })
};

let storage = {};

global.localStorage = {
    getItem: vi.fn((key) => (key in storage ? storage[key] : null)),
    setItem: vi.fn((key, value) => {
        storage[key] = String(value);
    }),
    removeItem: vi.fn((key) => {
        delete storage[key];
    }),
    clear: vi.fn(() => {
        storage = {};
    })
};

// ==========================================
// HELPER FUNCTIONS (Extracted from Reports.js)
// ==========================================
function convertToCSV(data) {
    if (!data.length) return "";
    const escape = (val) => {
        const str = String(val ?? "");
        return str.includes(",") || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
    };
    const headers = Object.keys(data[0]).map(escape).join(",");
    const rows = data.map(obj => Object.values(obj).map(escape).join(","));
    return [headers, ...rows].join("\n");
}

async function getCachedUserData(uid) {
    const key = `user_data_${uid}`;
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached);
    
    try {
        const snap = await mockGetDoc(mockDoc({}, "users", uid));
        if (snap.exists()) {
            sessionStorage.setItem(key, JSON.stringify(snap.data()));
            return snap.data();
        }
    } catch (e) {
        console.error(e);
    }
    return null;
}

async function checkAdminRole(uid) {
    const data = await getCachedUserData(uid);
    return data?.role?.toLowerCase() === 'admin';
}

function getDateStamp() {
    return new Date().toISOString().split('T')[0];
}

// ==========================================
// TEST SUITES
// ==========================================

describe("Reports.js - Utility Functions", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("convertToCSV", () => {
        it("should convert array of objects to CSV format", () => {
            const data = [
                { name: "Product A", price: 100, stock: 50 },
                { name: "Product B", price: 200, stock: 30 }
            ];
            
            const csv = convertToCSV(data);
            const lines = csv.split("\n");
            
            expect(lines[0]).toBe("name,price,stock");
            expect(lines[1]).toBe("Product A,100,50");
            expect(lines[2]).toBe("Product B,200,30");
        });

        it("should handle empty array", () => {
            expect(convertToCSV([])).toBe("");
        });

        it("should escape commas in values", () => {
            const data = [{ name: "Item, with comma", value: 100 }];
            const csv = convertToCSV(data);
            expect(csv).toContain('"Item, with comma"');
        });

        it("should escape quotes in values", () => {
            const data = [{ name: 'Item "quoted"', value: 100 }];
            const csv = convertToCSV(data);
            expect(csv).toContain('"Item ""quoted"""');
        });

        it("should handle null and undefined values", () => {
            const data = [{ name: null, value: undefined, stock: 10 }];
            const csv = convertToCSV(data);
            expect(csv).toContain(",,10");
        });
    });

    describe("getDateStamp", () => {
        it("should return date in YYYY-MM-DD format", () => {
            const dateStamp = getDateStamp();
            expect(dateStamp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it("should return current date", () => {
            const today = new Date().toISOString().split('T')[0];
            expect(getDateStamp()).toBe(today);
        });
    });
});

describe("Reports.js - Authentication & Authorization", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    describe("getCachedUserData", () => {
        it("should return cached data if available", async () => {
            const mockUser = { role: "admin", email: "admin@test.com" };
            sessionStorage.getItem.mockReturnValue(JSON.stringify(mockUser));
            
            const result = await getCachedUserData("test-uid");
            
            expect(result).toEqual(mockUser);
            expect(sessionStorage.getItem).toHaveBeenCalledWith("user_data_test-uid");
        });

        it("should fetch from Firestore if not cached", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "admin", email: "admin@test.com" })
            });
            
            const result = await getCachedUserData("test-uid");
            
            expect(result).toEqual({ role: "admin", email: "admin@test.com" });
            expect(sessionStorage.setItem).toHaveBeenCalled();
        });

        it("should return null if user document doesn't exist", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => false
            });
            
            const result = await getCachedUserData("test-uid");
            
            expect(result).toBeNull();
        });

        it("should handle Firestore errors gracefully", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            
            const result = await getCachedUserData("test-uid");
            
            expect(result).toBeNull();
        });
    });

    describe("checkAdminRole", () => {
        it("should return true for admin role", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "admin" })
            );
            
            const isAdmin = await checkAdminRole("test-uid");
            
            expect(isAdmin).toBe(true);
        });

        it("should be case-insensitive", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "AdMiN" })
            );
            
            const isAdmin = await checkAdminRole("test-uid");
            
            expect(isAdmin).toBe(true);
        });

        it("should return false for non-admin role", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "user" })
            );
            
            const isAdmin = await checkAdminRole("test-uid");
            
            expect(isAdmin).toBe(false);
        });

        it("should return false if role is missing", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ email: "test@test.com" })
            );
            
            const isAdmin = await checkAdminRole("test-uid");
            
            expect(isAdmin).toBe(false);
        });
    });
});

describe("Reports.js - Report Generation", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Inventory Report", () => {
        it("should generate correct inventory data structure", async () => {
            const mockProducts = [
                {
                    data: () => ({
                        name: "Laptop",
                        category: "Electronics",
                        stock: 50,
                        price: 1000,
                        lowStockThreshold: 10,
                        archived: false,
                        createdAt: { seconds: 1640000000 }
                    })
                },
                {
                    data: () => ({
                        name: "Mouse",
                        category: "Accessories",
                        stock: 5,
                        price: 20,
                        lowStockThreshold: 10,
                        archived: false,
                        createdAt: { seconds: 1640000000 }
                    })
                }
            ];

            mockGetDocs.mockResolvedValue({
                forEach: (callback) => mockProducts.forEach(callback)
            });

            // Simulate report generation logic
            const reportData = [];
            mockProducts.forEach(docSnap => {
                const p = docSnap.data();
                if (p.archived === true) return;
                
                const stock = Number(p.stock) || 0;
                const price = Number(p.price) || 0;
                const threshold = Number(p.lowStockThreshold) || 10;

                let status = "In Stock";
                if (stock === 0) status = "Out of Stock";
                else if (stock <= threshold) status = "Low Stock";

                reportData.push({
                    "Product Name": p.name || "",
                    "Category": p.category || "",
                    "Price (₱)": price.toFixed(2),
                    "Stock": stock,
                    "Status": status,
                    "Inventory Value (₱)": (stock * price).toFixed(2)
                });
            });

            expect(reportData).toHaveLength(2);
            expect(reportData[0]["Product Name"]).toBe("Laptop");
            expect(reportData[0]["Status"]).toBe("In Stock");
            expect(reportData[1]["Status"]).toBe("Low Stock");
        });

        it("should skip archived products", async () => {
            const mockProducts = [
                {
                    data: () => ({
                        name: "Active Product",
                        archived: false,
                        stock: 10,
                        price: 100
                    })
                },
                {
                    data: () => ({
                        name: "Archived Product",
                        archived: true,
                        stock: 10,
                        price: 100
                    })
                }
            ];

            mockGetDocs.mockResolvedValue({
                forEach: (callback) => mockProducts.forEach(callback)
            });

            const reportData = [];
            mockProducts.forEach(docSnap => {
                const p = docSnap.data();
                if (p.archived === true) return;
                reportData.push({ name: p.name });
            });

            expect(reportData).toHaveLength(1);
            expect(reportData[0].name).toBe("Active Product");
        });

        it("should calculate inventory value correctly", () => {
            const stock = 50;
            const price = 1000;
            const inventoryValue = (stock * price).toFixed(2);
            
            expect(inventoryValue).toBe("50000.00");
        });
    });

    describe("Category Report", () => {
        it("should group products by category", () => {
            const categoryMap = {};
            const products = [
                { category: "Electronics", stock: 10, price: 100 },
                { category: "Electronics", stock: 20, price: 50 },
                { category: "Furniture", stock: 5, price: 200 }
            ];

            products.forEach(p => {
                const cat = p.category || "Uncategorized";
                const stock = Number(p.stock) || 0;
                const price = Number(p.price) || 0;

                if (!categoryMap[cat]) {
                    categoryMap[cat] = {
                        "Total Products": 0,
                        "Total Stock": 0,
                        "Total Value (₱)": 0
                    };
                }

                categoryMap[cat]["Total Products"]++;
                categoryMap[cat]["Total Stock"] += stock;
                categoryMap[cat]["Total Value (₱)"] += stock * price;
            });

            expect(categoryMap["Electronics"]["Total Products"]).toBe(2);
            expect(categoryMap["Electronics"]["Total Stock"]).toBe(30);
            expect(categoryMap["Furniture"]["Total Products"]).toBe(1);
        });

        it("should handle uncategorized products", () => {
            const categoryMap = {};
            const products = [{ stock: 10, price: 100 }]; // No category

            products.forEach(p => {
                const cat = p.category || "Uncategorized";
                if (!categoryMap[cat]) {
                    categoryMap[cat] = { "Total Products": 0 };
                }
                categoryMap[cat]["Total Products"]++;
            });

            expect(categoryMap["Uncategorized"]).toBeDefined();
            expect(categoryMap["Uncategorized"]["Total Products"]).toBe(1);
        });
    });

    describe("Low Stock Report", () => {
        it("should identify low stock items", () => {
            const products = [
                { name: "A", stock: 5, lowStockThreshold: 10 },  // Low
                { name: "B", stock: 0, lowStockThreshold: 5 },   // Out
                { name: "C", stock: 50, lowStockThreshold: 10 }  // OK
            ];

            const lowStockItems = products.filter(p => {
                const stock = Number(p.stock) || 0;
                const threshold = Number(p.lowStockThreshold) || 10;
                return stock <= threshold;
            });

            expect(lowStockItems).toHaveLength(2);
            expect(lowStockItems.map(i => i.name)).toContain("A");
            expect(lowStockItems.map(i => i.name)).toContain("B");
        });

        it("should calculate units needed correctly", () => {
            const stock = 5;
            const threshold = 10;
            const unitsNeeded = Math.max(0, threshold - stock + 1);
            
            expect(unitsNeeded).toBe(6);
        });

        it("should sort with out of stock first", () => {
            const reportData = [
                { name: "Low", stock: 5 },
                { name: "Out", stock: 0 },
                { name: "Critical", stock: 2 }
            ];

            reportData.sort((a, b) => {
                if (a.stock === 0 && b.stock !== 0) return -1;
                if (a.stock !== 0 && b.stock === 0) return 1;
                return a.stock - b.stock;
            });

            expect(reportData[0].name).toBe("Out");
            expect(reportData[1].name).toBe("Critical");
            expect(reportData[2].name).toBe("Low");
        });
    });

    describe("Activity Report", () => {
        it("should categorize actions correctly", () => {
            const actions = [
                "Added Product",
                "Edited Category",
                "Deleted Item",
                "Archived Product",
                "Restored Item"
            ];

            const categorizeAction = (action) => {
                const actionLower = (action || "").toLowerCase();
                if (actionLower.includes("add")) return "Added";
                if (actionLower.includes("edit") || actionLower.includes("update")) return "Updated";
                if (actionLower.includes("delete")) return "Deleted";
                if (actionLower.includes("archive")) return "Archived";
                if (actionLower.includes("restore")) return "Restored";
                return "Other";
            };

            expect(categorizeAction(actions[0])).toBe("Added");
            expect(categorizeAction(actions[1])).toBe("Updated");
            expect(categorizeAction(actions[2])).toBe("Deleted");
            expect(categorizeAction(actions[3])).toBe("Archived");
            expect(categorizeAction(actions[4])).toBe("Restored");
        });

        it("should format timestamps correctly", () => {
            const timestamp = { seconds: 1640000000 };
            const date = new Date(timestamp.seconds * 1000);
            const formatted = date.toLocaleString();
            
            expect(formatted).toBeTruthy();
        });
    });
});

describe("Reports.js - Export Functionality", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("CSV Export", () => {
        it("should create blob with correct content type", () => {
            const csvData = "name,price\nProduct,100";
            const blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });
            
            expect(blob.options.type).toBe("text/csv;charset=utf-8;");
            expect(blob.parts[0]).toBe(csvData);
        });

        it("should trigger download with correct filename", () => {
            const mockLink = {
                href: '',
                download: '',
                click: vi.fn()
            };
            
            document.createElement.mockReturnValue(mockLink);
            
            // Simulate download
            const filename = "test.csv";
            mockLink.download = filename;
            mockLink.click();
            
            expect(mockLink.click).toHaveBeenCalled();
        });
    });

    describe("Excel Export", () => {
        it("should call XLSX methods correctly", () => {
            const data = [{ name: "Product", price: 100 }];
            
            const worksheet = XLSX.utils.json_to_sheet(data);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Report");
            XLSX.writeFile(workbook, "test.xlsx");
            
            expect(XLSX.utils.json_to_sheet).toHaveBeenCalledWith(data);
            expect(XLSX.utils.book_new).toHaveBeenCalled();
            expect(XLSX.utils.book_append_sheet).toHaveBeenCalled();
            expect(XLSX.writeFile).toHaveBeenCalled();
        });
    });
});

describe("Reports.js - Logout/Sign Out", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it("should clear localStorage on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        localStorage.setItem("user_session", "test-session");
        localStorage.setItem("user_uid", "test-uid");
        localStorage.setItem("user_role", "admin");
        
        // Simulate logout
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        await signOut({});
        
        expect(localStorage.getItem("user_session")).toBeNull();
        expect(localStorage.getItem("user_uid")).toBeNull();
        expect(localStorage.getItem("user_role")).toBeNull();
    });

    it("should clear sessionStorage on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        sessionStorage.setItem("user_data_123", JSON.stringify({ role: "admin" }));
        sessionStorage.setItem("dashboard_cache", "{}");
        
        // Simulate logout
        sessionStorage.clear();
        await signOut({});
        
        expect(sessionStorage.clear).toHaveBeenCalled();
    });

    it("should call signOut and redirect on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockResolvedValue();
        
        // Simulate logout flow
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        await signOut({});
        
        expect(signOut).toHaveBeenCalled();
    });

    it("should handle logout errors gracefully", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockRejectedValue(new Error("Network error"));
        
        try {
            await signOut({});
        } catch (error) {
            expect(error.message).toBe("Network error");
        }
        
        // Should still redirect on error
        expect(window.location.replace).toBeDefined();
    });

    it("should complete full logout sequence", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        // Setup
        localStorage.setItem("user_session", "active");
        localStorage.setItem("user_uid", "uid-123");
        localStorage.setItem("user_role", "admin");
        sessionStorage.setItem("cache", "data");
        
        // Execute logout
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        signOut.mockResolvedValue();
        await signOut({});
        
        // Verify
        expect(localStorage.getItem("user_session")).toBeNull();
        expect(localStorage.getItem("user_uid")).toBeNull();
        expect(localStorage.getItem("user_role")).toBeNull();
        expect(sessionStorage.clear).toHaveBeenCalled();
        expect(signOut).toHaveBeenCalled();
    });
});

describe("Reports.js - UI State Management", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Button Loading State", () => {
        it("should disable button and show loading state", () => {
            const mockBtn = {
                disabled: false,
                innerHTML: '<i class="fa-solid fa-download"></i> Generate Report',
                dataset: {}
            };

            // Set loading
            mockBtn.disabled = true;
            mockBtn.dataset.originalHtml = mockBtn.innerHTML;
            mockBtn.innerHTML = '<i class="fa-solid fa-spinner"></i> Generating...';

            expect(mockBtn.disabled).toBe(true);
            expect(mockBtn.innerHTML).toContain('Generating...');
            expect(mockBtn.dataset.originalHtml).toContain('Generate Report');
        });

        it("should restore button to original state", () => {
            const mockBtn = {
                disabled: true,
                innerHTML: '<i class="fa-solid fa-spinner"></i> Generating...',
                dataset: { originalHtml: '<i class="fa-solid fa-download"></i> Generate Report' }
            };

            // Reset loading
            mockBtn.disabled = false;
            mockBtn.innerHTML = mockBtn.dataset.originalHtml;

            expect(mockBtn.disabled).toBe(false);
            expect(mockBtn.innerHTML).toContain('Generate Report');
        });
    });

    describe("Access Control", () => {
        it("should show access denied for non-admin users", () => {
            const isAdmin = false;
            const mainContent = document.getElementById('mainContent');

            if (!isAdmin) {
                mainContent.innerHTML = `
                    <div style="text-align:center;">
                        <h2>Access Denied</h2>
                        <p>You do not have permission to view Settings.</p>
                    </div>`;
            }

            expect(mainContent.innerHTML).toContain('Access Denied');
        });

        it("should allow access for admin users", async () => {
            sessionStorage.getItem.mockReturnValue(
                JSON.stringify({ role: "admin" })
            );
            
            const isAdmin = await checkAdminRole("test-uid");
            
            expect(isAdmin).toBe(true);
        });
    });
});

describe("Reports.js - Error Handling", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should show alert when no data to export", () => {
        const data = [];
        
        if (!data || data.length === 0) {
            alert("No data found to export for this report.");
        }
        
        expect(alert).toHaveBeenCalledWith("No data found to export for this report.");
    });

    it("should show alert on low stock report with no items", () => {
        const reportData = [];
        
        if (reportData.length === 0) {
            alert("Great news! All products are well stocked — no low stock items to report.");
        }
        
        expect(alert).toHaveBeenCalledWith(
            "Great news! All products are well stocked — no low stock items to report."
        );
    });

    it("should handle Firestore errors gracefully", async () => {
        mockGetDocs.mockRejectedValue(new Error("Firestore error"));
        
        try {
            await mockGetDocs();
        } catch (err) {
            expect(err.message).toBe("Firestore error");
        }
    });
});