function isAdminUser(userData) {
    return userData?.role?.toLowerCase() === "admin";
}

function applyRoleBasedNavigation(isAdmin) {
    document.documentElement.classList.toggle("role-user-nav", !isAdmin);

    document.querySelectorAll(".sidebar-nav .nav-link").forEach(link => {
        const href = link.getAttribute("href") || "";
        link.style.display = isAdmin || href.includes("Products.html") ? "" : "none";
    });
}

function renderAccessDenied(main, pageName) {
    if (!main) return;

    main.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;height:60vh;text-align:center;
                    color:var(--text-secondary);">
            <i class="fas fa-lock" style="font-size:48px;margin-bottom:16px;"></i>
            <h2 style="margin:0 0 8px;color:var(--text-main);font-size:20px;">Access Denied</h2>
            <p style="margin:0;font-size:14px;">You do not have permission to view ${pageName}.</p>
        </div>`;
}

export { isAdminUser, applyRoleBasedNavigation, renderAccessDenied };
