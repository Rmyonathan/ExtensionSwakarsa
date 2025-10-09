let currentSection = null;

document.addEventListener('DOMContentLoaded', async function () {
  const isAuthenticated = await checkAuth();

  if (!isAuthenticated) {
    showLoginScreen();
    return; // Stop here — do not set up nav or load sections
  }

  // User is authenticated — proceed with normal dashboard setup
  loadSection('post-scraper');

  // Set up navigation (only for authenticated users)
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', function (e) {
      e.preventDefault();
      const section = this.getAttribute('data-section');

      // Re-check auth on every nav click (optional but safer)
      if (!localStorage.getItem('scraper_auth')) {
        showLoginScreen();
        return;
      }

      // Update active state
      navItems.forEach(nav => nav.classList.remove('active'));
      this.classList.add('active');

      // Load the section
      loadSection(section);
    });
  });

  // Back to popup button
  const backToPopup = document.getElementById('back-to-popup');
  if (backToPopup) {
    backToPopup.addEventListener('click', function () {
      window.close();
    });
  }
});

const WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyO7msqkzDY_MHLLYoWVHx5pBz0LfTdOfDnqxKmo8AeH05z7MRf2qI14zpXmmXjPvcBdA/exec';

async function checkAuth() {
  const saved = localStorage.getItem('scraper_auth');
  if (saved) {
    try {
      const auth = JSON.parse(saved);
      const now = new Date();
      // Optional: add local expiry (e.g., 7 days)
      if (auth && auth.email && auth.otp && new Date(auth.timestamp) > new Date(now - 7 * 24 * 60 * 60 * 1000)) {
        return true;
      }
    } catch (e) {}
  }
  return false;
}

async function showLoginScreen() {
  const container = document.getElementById('section-container');
  container.innerHTML = `
    <div class="login-screen" style="padding: 2rem; max-width: 500px; margin: 2rem auto;">
      <h2>🔐 Login Required</h2>
      <p>Enter your registered email to receive an OTP.</p>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="login-email" class="form-control" placeholder="you@example.com">
      </div>
      <button id="request-otp-btn" class="btn">Send OTP</button>
      <div id="otp-section" style="display:none; margin-top:1rem;">
        <div class="form-group">
          <label>Enter OTP (sent to your email)</label>
          <input type="text" id="login-otp" class="form-control" maxlength="6">
        </div>
        <button id="verify-otp-btn" class="btn">Verify</button>
      </div>
      <div id="login-status" style="margin-top:1rem; min-height:1.5rem;"></div>
    </div>
  `;

  document.getElementById('request-otp-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    if (!email) return showError('Please enter your email.');
    showStatus('Sending OTP...');

    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'request-otp',
            email: email
        })
    });
      const data = await res.json();
      if (data.success) {
        showStatus('OTP sent! Check your email.', 'success');
        document.getElementById('otp-section').style.display = 'block';
      } else if (data.blocked) {
        showError(data.error);
      } else {
        showError(data.error || 'Failed to send OTP.');
      }
    } catch (err) {
      showError('Network error. Try again.');
    }
  });

  document.getElementById('verify-otp-btn').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim().toLowerCase();
    const otp = document.getElementById('login-otp').value.trim();
    if (!otp) return showError('Please enter OTP.');
    showStatus('Verifying...');

    try {
      const res = await fetch(WEB_APP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'verify-otp',
            email: email,
            otp: otp
        })
    });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('scraper_auth', JSON.stringify({
          email: email,
          otp: otp,
          timestamp: new Date().toISOString()
        }));
        showStatus('Login successful! Loading dashboard...', 'success');
        setTimeout(() => loadSection('post-scraper'), 1000);
      } else {
        showError(data.error || 'Invalid OTP.');
      }
    } catch (err) {
      showError('Verification failed.');
    }
  });

  function showStatus(msg, type = 'error') {
    const el = document.getElementById('login-status');
    el.textContent = msg;
    el.style.color = type === 'success' ? 'green' : 'red';
  }
  function showError(msg) { showStatus(msg, 'error'); }
}

async function loadSection(sectionName) {
    currentSection = sectionName;
    const sectionContainer = document.getElementById('section-container');
    const titleElement = document.getElementById('current-section-title');
    
    // Update title based on section
    switch(sectionName) {
        case 'post-scraper':
            titleElement.textContent = 'Post Scraper';
            break;
        case 'contact-scraper':
            titleElement.textContent = 'Contact Scraper';
            break;
        case 'community-scraper':
            titleElement.textContent = 'Community Scraper';
            break;
        case 'group-contact-scraper':
            titleElement.textContent = 'Group Contact Scraper';
            break;
        case 'wa-auto':
            titleElement.textContent = 'WhatsApp Auto Chat';
            break;
    }
    
    try {
        // Load the section HTML
        const response = await fetch(`./sections/${sectionName}.html`);
        const html = await response.text();
        sectionContainer.innerHTML = html;
        
        // Initialize the section-specific functionality
        initSection(sectionName);
    } catch (error) {
        console.error('Error loading section:', error);
        sectionContainer.innerHTML = '<p>Error loading section. Please try again.</p>';
    }
}

function initSection(sectionName) {
    switch(sectionName) {
        case 'post-scraper':
            initPostScraper();
            break;
        case 'contact-scraper':
            initContactScraper();
            break;
        case 'community-scraper':
            initCommunityScraper();
            break;
        case 'group-contact-scraper':
            initGroupContactScraper();
            break;
        case 'wa-auto':
            initWhatsAppAuto();
            break;
    }
}

function initWhatsAppAuto() {
    console.log('Initializing WhatsApp Auto Chat');
    
    // Load the wa-auto.js script if not already loaded
    if (typeof window.automateWhatsAppSending === 'undefined') {
        const script = document.createElement('script');
        script.src = './js/wa-auto.js';
        script.onload = () => {
            setupWhatsAppAuto();
        };
        script.onerror = () => {
            console.error('Failed to load wa-auto.js');
            const status = document.getElementById('wa-status');
            if (status) {
                status.textContent = 'Error: Failed to load automation script.';
            }
        };
        document.head.appendChild(script);
    } else {
        setupWhatsAppAuto();
    }
}

function parsePhoneNumbers(rawText) {
    if (!rawText) return [];

    // Split on any kind of separator, including more messy ones like :, ;, |, /, -, →, >, *, (, ), ?, !, etc.
    const possibleParts = rawText
        .split(/[\s,;:|/\-→>*()?!~…\n]+/)  // Expanded split regex to handle more punctuation and symbols from your examples
        .map(part => part.trim())
        .filter(Boolean);

    const results = new Set();  // Use Set to automatically handle duplicates

    for (let part of possibleParts) {
        // Remove all non-digit or plus characters (handles dashes, spaces, etc. in the number itself)
        let cleaned = part.replace(/[^\d+]/g, '');

        // Skip if empty or too short
        if (!cleaned || cleaned.length < 8) continue;  // Minimum plausible phone length

        // Handle local Indonesian numbers (08xxxx → +62xxxx)
        if (cleaned.startsWith('08')) {
            cleaned = '+62' + cleaned.slice(1);
        }

        // Handle plain “62...” without +
        else if (cleaned.startsWith('62')) {
            cleaned = '+' + cleaned;
        }

        // Handle numbers starting with single 0 (e.g., 081234 → +6281234)
        else if (cleaned.startsWith('0') && !cleaned.startsWith('08')) {  // Avoid double-handling 08
            cleaned = '+62' + cleaned.slice(1);
        }

        // Handle numbers like 857... (missing leading 0/+) by assuming +62 if it looks Indonesian (8-10 digits starting with 8)
        else if (cleaned.startsWith('8') && cleaned.length >= 8 && cleaned.length <= 12) {
            cleaned = '+628' + cleaned.slice(1);
        }

        // Remove duplicate plus signs or leading zeros artifacts
        cleaned = cleaned.replace(/^\++/, '+').replace(/^0+/, '0');  // But keep one 0 if it's local

        // If it doesn't start with +, assume Indonesian and prepend +62 (fallback for messy data)
        if (!cleaned.startsWith('+') && cleaned.startsWith('0')) {
            cleaned = '+62' + cleaned.slice(1);
        } else if (!cleaned.startsWith('+')) {
            cleaned = '+62' + cleaned;
        }

        // Validation: starts with +, has 10–15 digits total (adjusted for Indonesian numbers, which are often 11-13 digits incl. +62)
        if (/^\+\d{10,15}$/.test(cleaned)) {
            results.add(cleaned);
        }
    }

    return Array.from(results);
}

function setupWhatsAppAuto() {
    const startBtn = document.getElementById('wa-start');
    const status = document.getElementById('wa-status');
    const addMessageBtn = document.getElementById('add-message-block');

    if (startBtn && status) {
        startBtn.addEventListener('click', async () => {
            const numbersText = document.getElementById('wa-numbers').value.trim();
            const messageBlocks = document.querySelectorAll('.message-block');
            const messages = [];

            // Collect all messages and attachments
            for (let i = 0; i < messageBlocks.length; i++) {
                const message = document.getElementById(`wa-message-${i}`).value.trim();
                const fileInput = document.getElementById(`wa-attachment-${i}`);
                let attachment = null;

                if (fileInput && fileInput.files.length > 0) {
                    const file = fileInput.files[0];
                    if (file.type.startsWith('image/')) {
                        // Convert file to base64 for transmission
                        attachment = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(file);
                        });
                    }
                }

                if (message || attachment) {
                    messages.push({ text: message, attachment });
                }
            }

            if (!numbersText || messages.length === 0) {
                status.textContent = 'Error: Please provide phone numbers and at least one message or attachment.';
                return;
            }

            // Parse the messy input here
            const numbers = parsePhoneNumbers(numbersText);

            if (numbers.length === 0) {
                status.textContent = 'Error: No valid phone numbers found in the input.';
                return;
            }

            status.textContent = `Starting auto chat for ${numbers.length} numbers with ${messages.length} messages... Opening WhatsApp Web.`;

            try {
                // Send the parsed numbers and messages to background
                chrome.runtime.sendMessage({
                    action: 'startWhatsAppAutomation',
                    numbers: numbers,
                    messages: messages
                }, response => {
                    if (chrome.runtime.lastError) {
                        status.textContent = `Error: ${chrome.runtime.lastError.message}`;
                        console.error('Runtime error:', chrome.runtime.lastError);
                    } else if (response && response.status === 'error') {
                        status.textContent = `Error: ${response.message}`;
                        console.error('Background script error:', response.message);
                    } else {
                        status.textContent = 'Automation started. Monitor the WhatsApp tab console for logs.';
                    }
                });
            } catch (err) {
                status.textContent = `Error: ${err.message}. Ensure extension has 'tabs' and 'scripting' permissions.`;
                console.error('Error initiating automation:', err);
            }
        });
    } else {
        console.error('Start button or status element not found.');
        status.textContent = 'Error: UI elements missing.';
    }

    if (addMessageBtn) {
        addMessageBtn.addEventListener('click', () => {
            const blocks = document.getElementById('message-blocks');
            const index = blocks.children.length;
            const newBlock = document.createElement('div');
            newBlock.className = 'message-block';
            newBlock.innerHTML = `
                <div class="form-group">
                    <label for="wa-message-${index}">Message to Send</label>
                    <textarea id="wa-message-${index}" placeholder="Enter your message here" rows="5"></textarea>
                </div>
                <div class="form-group">
                    <label for="wa-attachment-${index}">Attach Image (optional)</label>
                    <input type="file" id="wa-attachment-${index}" accept="image/*">
                </div>
                <button class="remove-message-block btn" style="background-color: #ff4444; margin-top: 10px;">Remove</button>
            `;
            blocks.appendChild(newBlock);
            newBlock.scrollIntoView({ behavior: 'smooth' });
            newBlock.querySelector('.remove-message-block').addEventListener('click', () => {
                newBlock.remove();
            });
        });
    } else {
        console.error('Add message block button not found.');
        document.getElementById('wa-status').textContent = 'Error: Add message button missing.';
    }
}

function initPostScraper() {
    // Load saved data
    loadSavedData();
    
    // Update max posts value display
    const dashboardMaxPosts = document.getElementById('dashboard-max-posts');
    const dashboardMaxValue = document.getElementById('dashboard-max-value');
    if (dashboardMaxPosts && dashboardMaxValue) {
        dashboardMaxPosts.addEventListener('input', function() {
            dashboardMaxValue.textContent = this.value;
        });
    }
    
    // Start scraping
    const dashboardStart = document.getElementById('dashboard-start');
    if (dashboardStart) {
        dashboardStart.addEventListener('click', startScraping);
    }
    
    // Stop scraping
    const dashboardStop = document.getElementById('dashboard-stop');
    if (dashboardStop) {
        dashboardStop.addEventListener('click', stopScraping);
    }
    
    // Export CSV
    const exportCsv = document.getElementById('export-csv');
    if (exportCsv) {
        exportCsv.addEventListener('click', exportToCSV);
    }
    
    // Clear results
    const clearResultsBtn = document.getElementById('clear-results');
    if (clearResultsBtn) {
        clearResultsBtn.addEventListener('click', clearResults);
    }
    
    // Instagram max posts value update
    const instagramMaxPosts = document.getElementById('instagram-max-posts');
    const instagramMaxValue = document.getElementById('instagram-max-value');
    if (instagramMaxPosts && instagramMaxValue) {
        instagramMaxPosts.addEventListener('input', function() {
            instagramMaxValue.textContent = this.value;
        });
    }
    
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        if (request.action === 'scrapingProgress') {
            updateProgress(request.data);
        } else if (request.action === 'scrapingComplete') {
            scrapingComplete(request.data);
        } else if (request.action === 'scrapingError') {
            scrapingError(request.data);
        }
    });
}

function initContactScraper() {
    console.log('Initializing contact scraper'); // Debug log
    
    // Initialize date range toggle
    const dateRangeSelect = document.getElementById('contact-date-range');
    const customDateRange = document.querySelector('.custom-date-range');
    
    if (dateRangeSelect && customDateRange) {
        dateRangeSelect.addEventListener('change', function() {
            if (this.value === 'custom') {
                customDateRange.classList.remove('hidden');
            } else {
                customDateRange.classList.add('hidden');
            }
        });
    }
    
    // Start contact scraping
    const contactStart = document.getElementById('contact-start');
    if (contactStart) {
        contactStart.addEventListener('click', startContactScraping);
        console.log('Contact start button listener added'); // Debug log
    } else {
        console.error('Contact start button not found'); // Debug log
    }
    
    // Stop contact scraping
    const contactStop = document.getElementById('contact-stop');
    if (contactStop) {
        contactStop.addEventListener('click', stopContactScraping);
        console.log('Contact stop button listener added'); // Debug log
    } else {
        console.error('Contact stop button not found'); // Debug log
    }
    
    // Export contacts
    const exportContacts = document.getElementById('export-contacts');
    if (exportContacts) {
        exportContacts.addEventListener('click', exportContactsToCSV);
    }
    
    // Clear contacts
    const clearContacts = document.getElementById('clear-contacts');
    if (clearContacts) {
        clearContacts.addEventListener('click', clearContactResults);
    }
    
    // Listen for contact scraping messages
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        console.log('Received message:', request.action); // Debug log
        
        if (request.action === 'contactScrapingProgress') {
            updateContactProgress(request.data);
        } else if (request.action === 'contactScrapingComplete') {
            contactScrapingComplete(request.data);
        } else if (request.action === 'contactScrapingError') {
            contactScrapingError(request.data);
        }
        
        return true;
    });
    
    console.log('Contact scraper initialized'); // Debug log
}

function startContactScraping() {
    console.log('Start contact scraping button clicked'); // Debug log
    
    const keywords = document.getElementById('contact-keywords').value;
    const dateRange = document.getElementById('contact-date-range').value;
    const location = document.getElementById('contact-location').value;
    
    console.log('Form values:', { keywords, dateRange, location }); // Debug log
    
    if (!keywords) {
        alert('Please enter keywords to search');
        return;
    }
    
    const config = {
        linkedinConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        },
        instagramConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        }
    };
    
    // Handle custom date range
    if (dateRange === 'custom') {
        const startDate = document.getElementById('contact-custom-start').value;
        const endDate = document.getElementById('contact-custom-end').value;
        
        if (!startDate || !endDate) {
            alert('Please select both start and end dates for custom range');
            return;
        }
        
        config.linkedinConfig.dateRange = { start: startDate, end: endDate };
        config.instagramConfig.dateRange = { start: startDate, end: endDate };
    }
    
    // Update UI
    updateContactUIForScraping(true);
    updateContactStatus('Starting contact scraping...', 'processing');
    
    console.log('Sending startContactScraping message with config:', config); // Debug log
    
    // Send message to background script
    chrome.runtime.sendMessage({
        action: 'startContactScraping',
        config: config
    }, function(response) {
        console.log('Background response:', response); // Debug log
        if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError); // Debug log
            updateContactStatus('Error: ' + chrome.runtime.lastError.message, 'error');
            updateContactUIForScraping(false);
        }
    });
}

function stopContactScraping() {
    console.log('Stop contact scraping button clicked'); // Debug log
    chrome.runtime.sendMessage({ action: 'stopContactScraping' }, function(response) {
        console.log('Stop response:', response); // Debug log
        if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError); // Debug log
        }
    });
    updateContactUIForScraping(false);
    updateContactStatus('Scraping stopped', 'idle');
}

function updateContactProgress(progress) {
    console.log('Contact scraping progress:', progress); // Debug log
    const progressBar = document.getElementById('contact-progress');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    updateContactStatus(`Scraping... ${progress}% complete`, 'processing');
}

function contactScrapingComplete(data) {
    console.log('Contact scraping completed with data:', data); // Debug log
    displayContactResults(data);
    updateContactUIForScraping(false);
    updateContactStatus('Scraping completed!', 'completed');
    
    const progressBar = document.getElementById('contact-progress');
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
    // Save data
    chrome.storage.local.set({ contactData: data });
}

function contactScrapingError(error) {
    console.error('Contact scraping error:', error); // Debug log
    updateContactUIForScraping(false);
    updateContactStatus(`Error: ${error}`, 'error');
}

function displayContactResults(data) {
    const container = document.getElementById('contacts-container');
    const count = document.getElementById('contacts-count');
    
    if (count) {
        count.textContent = `${data.length} contacts found`;
    }
    
    if (container) {
        container.innerHTML = '';
        
        if (data.length === 0) {
            container.innerHTML = '<p>No contacts found</p>';
            return;
        }
        
        // Create table
        const table = document.createElement('table');
        table.className = 'contacts-table';
        
        // Create header
        const header = table.createTHead();
        const headerRow = header.insertRow();
        const headers = ['No', 'Email', 'Overview', 'Source', 'Keyword'];
        
        headers.forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        
        // Create body
        const tbody = document.createElement('tbody');
        
        data.forEach((item, index) => {
            const row = tbody.insertRow();
            
            // Number
            const cellNo = row.insertCell();
            cellNo.textContent = index + 1;
            
            // Email
            const cellEmail = row.insertCell();
            cellEmail.textContent = item.email;
            
            // Overview
            const cellOverview = row.insertCell();
            cellOverview.textContent = item.overview;
            cellOverview.style.maxWidth = '300px';
            cellOverview.style.overflow = 'hidden';
            cellOverview.style.textOverflow = 'ellipsis';
            cellOverview.title = item.overview;
            
            // Source
            const cellSource = row.insertCell();
            cellSource.textContent = item.source;
            
            // Keyword
            const cellKeyword = row.insertCell();
            cellKeyword.textContent = item.keyword;
        });
        
        table.appendChild(tbody);
        container.appendChild(table);
    }
}

function exportContactsToCSV() {
    chrome.storage.local.get('contactData', function(result) {
        if (!result.contactData || result.contactData.length === 0) {
            alert('No contact data to export');
            return;
        }
        
        const data = result.contactData;
        const headers = ['Email', 'Overview', 'Source', 'Keyword'];
        const rows = data.map(item => 
            `"${item.email}","${item.overview.replace(/"/g, '""')}","${item.source}","${item.keyword}"`
        );
        
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'social_media_contacts.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

function clearContactResults() {
    if (confirm('Are you sure you want to clear all contact results?')) {
        chrome.storage.local.remove('contactData', function() {
            const container = document.getElementById('contacts-container');
            const count = document.getElementById('contacts-count');
            
            if (container) container.innerHTML = '';
            if (count) count.textContent = '0 contacts found';
        });
    }
}

function updateContactUIForScraping(scraping) {
    const startBtn = document.getElementById('contact-start');
    const stopBtn = document.getElementById('contact-stop');
    
    if (startBtn) startBtn.classList.toggle('hidden', scraping);
    if (stopBtn) stopBtn.classList.toggle('hidden', !scraping);
    
    const inputs = document.querySelectorAll('#contact-keywords, #contact-date-range, #contact-location, #contact-custom-start, #contact-custom-end');
    inputs.forEach(input => {
        input.disabled = scraping;
    });
}

function updateContactStatus(message, status) {
    const statusElem = document.getElementById('contact-status');
    if (statusElem) {
        statusElem.textContent = message;
        
        // Remove all status classes
        statusElem.classList.remove('status-processing', 'status-completed', 'status-error');
        
        // Add current status class
        if (status !== 'idle') {
            statusElem.classList.add(`status-${status}`);
        }
    }
}

function initCommunityScraper() {
    console.log('Initializing community scraper');

    const dateRangeSelect = document.getElementById('community-date-range');
    const customDateRange = document.querySelector('.custom-date-range');
    
    if (dateRangeSelect && customDateRange) {
        dateRangeSelect.addEventListener('change', function() {
            customDateRange.classList.toggle('hidden', this.value !== 'custom');
        });
    }
    
    const communityStart = document.getElementById('community-start');
    if (communityStart) {
        communityStart.addEventListener('click', startCommunityScraping);
        console.log('Community start button listener added');
    } else {
        console.error('Community start button not found');
    }
    
    const communityStop = document.getElementById('community-stop');
    if (communityStop) {
        communityStop.addEventListener('click', stopCommunityScraping);
        console.log('Community stop button listener added');
    } else {
        console.error('Community stop button not found');
    }
    
    const exportCommunities = document.getElementById('export-communities');
    if (exportCommunities) {
        exportCommunities.addEventListener('click', exportCommunitiesToCSV);
    }
    
    const clearCommunities = document.getElementById('clear-communities');
    if (clearCommunities) {
        clearCommunities.addEventListener('click', clearCommunityResults);
    }
    
    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
        console.log('Received message:', request.action);
        if (request.action === 'communityScrapingProgress') {
            updateCommunityProgress(request.data);
        } else if (request.action === 'communityScrapingComplete') {
            communityScrapingComplete(request.data);
        } else if (request.action === 'communityScrapingError') {
            communityScrapingError(request.data);
        }
    });
    
    console.log('Community scraper initialized');
}

function initGroupContactScraper() {
    console.log('Initializing group contact scraper');
    
    // Load the group contact scraper script if not already loaded
    if (typeof window.initGroupContactScraper === 'undefined' || !window.groupContactScraper) {
        const script = document.createElement('script');
        script.src = './js/group_contact_scraper.js';
        script.onload = () => {
            if (typeof window.initGroupContactScraper === 'function') {
                window.initGroupContactScraper();
            }
        };
        document.head.appendChild(script);
    } else {
        // Script already loaded, just initialize
        if (typeof window.initGroupContactScraper === 'function') {
            window.initGroupContactScraper();
        }
    }
    
    console.log('Group contact scraper initialized');
}

function startCommunityScraping() {
    console.log('Start community scraping button clicked');
    
    const keywords = document.getElementById('community-keywords').value;
    const dateRange = document.getElementById('community-date-range').value;
    const location = document.getElementById('community-location').value;
    
    console.log('Form values:', { keywords, dateRange, location });
    
    if (!keywords) {
        alert('Please enter keywords to search');
        return;
    }
    
    const config = {
        linkedinConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        },
        instagramConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        },
        facebookConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        },
        tiktokConfig: {
            keywords: keywords,
            dateRange: dateRange,
            location: location
        }
    };
    
    if (dateRange === 'custom') {
        const startDate = document.getElementById('community-custom-start').value;
        const endDate = document.getElementById('community-custom-end').value;
        
        if (!startDate || !endDate) {
            alert('Please select both start and end dates for custom range');
            return;
        }
        
        config.linkedinConfig.dateRange = { start: startDate, end: endDate };
        config.instagramConfig.dateRange = { start: startDate, end: endDate };
        config.facebookConfig.dateRange = { start: startDate, end: endDate };
        config.tiktokConfig.dateRange = { start: startDate, end: endDate };
    }
    
    updateCommunityUIForScraping(true);
    updateCommunityStatus('Starting community scraping...', 'processing');
    
    console.log('Sending startCommunityScraping message with config:', config);
    
    chrome.runtime.sendMessage({
        action: 'startCommunityScraping',
        config: config
    }, (response) => {
        console.log('Background response:', response);
        if (chrome.runtime.lastError) {
            console.error('Runtime error:', chrome.runtime.lastError);
            updateCommunityStatus('Error: ' + chrome.runtime.lastError.message, 'error');
            updateCommunityUIForScraping(false);
        } else if (response && response.status === 'error') {
            updateCommunityStatus('Error: ' + response.message, 'error');
            updateCommunityUIForScraping(false);
        } else if (response && response.status === 'already_running') {
            updateCommunityStatus('Community scraping is already running', 'error');
            updateCommunityUIForScraping(true);
        } else if (response && response.status === 'started') {
            updateCommunityStatus('Community scraping started', 'processing');
        }
    });
}

function stopCommunityScraping() {
    console.log('Stop community scraping button clicked');
    chrome.runtime.sendMessage({ action: 'stopCommunityScraping' });
    updateCommunityUIForScraping(false);
    updateCommunityStatus('Scraping stopped', 'error');
}

function updateCommunityProgress(progress) {
    console.log('Community scraping progress:', progress);
    const progressBar = document.getElementById('community-progress');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    updateCommunityStatus(`Scraping... ${progress}% complete`, 'processing');
}

function communityScrapingComplete(data) {
    console.log('Community scraping completed with data:', data);
    displayCommunityResults(data);
    updateCommunityUIForScraping(false);
    updateCommunityStatus('Scraping completed!', 'success');
    
    const progressBar = document.getElementById('community-progress');
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
    chrome.storage.local.set({ communityData: data });
}

function communityScrapingError(error) {
    console.error('Community scraping error:', error);
    updateCommunityUIForScraping(false);
    updateCommunityStatus(`Error: ${error}`, 'error');
}

function displayCommunityResults(data) {
    const container = document.getElementById('communities-container');
    const count = document.getElementById('communities-count');
    
    if (count) {
        count.textContent = `${data.length} communities found`;
    }
    
    if (container) {
        container.innerHTML = '';
        
        if (data.length === 0) {
            container.innerHTML = '<p>No communities found</p>';
            return;
        }
        
        const table = document.createElement('table');
        table.className = 'communities-table';
        
        const header = table.createTHead();
        const headerRow = header.insertRow();
        const headers = ['No', 'Link', 'Overview', 'Source', 'Keyword'];
        
        headers.forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });
        
        const tbody = document.createElement('tbody');
        
        data.forEach((item, index) => {
            const row = tbody.insertRow();
            
            const cellNo = row.insertCell();
            cellNo.textContent = index + 1;
            
            const cellLink = row.insertCell();
            const linkElement = document.createElement('a');
            linkElement.href = item.link;
            linkElement.textContent = item.link;
            linkElement.target = '_blank';
            cellLink.appendChild(linkElement);
            
            const cellOverview = row.insertCell();
            cellOverview.textContent = item.overview;
            cellOverview.style.maxWidth = '300px';
            cellOverview.style.overflow = 'hidden';
            cellOverview.style.textOverflow = 'ellipsis';
            cellOverview.title = item.overview;
            
            const cellSource = row.insertCell();
            cellSource.textContent = item.source;
            
            const cellKeyword = row.insertCell();
            cellKeyword.textContent = item.keyword;
        });
        
        table.appendChild(tbody);
        container.appendChild(table);
    }
}

function exportCommunitiesToCSV() {
    chrome.storage.local.get('communityData', function(result) {
        if (!result.communityData || result.communityData.length === 0) {
            alert('No community data to export');
            return;
        }
        
        const data = result.communityData;
        const headers = ['Link', 'Overview', 'Source', 'Keyword'];
        const rows = data.map(item => 
            `"${item.link}","${item.overview.replace(/"/g, '""')}","${item.source}","${item.keyword}"`
        );
        
        const csv = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'whatsapp_communities.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

function clearCommunityResults() {
    if (confirm('Are you sure you want to clear all community results?')) {
        chrome.storage.local.remove('communityData', function() {
            const container = document.getElementById('communities-container');
            const count = document.getElementById('communities-count');
            
            if (container) container.innerHTML = '';
            if (count) count.textContent = '0 communities found';
        });
    }
}

function updateCommunityUIForScraping(scraping) {
    const startBtn = document.getElementById('community-start');
    const stopBtn = document.getElementById('community-stop');
    
    if (startBtn) startBtn.classList.toggle('hidden', scraping);
    if (stopBtn) stopBtn.classList.toggle('hidden', !scraping);
    
    const inputs = document.querySelectorAll('#community-keywords, #community-date-range, #community-location, #community-custom-start, #community-custom-end');
    inputs.forEach(input => {
        input.disabled = scraping;
    });
}

function updateCommunityStatus(message, status) {
    const statusElem = document.getElementById('community-status');
    if (statusElem) {
        statusElem.textContent = message;
        statusElem.classList.remove('status-processing', 'status-completed', 'status-error');
        if (status !== 'idle') {
            statusElem.classList.add(`status-${status}`);
        }
    }
}

function loadSavedData() {
    chrome.storage.local.get(['scrapedData', 'scrapingConfig'], function(result) {
        if (result.scrapedData) {
            displayResults(result.scrapedData);
        }
        
        if (result.scrapingConfig) {
            // Set Reddit values
            if (result.scrapingConfig.redditConfig) {
                const redditConfig = result.scrapingConfig.redditConfig;
                const subredditsElem = document.getElementById('dashboard-subreddits');
                const keywordsElem = document.getElementById('dashboard-keywords');
                const maxPostsElem = document.getElementById('dashboard-max-posts');
                const maxValueElem = document.getElementById('dashboard-max-value');
                
                if (subredditsElem) subredditsElem.value = redditConfig.subreddits || '';
                if (keywordsElem) keywordsElem.value = redditConfig.keywords || '';
                if (maxPostsElem) maxPostsElem.value = redditConfig.maxPosts || 20;
                if (maxValueElem) maxValueElem.textContent = redditConfig.maxPosts || 20;
            }
            
            // Set Instagram values
            if (result.scrapingConfig.instagramConfig) {
                const instagramConfig = result.scrapingConfig.instagramConfig;
                const hashtagsElem = document.getElementById('instagram-hashtags');
                const instagramKeywordsElem = document.getElementById('instagram-keywords');
                const instagramMaxPostsElem = document.getElementById('instagram-max-posts');
                const instagramMaxValueElem = document.getElementById('instagram-max-value');
                
                if (hashtagsElem) hashtagsElem.value = instagramConfig.hashtags || '';
                if (instagramKeywordsElem) instagramKeywordsElem.value = instagramConfig.keywords || '';
                if (instagramMaxPostsElem) instagramMaxPostsElem.value = instagramConfig.maxPosts || 20;
                if (instagramMaxValueElem) instagramMaxValueElem.textContent = instagramConfig.maxPosts || 20;
            }
        }
    });
}

function startScraping() {
    // Get Reddit values
    const subredditsElem = document.getElementById('dashboard-subreddits');
    const redditKeywordsElem = document.getElementById('dashboard-keywords');
    const redditMaxPostsElem = document.getElementById('dashboard-max-posts');
    
    // Get Instagram values
    const instagramHashtagsElem = document.getElementById('instagram-hashtags');
    const instagramKeywordsElem = document.getElementById('instagram-keywords');
    const instagramMaxPostsElem = document.getElementById('instagram-max-posts');
    
    // Check if elements exist before accessing their values
    const subreddits = subredditsElem ? subredditsElem.value : '';
    const redditKeywords = redditKeywordsElem ? redditKeywordsElem.value : '';
    const redditMaxPosts = redditMaxPostsElem ? parseInt(redditMaxPostsElem.value) : 20;
    
    const instagramHashtags = instagramHashtagsElem ? instagramHashtagsElem.value : '';
    const instagramKeywords = instagramKeywordsElem ? instagramKeywordsElem.value : '';
    const instagramMaxPosts = instagramMaxPostsElem ? parseInt(instagramMaxPostsElem.value) : 20;
    
    if (!subreddits && !instagramHashtags) {
        alert('Please enter at least one subreddit or Instagram hashtag');
        return;
    }
    
    // Prepare configuration
    const config = {};
    
    if (subreddits) {
        config.redditConfig = {
            subreddits: subreddits,
            keywords: redditKeywords,
            maxPosts: redditMaxPosts
        };
    }
    
    if (instagramHashtags) {
        config.instagramConfig = {
            hashtags: instagramHashtags,
            keywords: instagramKeywords,
            maxPosts: instagramMaxPosts
        };
    }
    
    // Save configuration
    chrome.storage.local.set({ scrapingConfig: config });
    
    // Update UI
    const startBtn = document.getElementById('dashboard-start');
    const stopBtn = document.getElementById('dashboard-stop');
    
    if (startBtn) startBtn.classList.add('hidden');
    if (stopBtn) stopBtn.classList.remove('hidden');
    
    updateStatus('Starting scraping process...', 'processing');
    
    // Send message to background script to start scraping
    chrome.runtime.sendMessage({
        action: 'startScraping',
        config: config
    });
}

function stopScraping() {
    chrome.runtime.sendMessage({ action: 'stopScraping' });
    updateUIForScraping(false);
    updateStatus('Scraping stopped', 'idle');
}

function updateProgress(progress) {
    const progressBar = document.getElementById('dashboard-progress');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    updateStatus(`Scraping... ${progress}% complete`, 'processing');
}

function scrapingComplete(data) {
    displayResults(data);
    updateUIForScraping(false);
    updateStatus('Scraping completed!', 'completed');
    
    const progressBar = document.getElementById('dashboard-progress');
    if (progressBar) {
        progressBar.style.width = '100%';
    }
    
    // Save data
    chrome.storage.local.set({ scrapedData: data });
}

function scrapingError(error) {
    updateUIForScraping(false);
    updateStatus(`Error: ${error}`, 'error');
}

function displayResults(data) {
    const resultsContainer = document.getElementById('results-container');
    const resultsCount = document.getElementById('results-count');
    
    if (resultsCount) {
        resultsCount.textContent = `${data.length} posts found`;
    }
    
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        
        data.forEach(post => {
            const postElement = document.createElement('div');
            postElement.className = 'post-card';
            
            const sourceClass = post.source === 'reddit' ? 'reddit-badge' : 'instagram-badge';
            const date = new Date(post.timestamp).toLocaleDateString();
            
            postElement.innerHTML = `
                <div class="post-header">
                    <span class="source-badge ${sourceClass}">${post.source}</span>
                    <span>${date}</span>
                </div>
                <h3>${post.title}</h3>
                <div class="post-details">
                    <p><strong>Author:</strong> ${post.author}</p>
                    <p><strong>Engagement:</strong> ${post.votes || post.likes} ${post.source === 'reddit' ? 'votes' : 'likes'}, ${post.comments} comments</p>
                    ${post.price !== 'N/A' ? `<p><strong>Price:</strong> ${post.price}</p>` : ''}
                    ${post.location !== 'N/A' ? `<p><strong>Location:</strong> ${post.location}</p>` : ''}
                    ${post.content !== 'N/A' ? `<p>${post.content.substring(0, 100)}${post.content.length > 100 ? '...' : ''}</p>` : ''}
                </div>
                <div class="post-actions">
                    <a href="${post.url}" target="_blank" class="btn">View Original</a>
                </div>
            `;
            
            resultsContainer.appendChild(postElement);
        });
    }
}

function exportToCSV() {
    chrome.storage.local.get('scrapedData', function(result) {
        if (!result.scrapedData || result.scrapedData.length === 0) {
            alert('No data to export');
            return;
        }
        
        const data = result.scrapedData;
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(item => 
            Object.values(item).map(value => 
                `"${String(value).replace(/"/g, '""')}"`
            ).join(',')
        ).join('\n');
        
        const csv = `${headers}\n${rows}`;
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = 'social_media_posts.csv';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}

function clearResults() {
    if (confirm('Are you sure you want to clear all results?')) {
        chrome.storage.local.remove('scrapedData', function() {
            const resultsContainer = document.getElementById('results-container');
            const resultsCount = document.getElementById('results-count');
            
            if (resultsContainer) resultsContainer.innerHTML = '';
            if (resultsCount) resultsCount.textContent = '0 posts found';
        });
    }
}

function updateUIForScraping(scraping) {
    const startBtn = document.getElementById('dashboard-start');
    const stopBtn = document.getElementById('dashboard-stop');
    
    if (startBtn) startBtn.classList.toggle('hidden', scraping);
    if (stopBtn) stopBtn.classList.toggle('hidden', !scraping);
    
    const inputs = document.querySelectorAll('input, textarea, button');
    inputs.forEach(input => {
        if (input.id !== 'dashboard-stop') {
            input.disabled = scraping;
        }
    });
}

function updateStatus(message, status) {
    const statusElem = document.getElementById('dashboard-status');
    if (statusElem) {
        statusElem.textContent = message;
        
        // Remove all status classes
        statusElem.classList.remove('status-processing', 'status-completed', 'status-error');
        
        // Add current status class
        if (status !== 'idle') {
            statusElem.classList.add(`status-${status}`);
        }
    }
}