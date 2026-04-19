export function initLogoutModal(signOutFn) {
    const overlay    = document.getElementById('logoutModalOverlay');
    const cancelBtn  = document.getElementById('logoutCancelBtn');
    const confirmBtn = document.getElementById('logoutConfirmBtn');
 
    if (!overlay || !cancelBtn || !confirmBtn) return;
 
    function openModal() {
        overlay.classList.add('show');
    }
 
    function closeModal() {
        overlay.classList.remove('show');
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-arrow-right-from-bracket"></i> Sign out';
    }
 
    cancelBtn.addEventListener('click', closeModal);
 
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });
 
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) closeModal();
    });
 
    confirmBtn.addEventListener('click', async () => {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing out...';
        await signOutFn();
    });
 
    return openModal;
}