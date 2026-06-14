/**
 * Language Switcher Component
 * Handles language selection, persistence, and event dispatching
 */

class LanguageSwitcher {
    constructor() {
        this.btn = document.getElementById('languageSwitcherBtn');
        this.menu = document.getElementById('languageSwitcherMenu');
        this.items = document.querySelectorAll('.language-switcher-item');
        
        // Get saved language from localStorage or default to 'en'
        this.currentLanguage = localStorage.getItem('selectedLanguage') || 'en';
        
        if (this.btn && this.menu) {
            this.init();
        }
    }

    init() {
        // Toggle dropdown on button click
        this.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMenu();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.language-switcher')) {
                this.closeMenu();
            }
        });

        // Handle language selection
        this.items.forEach(item => {
            item.addEventListener('click', () => this.selectLanguage(item));
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.selectLanguage(item);
                }
            });
        });

        // Keyboard navigation
        this.btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                this.openMenu();
            }
        });

        // Set initial display
        this.setSelectedItem();
        this.updateDisplay();
        // Apply saved language translations on load
        if (typeof applyTranslations === 'function') applyTranslations(this.currentLanguage);
    }

    toggleMenu() {
        if (this.menu.classList.contains('active')) {
            this.closeMenu();
        } else {
            this.openMenu();
        }
    }

    openMenu() {
        this.menu.classList.add('active');
        this.btn.classList.add('active');
        this.btn.setAttribute('aria-expanded', 'true');
    }

    closeMenu() {
        this.menu.classList.remove('active');
        this.btn.classList.remove('active');
        this.btn.setAttribute('aria-expanded', 'false');
    }

    selectLanguage(item) {
        const lang = item.getAttribute('data-lang');
        this.currentLanguage = lang;

        // Save to localStorage
        localStorage.setItem('selectedLanguage', lang);

        // Update UI
        this.setSelectedItem();
        this.updateDisplay();
        this.closeMenu();

        // Apply translations & font
        if (typeof applyTranslations === 'function') applyTranslations(lang);

        // Trigger custom event for language change
        window.dispatchEvent(new CustomEvent('languageChanged', {
            detail: { language: lang }
        }));

        // Dispatch event for page translation if handler exists
        if (window.onLanguageChange) {
            window.onLanguageChange(lang);
        }

        console.log(`Language changed to: ${lang}`);
    }

    setSelectedItem() {
        this.items.forEach(item => {
            item.classList.remove('selected');
        });
        const selectedItem = document.querySelector(`[data-lang="${this.currentLanguage}"]`);
        if (selectedItem) {
            selectedItem.classList.add('selected');
        }
    }

    updateDisplay() {
        const selectedItem = document.querySelector(`[data-lang="${this.currentLanguage}"]`);
        if (selectedItem) {
            const flag = selectedItem.querySelector('.language-switcher-item-flag').textContent;
            const name = selectedItem.querySelector('.language-switcher-item-name').textContent;
            const code = selectedItem.querySelector('.language-switcher-item-code').textContent;

            // Update button display
            const btnContent = this.btn.querySelector('.language-switcher-btn-text');
            if (btnContent) {
                btnContent.innerHTML = `
                    <span class="language-switcher-btn-flag">${flag}</span>
                    <span class="language-switcher-btn-name">${name}</span>
                    <span class="language-switcher-btn-code">(${code})</span>
                `;
            }
        }
    }

    getCurrentLanguage() {
        return this.currentLanguage;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new LanguageSwitcher();
});
