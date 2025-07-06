/**
 * Intro Modal Content Manager
 * Handles the full-screen intro modal with multilingual support and auto-close functionality
 */

class IntroContentManager {
  constructor(options = {}) {
    this.currentLanguage = 'en';
    this.autoCloseTimer = null;
    this.autoCloseDelay = 10000; // 10 seconds
    this.markedLoaded = false;
    
    // Track if this is the first time showing the modal
    // Auto-close should only happen on the very first load
    this.autoCloseEnabled = options.enableAutoClose !== false && !IntroContentManager.hasBeenShown;
    
    // Generate unique IDs for this instance to avoid conflicts
    this.modalId = `intro-modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.contentId = `intro-content-${this.modalId}`;
    this.checkboxId = `auto-close-checkbox-${this.modalId}`;
    this.textId = `auto-close-text-${this.modalId}`;
    this.closeBtnId = `close-modal-btn-${this.modalId}`;
    
    // Configuration for intro content files
    this.config = {
      languages: {
        en: 'English',
        kok: 'कोंकणी'
      },
      contentFiles: [
        {
          en: 'docs/1_intro.en.md',
          kok: 'docs/1_intro.kok.md',
          titles: {
            en: 'Welcome to amche.in',
            kok: 'amche.in चेर तुमकां येवकार'
          }
        },
        {
          en: 'docs/0_controls.en.md',
          kok: 'docs/0_controls.kok.md',
          titles: {
            en: 'Map controls',
            kok: 'नकाशाचेर नियंत्रण दवरतात'
          }
        }
        
      ]
    };
    
    this.init();
  }

  async init() {
    await this.loadMarkdownParser();
    this.createModalHTML();
    this.setupEventListeners();
    await this.loadContent();
    this.showModal();
  }

  async loadMarkdownParser() {
    if (this.markedLoaded || window.marked) {
      this.markedLoaded = true;
      return;
    }

    try {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/marked@14.1.3/marked.min.js';
      script.onload = () => {
        this.markedLoaded = true;
        // Configure marked globally when it loads
        if (window.marked) {
          marked.setOptions({
            breaks: true,
            gfm: true,
            sanitize: false,
            smartLists: true,
            smartypants: false
          });
          
          // For newer versions of marked, we need to configure the renderer to allow HTML
          const renderer = new marked.Renderer();
          renderer.html = function(html) {
            return html;
          };
          
          marked.setOptions({
            renderer: renderer,
            breaks: true,
            gfm: true,
            sanitize: false,
            smartLists: true,
            smartypants: false
          });
        }
      };
      document.head.appendChild(script);
      
      // Wait for script to load
      await new Promise((resolve) => {
        script.onload = resolve;
      });
    } catch (error) {
      console.error('Failed to load marked.js:', error);
    }
  }

  createModalHTML() {
    const modalHTML = `
      <sl-dialog id="${this.modalId}" label="Welcome to Amche Goa Map" class="intro-modal" no-header>
        <div class="intro-modal-content">
          <!-- Header with help title and language switcher -->
          <div class="intro-header">
            <div class="help-title">
              <sl-icon name="question-circle-fill" class="help-icon"></sl-icon>
              <span>Help</span>
            </div>
            <div class="language-switcher">
              ${Object.entries(this.config.languages).map(([code, name]) => 
                `<button class="lang-btn ${code === this.currentLanguage ? 'active' : ''}" data-lang="${code}">${name}</button>`
              ).join(' | ')}
            </div>
            <div class="close-controls">
              <sl-checkbox id="${this.checkboxId}" ${this.autoCloseEnabled ? 'checked' : ''}>
                <span id="${this.textId}">Auto closing in 5 seconds...</span>
              </sl-checkbox>
              <sl-button variant="default" size="small" id="${this.closeBtnId}">
                <sl-icon slot="prefix" name="x-lg"></sl-icon>
                Close
              </sl-button>
            </div>
          </div>

          <!-- Content area -->
          <div class="intro-content" id="${this.contentId}">
            <div class="loading">Loading content...</div>
          </div>
        </div>
      </sl-dialog>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
  }

  setupEventListeners() {
    const modal = document.getElementById(this.modalId);
    const closeBtn = document.getElementById(this.closeBtnId);
    const autoCloseCheckbox = document.getElementById(this.checkboxId);
    const langButtons = modal.querySelectorAll('.lang-btn');

    // Close button
    closeBtn.addEventListener('click', () => {
      this.closeModal();
    });

    // Auto-close checkbox
    autoCloseCheckbox.addEventListener('sl-change', (event) => {
      this.autoCloseEnabled = event.target.checked;
      if (this.autoCloseEnabled) {
        this.startAutoCloseTimer();
      } else {
        this.stopAutoCloseTimer();
        this.hideAutoCloseControls();
      }
    });

    // Language switcher
    langButtons.forEach(btn => {
      btn.addEventListener('click', (event) => {
        const newLang = event.target.dataset.lang;
        if (newLang !== this.currentLanguage) {
          this.switchLanguage(newLang);
        }
      });
    });

    // Allow modal to close when clicking outside
    modal.addEventListener('sl-request-close', (event) => {
      // Don't prevent the close event - allow clicking outside to close
      this.closeModal();
    });
  }

  async loadContent() {
    try {
      const contentPromises = this.config.contentFiles.map(async (fileConfig) => {
        const filePath = fileConfig[this.currentLanguage];
        const response = await fetch(filePath);
        if (!response.ok) throw new Error(`Failed to load ${filePath}`);
        
        const markdownContent = await response.text();
        return {
          content: markdownContent,
          title: fileConfig.titles[this.currentLanguage]
        };
      });
      
      const contentData = await Promise.all(contentPromises);
      this.renderContent(contentData);
    } catch (error) {
      console.error('Error loading intro content:', error);
      this.renderErrorContent();
    }
  }

  renderContent(contentDataArray) {
    const detailsHtml = contentDataArray.map((contentData, index) => {
      const sections = this.parseMarkdownSections(contentData.content);
      
      const sectionsHtml = sections.map(section => {
        const htmlContent = this.markdownToHtml(section.content);
        return `
          <section class="content-section">
            <h3 class="section-title">${section.title}</h3>
            <div class="section-body">${htmlContent}</div>
          </section>
        `;
      }).join('');
      
      // Second details section (controls) is open by default
      const isOpen = index === 1 ? 'open' : '';
      
      return `
        <sl-details summary="${contentData.title}" ${isOpen}>
          <div class="section-content">
            <div class="sections-grid">
              ${sectionsHtml}
            </div>
          </div>
        </sl-details>
      `;
    }).join('');
    
    const html = `
      <div class="details-group-example">
        ${detailsHtml}
      </div>
    `;
    
    document.getElementById(this.contentId).innerHTML = html;
    
    // Set up accordion behavior - close all other details when one is shown
    const container = document.querySelector('.details-group-example');
    if (container) {
      container.addEventListener('sl-show', event => {
        if (event.target.localName === 'sl-details') {
          [...container.querySelectorAll('sl-details')].forEach(details => {
            details.open = event.target === details;
          });
        }
      });
    }
  }

  parseMarkdownSections(markdown) {
    const sections = [];
    const lines = markdown.split('\n');
    let currentSection = null;
    let introContent = '';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.startsWith('## ')) {
        // Save any intro content before first heading
        if (!currentSection && introContent.trim()) {
          sections.push({
            title: 'Introduction',
            content: introContent.trim()
          });
          introContent = '';
        }
        
        // Save previous section if exists
        if (currentSection) {
          sections.push({
            title: currentSection.title,
            content: currentSection.content.trim()
          });
        }
        
        // Start new section
        currentSection = {
          title: line.replace(/^## /, '').trim(),
          content: ''
        };
      } else if (currentSection) {
        currentSection.content += line + '\n';
      } else {
        // Content before first heading
        introContent += line + '\n';
      }
    }
    
    // Add any remaining intro content
    if (!currentSection && introContent.trim()) {
      sections.push({
        title: 'Introduction',
        content: introContent.trim()
      });
    }
    
    // Add the last section
    if (currentSection) {
      sections.push({
        title: currentSection.title,
        content: currentSection.content.trim()
      });
    }
    
    return sections;
  }


  markdownToHtml(markdown) {
    if (window.marked) {
      try {
        let html = marked.parse(markdown);
        
        // Debug: Log the HTML before post-processing
        if (markdown.includes('button')) {
          console.log('Before post-processing:', html);
        }
        
        // Post-process to unescape HTML entities in specific cases
        html = html.replace(/&lt;span([^&]*?)&gt;/g, '<span$1>');
        html = html.replace(/&lt;\/span&gt;/g, '</span>');
        html = html.replace(/&lt;button([^&]*?)&gt;/g, '<button$1>');
        html = html.replace(/&lt;\/button&gt;/g, '</button>');
        html = html.replace(/&quot;/g, '"');
        
        // Debug: Log the HTML after post-processing
        if (markdown.includes('button')) {
          console.log('After post-processing:', html);
        }
        
        return html;
      } catch (error) {
        console.error('Error parsing markdown:', error);
        return this.fallbackMarkdownToHtml(markdown);
      }
    } else {
      return this.fallbackMarkdownToHtml(markdown);
    }
  }

  fallbackMarkdownToHtml(markdown) {
    // Simple fallback markdown to HTML conversion
    return markdown
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(.+)$/gm, '<p>$1</p>')
      .replace(/\n/g, '<br>');
    // Note: HTML elements like <button> and <span> are preserved as-is in fallback
  }

  renderErrorContent() {
    document.getElementById(this.contentId).innerHTML = `
      <div class="error-content">
        <p>Unable to load intro content. Please try refreshing the page.</p>
      </div>
    `;
  }

  async switchLanguage(langCode) {
    this.currentLanguage = langCode;
    
    // Update active language button
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === langCode);
    });
    
    // Reload content
    await this.loadContent();
  }

  showModal() {
    const modal = document.getElementById(this.modalId);
    modal.show();
    
    if (this.autoCloseEnabled) {
      this.startAutoCloseTimer();
    } else {
      // Hide auto-close controls when auto-close is disabled
      // Use a small delay to ensure the modal is fully rendered
      setTimeout(() => {
        this.hideAutoCloseControls();
      }, 100);
    }
  }

  closeModal() {
    const modal = document.getElementById(this.modalId);
    modal.hide();
    this.stopAutoCloseTimer();
    
    // Mark that the modal has been shown at least once
    // This prevents auto-close from being enabled on subsequent opens
    IntroContentManager.hasBeenShown = true;
  }

  startAutoCloseTimer() {
    this.stopAutoCloseTimer(); // Clear any existing timer
    
    let remainingTime = this.autoCloseDelay / 1000; // Convert to seconds
    const textElement = document.getElementById(this.textId);
    
    // Update countdown every second
    const countdown = setInterval(() => {
      remainingTime--;
      if (remainingTime > 0) {
        textElement.textContent = `Auto closing in ${remainingTime} seconds...`;
      } else {
        clearInterval(countdown);
      }
    }, 1000);
    
    // Set main timer to close modal
    this.autoCloseTimer = setTimeout(() => {
      this.closeModal();
    }, this.autoCloseDelay);
  }

  stopAutoCloseTimer() {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
  }

  hideAutoCloseControls() {
    const textElement = document.getElementById(this.textId);
    const checkbox = document.getElementById(this.checkboxId);
    
    if (textElement) textElement.style.display = 'none';
    if (checkbox) checkbox.style.display = 'none';
  }
}

// Static property to track if modal has been shown before
IntroContentManager.hasBeenShown = false;

// CSS Styles
const styles = `
<style>
.intro-modal::part(panel) {
  max-width: 95vw;
  max-height: 95vh;
  width: 100%;
  height: 100%;
}

.intro-modal-content {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.intro-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--sl-color-neutral-200);
  background: var(--sl-color-neutral-50);
}

.help-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--sl-color-neutral-800);
}

.help-icon {
  font-size: 1.5rem;
  color: var(--sl-color-primary-600);
}

.language-switcher {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.lang-btn {
  background: none;
  border: none;
  color: var(--sl-color-primary-600);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  transition: all 0.2s;
}

.lang-btn:hover {
  background: var(--sl-color-primary-100);
}

.lang-btn.active {
  background: var(--sl-color-primary-600);
  color: white;
}

.close-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.intro-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.section-content {
  line-height: 1.6;
  color: var(--sl-color-neutral-700);
}

.sections-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.5rem;
}

/* Two-column layout for wide screens */
@media (min-width: 1024px) {
  .sections-grid {
    grid-template-columns: 1fr 1fr;
    gap: 2rem;
  }
}

.content-section {
  background: var(--sl-color-neutral-50);
  padding: 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--sl-color-neutral-200);
  break-inside: avoid;
}

.section-title {
  margin: 0 0 1rem 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--sl-color-primary-700);
}

.section-body {
  font-size: 0.95rem;
  line-height: 1.6;
}

.section-body h1,
.section-body h2,
.section-body h3,
.section-body h4,
.section-body h5,
.section-body h6 {
  margin-top: 1rem;
  margin-bottom: 0.5rem;
  color: var(--sl-color-neutral-800);
}

.section-body p {
  margin-bottom: 1rem;
}

.section-body ul,
.section-body ol {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.section-body li {
  margin-bottom: 0.25rem;
}

.section-body strong {
  color: var(--sl-color-neutral-900);
}

.section-body code {
  background: var(--sl-color-neutral-100);
  padding: 0.125rem 0.25rem;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
}

.section-body img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 0.5rem 0.25rem;
  display: inline-block;
  vertical-align: middle;
}

.section-body a {
  color: var(--sl-color-primary-600);
  text-decoration: none;
}

.section-body a:hover {
  text-decoration: underline;
}

/* Accordion styling */
.details-group-example sl-details:not(:last-of-type) {
  margin-bottom: var(--sl-spacing-2x-small);
}

/* GPS icon styling */
.section-body span[style*="background-image"] {
  display: inline-block;
  width: 20px;
  height: 20px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
  vertical-align: middle;
  margin: 0 4px;
}

.loading, .error-content {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--sl-color-neutral-500);
}

.error-content {
  color: var(--sl-color-danger-600);
}

#auto-close-text {
  font-size: 0.875rem;
  color: var(--sl-color-neutral-600);
}
</style>
`;

// Add styles to document
document.head.insertAdjacentHTML('beforeend', styles);

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new IntroContentManager();
  });
} else {
  new IntroContentManager();
}

// Export for manual initialization if needed
window.IntroContentManager = IntroContentManager;