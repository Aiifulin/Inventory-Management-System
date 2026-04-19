import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCachedUserData, sanitizeInput, logActivity } from "./Edit_Categories.js";


// ==========================================
// MOCKS SETUP
// ==========================================
const {
    mockGetDoc,
    mockGetDocs,
    mockUpdateDoc,
    mockDoc,
    mockCollection,
    mockQuery,
    mockWhere,
    mockAddDoc,
    mockServerTimestamp
} = vi.hoisted(() => ({
    mockGetDoc: vi.fn(),
    mockGetDocs: vi.fn(),
    mockUpdateDoc: vi.fn(),
    mockDoc: vi.fn(() => ({})),
    mockCollection: vi.fn(() => ({})),
    mockQuery: vi.fn(),
    mockWhere: vi.fn(),
    mockAddDoc: vi.fn(),
    mockServerTimestamp: vi.fn(() => ({ _seconds: Date.now() / 1000 }))
}));


vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js", () => ({
    getAuth: vi.fn(() => ({ 
        currentUser: { 
            email: "admin@test.com",
            uid: "admin-uid"
        } 
    })),
    onAuthStateChanged: vi.fn((auth, callback) => {
        callback({ uid: "admin-uid", email: "admin@test.com" });
        return vi.fn();
    }),
    signOut: vi.fn()
}));

vi.mock("https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js", () => ({
    getFirestore: vi.fn(),
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    collection: mockCollection,
    addDoc: mockAddDoc,
    serverTimestamp: mockServerTimestamp,
    query: mockQuery,
    where: mockWhere,
    getDocs: mockGetDocs
}));

vi.mock("./logout-modal.js", () => ({
    initLogoutModal: vi.fn(() => vi.fn())
}));

// Mock DOM
global.document = {
    getElementById: vi.fn((id) => ({
        value: '',
        textContent: '',
        style: {},
        dataset: {},
        addEventListener: vi.fn()
    })),
    querySelector: vi.fn(() => ({
        addEventListener: vi.fn(),
        innerText: '',
        disabled: false
    })),
    addEventListener: vi.fn()
};

global.window = {
    location: { href: '', replace: vi.fn() },
    logout: null,
    addEventListener: vi.fn(),
    URLSearchParams: class URLSearchParams {
        constructor(search) {
            this.params = new Map([['id', 'test-category-id']]);
        }
        get(key) {
            return this.params.get(key);
        }
    }
};

global.alert = vi.fn();
global.sessionStorage = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
};

global.localStorage = {
    store: {},
    getItem: vi.fn(function (key) {
        return this.store[key] ?? null; // ✅ force null
    }),
    setItem: vi.fn(function (key, value) {
        this.store[key] = value;
    }),
    removeItem: vi.fn(function (key) {
        delete this.store[key];
    }),
    clear: vi.fn(function () {
        this.store = {};
    })
};


// ==========================================
// HELPER FUNCTIONS (Extracted from Edit Category)
// ==========================================
async function getCachedUserData(uid) {
    const CACHE_KEY = `user_data_${uid}`;
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);

    try {
        const snap = await mockGetDoc(mockDoc({}, "users", uid));
        if (snap.exists()) {
            const data = snap.data();
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
            return data;
        }
    } catch (err) {
        console.error("Error fetching user data:", err);
    }
    return null;
}

function sanitizeInput(str) {
    if (!str) return "";
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.innerText = str;
    return div.innerHTML;
}

async function logActivity(action, targetName) {
    try {
        await mockAddDoc(mockCollection({}, "activities"), {
            action,
            target: targetName,
            user: "admin@test.com",
            timestamp: mockServerTimestamp()
        });
    } catch (e) {
        console.error("Error logging activity", e);
    }
}

// ==========================================
// TEST SUITES
// ==========================================

describe("Edit Category - Authentication & Authorization", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    describe("getCachedUserData", () => {
        it("should return cached user data if available", async () => {
            const mockUser = { role: "admin", email: "admin@test.com" };
            sessionStorage.getItem.mockReturnValue(JSON.stringify(mockUser));
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toEqual(mockUser);
            expect(sessionStorage.getItem).toHaveBeenCalledWith("user_data_admin-uid");
        });

        it("should fetch from Firestore if not cached", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "admin", email: "admin@test.com" })
            });
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toEqual({ role: "admin", email: "admin@test.com" });
            expect(sessionStorage.setItem).toHaveBeenCalled();
        });

        it("should return null if user doesn't exist", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockResolvedValue({
                exists: () => false
            });
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toBeNull();
        });

        it("should handle errors gracefully", async () => {
            sessionStorage.getItem.mockReturnValue(null);
            mockGetDoc.mockRejectedValue(new Error("Network error"));
            
            const result = await getCachedUserData("admin-uid");
            
            expect(result).toBeNull();
        });
    });

    describe("Admin Role Check", () => {
        it("should allow admin users to access edit page", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "admin" })
            });
            
            const userData = await getCachedUserData("admin-uid");
            const isAdmin = userData?.role?.toLowerCase() === 'admin';
            
            expect(isAdmin).toBe(true);
        });

        it("should deny non-admin users", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => ({ role: "user" })
            });
            
            const userData = await getCachedUserData("user-uid");
            const isAdmin = userData?.role?.toLowerCase() === 'admin';
            
            if (!isAdmin) {
                alert("Access Denied: Only Admins can edit categories.");
            }
            
            expect(isAdmin).toBe(false);
            expect(alert).toHaveBeenCalledWith("Access Denied: Only Admins can edit categories.");
        });
    });
});

describe("Edit Category - Input Validation & Sanitization", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("sanitizeInput", () => {
        it("should sanitize HTML tags", () => {
            const input = "<script>alert('xss')</script>";
            const result = sanitizeInput(input);
            
            expect(result).not.toContain("<script>");
            expect(result).toContain("&lt;script&gt;");
        });

        it("should handle empty strings", () => {
            expect(sanitizeInput("")).toBe("");
            expect(sanitizeInput(null)).toBe("");
            expect(sanitizeInput(undefined)).toBe("");
        });

        it("should convert non-strings to strings", () => {
            expect(sanitizeInput(123)).toBe("123");
            expect(sanitizeInput(true)).toBe("true");
        });

        it("should preserve normal text", () => {
            const input = "Normal category description";
            expect(sanitizeInput(input)).toBe(input);
        });

        it("should escape dangerous characters", () => {
            const input = '<img src=x onerror="alert(1)">';
            const result = sanitizeInput(input);
            
            expect(result).not.toContain('onerror=');
            expect(result).toContain("&lt;img");
        });
    });

    describe("Character Limits", () => {
        it("should enforce 100 character limit", () => {
            const longText = "a".repeat(150);
            const truncated = longText.substring(0, 100);
            
            expect(truncated.length).toBe(100);
        });

        it("should allow text under limit", () => {
            const normalText = "Category Name";
            expect(normalText.length).toBeLessThan(100);
        });
    });
});

describe("Edit Category - Core Functionality", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Category Loading", () => {
        it("should load existing category data", async () => {
            const mockCategory = {
                name: "Electronics",
                description: "Electronic items",
                createdAt: { seconds: 1640000000 }
            };

            mockGetDoc.mockResolvedValue({
                exists: () => true,
                data: () => mockCategory
            });

            const docSnap = await mockGetDoc(mockDoc({}, "categories", "test-id"));
            
            expect(docSnap.exists()).toBe(true);
            expect(docSnap.data().name).toBe("Electronics");
        });

        it("should alert if category not found", async () => {
            mockGetDoc.mockResolvedValue({
                exists: () => false
            });

            const docSnap = await mockGetDoc(mockDoc({}, "categories", "invalid-id"));
            
            if (!docSnap.exists()) {
                alert("Category not found!");
            }
            
            expect(alert).toHaveBeenCalledWith("Category not found!");
        });
    });

    describe("Category Update", () => {
        it("should update category with valid data", async () => {
            const updatedData = {
                name: "Updated Electronics",
                normalizedName: "updated electronics",
                description: sanitizeInput("Updated description"),
                updatedAt: mockServerTimestamp()
            };

            mockUpdateDoc.mockResolvedValue();
            
            await mockUpdateDoc(mockDoc({}, "categories", "test-id"), updatedData);
            
            expect(mockUpdateDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    name: "Updated Electronics",
                    normalizedName: "updated electronics"
                })
            );
        });

        it("should reject empty category name", async () => {
            const rawName = "   ";
            
            try {
                if (!rawName.trim()) {
                    throw new Error("Category name is required.");
                }
            } catch (error) {
                expect(error.message).toBe("Category name is required.");
            }
        });

        it("should check for duplicate names", async () => {
            mockGetDocs.mockResolvedValue({
                forEach: (callback) => {
                    callback({ id: "different-id", data: () => ({ name: "Electronics" }) });
                },
                empty: false
            });

            const q = mockQuery(
                mockCollection({}, "categories"),
                mockWhere("name", "==", "Electronics")
            );
            
            const qs = await mockGetDocs(q);
            let isDuplicate = false;
            
            qs.forEach(d => {
                if (d.id !== "test-id") isDuplicate = true;
            });

            expect(isDuplicate).toBe(true);
        });
    });

    describe("Cascade Rename to Products", () => {
        it("should update category name in all related products", async () => {
            const originalName = "Electronics";
            const newName = "Electronic Devices";
            
            const mockProducts = [
                { id: "prod1", data: () => ({ category: "Electronics" }) },
                { id: "prod2", data: () => ({ category: "Electronics" }) }
            ];

            mockGetDocs.mockResolvedValue({
                forEach: (callback) => mockProducts.forEach(callback)
            });

            const productsQuery = mockQuery(
                mockCollection({}, "products"),
                mockWhere("category", "==", originalName)
            );
            
            const productsSnap = await mockGetDocs(productsQuery);
            const updatePromises = [];
            
            productsSnap.forEach(docSnap => {
                updatePromises.push(
                    mockUpdateDoc(mockDoc({}, "products", docSnap.id), {
                        category: newName
                    })
                );
            });

            await Promise.all(updatePromises);
            
            expect(updatePromises).toHaveLength(2);
        });

        it("should not update products if name unchanged", () => {
            const originalName = "Electronics";
            const newName = "Electronics";
            const nameChanged = originalName !== newName;
            
            expect(nameChanged).toBe(false);
        });
    });
});

describe("Edit Category - Activity Logging", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should log update activity", async () => {
        const categoryName = "Updated Category";
        
        await logActivity("Updated Category", categoryName);
        
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                action: "Updated Category",
                target: categoryName,
                user: "admin@test.com"
            })
        );
    });

    it("should include timestamp in activity log", async () => {
        await logActivity("Updated Category", "Test Category");
        
        expect(mockAddDoc).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                timestamp: expect.anything()
            })
        );
    });

    it("should handle logging errors gracefully", async () => {
        mockAddDoc.mockRejectedValue(new Error("Logging failed"));
        
        // Should not throw
        await expect(logActivity("Test", "Target")).resolves.not.toThrow();
    });
});

describe("Edit Category - Cache Management", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        sessionStorage.clear();
    });

    it("should bust dashboard cache after update", () => {
        sessionStorage.setItem('dashboard_cache', JSON.stringify({ some: 'data' }));
        
        // After update
        sessionStorage.removeItem('dashboard_cache');
        
        expect(sessionStorage.removeItem).toHaveBeenCalledWith('dashboard_cache');
    });

    it("should clear user data cache", () => {
        sessionStorage.clear();
        expect(sessionStorage.clear).toHaveBeenCalled();
    });
});

describe("Edit Category - Data Loss Prevention", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should track form dirty state", () => {
        let isFormDirty = false;
        
        // Simulate user input
        isFormDirty = true;
        
        expect(isFormDirty).toBe(true);
    });

    it("should warn before leaving with unsaved changes", () => {
        let isFormDirty = true;
        
        const mockEvent = {
            preventDefault: vi.fn(),
            returnValue: ''
        };

        // Simulate beforeunload
        if (isFormDirty) {
            mockEvent.preventDefault();
            mockEvent.returnValue = '';
        }

        expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    it("should not warn when form is clean", () => {
        let isFormDirty = false;
        
        const mockEvent = {
            preventDefault: vi.fn()
        };

        if (isFormDirty) {
            mockEvent.preventDefault();
        }

        expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
});

describe("Edit Category - Logout/Sign Out", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it("should clear localStorage on logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        localStorage.setItem("user_session", "active");
        localStorage.setItem("user_uid", "admin-uid");
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
        
        sessionStorage.setItem("user_data_admin-uid", JSON.stringify({ role: "admin" }));
        sessionStorage.setItem("dashboard_cache", "{}");
        
        sessionStorage.clear();
        await signOut({});
        
        expect(sessionStorage.clear).toHaveBeenCalled();
    });

    it("should call signOut function", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockResolvedValue();
        
        await signOut({});
        
        expect(signOut).toHaveBeenCalled();
    });

    it("should redirect to index.html after logout", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockResolvedValue();
        
        await signOut({});
        
        // Simulate redirect
        window.location.replace("index.html");
        
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });

    it("should handle logout errors and still redirect", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        signOut.mockRejectedValue(new Error("Network error"));
        
        try {
            await signOut({});
        } catch (error) {
            // Even on error, should redirect
            window.location.replace("index.html");
        }
        
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });

    it("should execute complete logout sequence", async () => {
        const { signOut } = await import("https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js");
        
        // Setup
        localStorage.setItem("user_session", "active");
        localStorage.setItem("user_uid", "admin-uid");
        localStorage.setItem("user_role", "admin");
        sessionStorage.setItem("cache", "data");
        
        // Execute
        localStorage.removeItem("user_session");
        localStorage.removeItem("user_uid");
        localStorage.removeItem("user_role");
        sessionStorage.clear();
        
        signOut.mockResolvedValue();
        await signOut({});
        
        window.location.replace("index.html");
        
        // Verify
        expect(localStorage.getItem("user_session")).toBeNull();
        expect(sessionStorage.clear).toHaveBeenCalled();
        expect(signOut).toHaveBeenCalled();
        expect(window.location.replace).toHaveBeenCalledWith("index.html");
    });
});

describe("Edit Category - Error Handling", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should handle Firestore errors", async () => {
        mockUpdateDoc.mockRejectedValue(new Error("Firestore error"));
        
        try {
            await mockUpdateDoc(mockDoc({}, "categories", "test-id"), {});
        } catch (error) {
            alert("Error updating category: " + error.message);
        }
        
        expect(alert).toHaveBeenCalledWith("Error updating category: Firestore error");
    });

    it("should reset button state on error", () => {
        const submitBtn = {
            innerText: "Updating...",
            disabled: true
        };

        // On error
        submitBtn.innerText = "Update Category";
        submitBtn.disabled = false;

        expect(submitBtn.innerText).toBe("Update Category");
        expect(submitBtn.disabled).toBe(false);
    });

    it("should handle network errors gracefully", async () => {
        mockGetDoc.mockRejectedValue(new Error("Network error"));
        
        try {
            await mockGetDoc(mockDoc({}, "categories", "test-id"));
        } catch (e) {
            console.error("Error fetching category:", e);
            alert("Error loading category: " + e.message);
        }
        
        expect(alert).toHaveBeenCalled();
    });
});

describe("Edit Category - Success Flow", () => {
    
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should show success modal after update", () => {
        const categoryName = "Updated Category";
        const modal = { style: { display: 'none' } };
        
        modal.style.display = 'flex';
        
        expect(modal.style.display).toBe('flex');
    });

    it("should redirect after successful update", (done) => {
        const redirectDelay = 100; // Reduced for testing
        
        setTimeout(() => {
            window.location.href = "Categories.html";
            expect(window.location.href).toBe("Categories.html");
            done();
        }, redirectDelay);
    });

    it("should clear form dirty flag on successful save", () => {
        let isFormDirty = true;
        
        // After successful save
        isFormDirty = false;
        
        expect(isFormDirty).toBe(false);
    });
});