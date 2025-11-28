        const hamburger = document.querySelector('.hamburger');
        const sidebar = document.querySelector('.sidebar');
        const overlay = document.querySelector('.overlay');
        const navLinks = document.querySelectorAll('.nav-link');
        const bodyEl = document.body;
        const closeBtn = document.querySelector('.close-btn');
        const isMobile = () => window.matchMedia('(max-width: 768px)').matches;

        function openSidebar() {
            sidebar.classList.add('open');
            overlay.classList.add('show');
            bodyEl.classList.add('no-scroll');
            hamburger.classList.add('hidden');
            closeBtn.focus();
        }

        function closeSidebar() {
            sidebar.classList.remove('open');
            overlay.classList.remove('show');
            bodyEl.classList.remove('no-scroll');
            hamburger.classList.remove('hidden');
            hamburger.focus();
        }

        hamburger.addEventListener('click', () => { if (isMobile()) openSidebar(); });
        closeBtn.addEventListener('click', closeSidebar);
        overlay.addEventListener('click', closeSidebar);

        navLinks.forEach(link => {
            link.addEventListener('click', () => {
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                if (isMobile()) closeSidebar();
            });
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
        });

        window.addEventListener('resize', () => {
            if (!isMobile()) {
                sidebar.classList.remove('open');
                overlay.classList.remove('show');
                bodyEl.classList.remove('no-scroll');
                hamburger.classList.add('hidden');
            } else {
                hamburger.classList.remove('hidden');
            }
        });

        (function init() {
            if (!isMobile()) hamburger.classList.add('hidden');
        })();