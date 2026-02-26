export let isContactScraping = false;
export let contactOpenTabs = [];
export let contactScrapingConfig = null;

console.log('Contact scraper loaded');

export async function startContactScraping(config) {
    console.log('startContactScraping called with config:', config);
    isContactScraping = true;
    contactOpenTabs = [];
    contactScrapingConfig = config;
    let allResults = [];

    try {
        chrome.runtime.sendMessage({
            action: 'contactScrapingProgress',
            data: 0
        });

        // Parse multiple keywords from comma-separated string
        const keywordsArray = config.linkedinConfig && config.linkedinConfig.keywords
            ? config.linkedinConfig.keywords.split(',').map(k => k.trim()).filter(k => k)
            : [];
        
        // Parse multiple roles from comma-separated string
        const roleInput = config.linkedinConfig?.role || config.instagramConfig?.role || '';
        console.log('Raw role input:', roleInput);
        
        const rolesArray = roleInput
            ? roleInput.split(',').map(r => r.trim()).filter(r => r)
            : ['General'];
        
        // Calculate total iterations for progress
        const totalIterations = keywordsArray.length * rolesArray.length * 3; // *3 for LinkedIn, Instagram, and Threads
        let completedIterations = 0;

        console.log('Parsed Keywords Array:', keywordsArray);
        console.log('Parsed Roles Array:', rolesArray);
        console.log('Total iterations:', totalIterations);

        // Scrape LinkedIn with multiple keywords and roles
        if (config.linkedinConfig && keywordsArray.length > 0) {
            console.log('Starting LinkedIn scraping for keywords:', keywordsArray, 'and roles:', rolesArray);
            
            for (const keyword of keywordsArray) {
                for (const role of rolesArray) {
                    if (!isContactScraping) break;
                    
                    const searchKeyword = role !== 'General' ? `${role} ${keyword}` : keyword;
                    console.log(`Searching LinkedIn: role="${role}", keyword="${keyword}", query="${searchKeyword}"`);
                    
                    const linkedinResults = await scrapeBingForEmails(
                        'linkedin',
                        searchKeyword,
                        config.linkedinConfig.dateRange,
                        config.linkedinConfig.location,
                        role,
                        keyword
                    );
                    
                    // Send new contacts immediately for real-time display
                    if (linkedinResults.length > 0) {
                        chrome.runtime.sendMessage({
                            action: 'contactScrapingNewContacts',
                            data: linkedinResults
                        });
                    }
                    
                    allResults = allResults.concat(linkedinResults);
                    
                    completedIterations++;
                    const progress = Math.min(100, Math.floor((completedIterations / totalIterations) * 100));
                    chrome.runtime.sendMessage({
                        action: 'contactScrapingProgress',
                        data: progress
                    });
                }
            }
        }

        // Scrape Instagram with multiple keywords and roles
        if (config.instagramConfig && keywordsArray.length > 0 && isContactScraping) {
            console.log('Starting Instagram scraping for keywords:', keywordsArray, 'and roles:', rolesArray);
            
            for (const keyword of keywordsArray) {
                for (const role of rolesArray) {
                    if (!isContactScraping) break;
                    
                    const searchKeyword = role !== 'General' ? `${role} ${keyword}` : keyword;
                    console.log(`Searching Instagram: role="${role}", keyword="${keyword}", query="${searchKeyword}"`);
                    
                    const instagramResults = await scrapeBingForEmails(
                        'instagram',
                        searchKeyword,
                        config.instagramConfig.dateRange,
                        config.instagramConfig.location,
                        role,
                        keyword
                    );
                    
                    // Send new contacts immediately for real-time display
                    if (instagramResults.length > 0) {
                        chrome.runtime.sendMessage({
                            action: 'contactScrapingNewContacts',
                            data: instagramResults
                        });
                    }
                    
                    allResults = allResults.concat(instagramResults);
                    
                    completedIterations++;
                    const progress = Math.min(100, Math.floor((completedIterations / totalIterations) * 100));
                    chrome.runtime.sendMessage({
                        action: 'contactScrapingProgress',
                        data: progress
                    });
                }
            }
        }

        // Scrape Threads with multiple keywords and roles
        if (config.threadsConfig && keywordsArray.length > 0 && isContactScraping) {
            console.log('Starting Threads scraping for keywords:', keywordsArray, 'and roles:', rolesArray);
            
            for (const keyword of keywordsArray) {
                for (const role of rolesArray) {
                    if (!isContactScraping) break;
                    
                    const searchKeyword = role !== 'General' ? `${role} ${keyword}` : keyword;
                    console.log(`Searching Threads: role="${role}", keyword="${keyword}", query="${searchKeyword}"`);
                    
                    const threadsResults = await scrapeBingForEmails(
                        'threads',
                        searchKeyword,
                        config.threadsConfig.dateRange,
                        config.threadsConfig.location,
                        role,
                        keyword
                    );
                    
                    // Send new contacts immediately for real-time display
                    if (threadsResults.length > 0) {
                        chrome.runtime.sendMessage({
                            action: 'contactScrapingNewContacts',
                            data: threadsResults
                        });
                    }
                    
                    allResults = allResults.concat(threadsResults);
                    
                    completedIterations++;
                    const progress = Math.min(100, Math.floor((completedIterations / totalIterations) * 100));
                    chrome.runtime.sendMessage({
                        action: 'contactScrapingProgress',
                        data: progress
                    });
                }
            }
        }

        if (isContactScraping) {
            console.log('Contact scraping completed with results:', allResults.length);
            chrome.runtime.sendMessage({
                action: 'contactScrapingComplete',
                data: allResults
            });
        }
    } catch (error) {
        console.error('Contact scraping error:', error);
        chrome.runtime.sendMessage({
            action: 'contactScrapingError',
            data: error.message
        });
    }

    isContactScraping = false;
    cleanupContactTabs();
}

const SOURCE_DOMAINS = {
    linkedin: 'linkedin.com',
    instagram: 'instagram.com',
    threads: 'threads.net'
};

export async function scrapeBingForEmails(source, keywords, dateRange, location, role, originalKeyword) {
    console.log(`Scraping Bing for ${source} with keywords: ${keywords}, role: ${role}`);
    
    const domain = SOURCE_DOMAINS[source] || `${source}.com`;
    
    // Enhanced email patterns for searching
    const emailPatterns = [
        '"@gmail.com"',
        '"info@"',
        '"career@"',
        '"careers@"',
        '"hr@"',
        '"recruitment@"',
        '"contact@"',
        '"hello@"'
    ];
    
    let allEmails = [];
    
    // Loop through all email patterns
    for (const emailPattern of emailPatterns) {
        if (!isContactScraping) break;
        
        const baseQuery = `site:${domain} ${keywords} ${emailPattern}`;
        let fullQuery = baseQuery;
        
        if (dateRange && dateRange !== 'custom') {
            const dateStr = getDateRange(dateRange);
            fullQuery += ` after:${dateStr.start} before:${dateStr.end}`;
        } else if (dateRange === 'custom' && contactScrapingConfig) {
            fullQuery += ` after:${contactScrapingConfig.linkedinConfig.dateRange.start} before:${contactScrapingConfig.linkedinConfig.dateRange.end}`;
        }
        
        if (location) {
            fullQuery += ` location:${location}`;
        }
        
        console.log(`Query for ${emailPattern}:`, fullQuery);

        try {
            const { emails } = await scrapeBingPage(fullQuery, 1, source, originalKeyword || keywords, role);
            allEmails = allEmails.concat(emails);
        } catch (error) {
            console.error(`Error scraping with pattern ${emailPattern}:`, error);
        }
    }
    
    // Remove duplicates
    const uniqueEmails = [];
    const emailSet = new Set();
    
    allEmails.forEach(emailObj => {
        if (!emailSet.has(emailObj.email.toLowerCase())) {
            emailSet.add(emailObj.email.toLowerCase());
            uniqueEmails.push(emailObj);
        }
    });
    
    console.log(`Total unique emails found for ${source}: ${uniqueEmails.length}`);
    return uniqueEmails;
}

function getDateRange(range) {
    const now = new Date();
    const start = new Date();

    switch (range) {
        case '7':
            start.setDate(now.getDate() - 7);
            break;
        case '30':
            start.setDate(now.getDate() - 30);
            break;
        case '90':
            start.setDate(now.getDate() - 90);
            break;
        case '365':
            start.setFullYear(now.getFullYear() - 1); // Past year
            break;
        default:
            start.setDate(now.getDate() - 30);
    }

    return {
        start: start.toISOString().split('T')[0],
        end: now.toISOString().split('T')[0]
    };
}

export async function scrapeBingPage(query, page, source, keyword, role) {
    console.log(`Opening Google page ${page} for query: ${query}`);
    return new Promise((resolve, reject) => {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        chrome.tabs.create({ url, active: false, pinned: true }, (tab) => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }

            const tabId = tab.id;
            contactOpenTabs.push(tabId);

            let hasProcessed = false;
            let collectedEmails = [];

            const scrapeLoop = (attempt = 1) => {
                if (!isContactScraping || attempt > 5) {
                    cleanupContactTab(tabId);
                    resolve({ emails: collectedEmails, pageContent: '' });
                    return;
                }

                chrome.scripting.executeScript({
                    target: { tabId },
                    func: async () => {
                        // Scroll down gradually
                        for (let i = 0; i < 5; i++) {
                            window.scrollBy(0, document.body.scrollHeight);
                            await new Promise(r => setTimeout(r, 1000));
                        }

                        // ENHANCED EMAIL EXTRACTION WITH MULTIPLE PATTERNS
                        const pageText = document.body.innerText;
                        const emailRegexes = [
                            /[a-zA-Z0-9._%+-]+@gmail\.com/gi,
                            /info@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /career(?:s)?@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /hr@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /recruitment@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /contact@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /hello@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
                            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi
                        ];
                        
                        // Extract search results with their URLs and text
                        const searchResults = [];
                        const resultElements = document.querySelectorAll('div.g, div[data-sokoban-container]');
                        resultElements.forEach(el => {
                            const linkEl = el.querySelector('a[href^="http"]');
                            const textContent = el.innerText || '';
                            if (linkEl && linkEl.href) {
                                searchResults.push({
                                    url: linkEl.href,
                                    text: textContent
                                });
                            }
                        });
                        
                        // Find emails and associate with URLs
                        const emailsWithUrls = [];
                        let allMatches = [];
                        
                        emailRegexes.forEach(regex => {
                            const matches = pageText.match(regex) || [];
                            allMatches = allMatches.concat(matches);
                        });
                        
                        const uniqueEmails = [...new Set(allMatches)];
                        
                        uniqueEmails.forEach(email => {
                            // Find which search result contains this email
                            let sourceUrl = '';
                            for (const result of searchResults) {
                                if (result.text.includes(email)) {
                                    sourceUrl = result.url;
                                    break;
                                }
                            }
                            emailsWithUrls.push({
                                email: email,
                                sourceUrl: sourceUrl
                            });
                        });

                        // Try to find and click the "Next" button
                        const nextBtn = [...document.querySelectorAll('a')]
                            .find(a => a.innerText.toLowerCase().includes('next'));

                        if (nextBtn) {
                            nextBtn.click();
                            return { 
                                emails: emailsWithUrls, 
                                hasNext: true,
                                pageText: pageText
                            };
                        } else {
                            return { 
                                emails: emailsWithUrls, 
                                hasNext: false,
                                pageText: pageText
                            };
                        }
                    }
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        cleanupContactTab(tabId);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    const result = results?.[0]?.result;
                    if (!result) {
                        cleanupContactTab(tabId);
                        reject(new Error('No result returned'));
                        return;
                    }

                    // Process emails with cleaned address, context, and role
                    const newEmails = result.emails.map(emailObj => {
                        const rawEmail = (emailObj.email || '').toLowerCase();
                        const strictMatch = rawEmail.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
                        if (!strictMatch) return null;
                        const email = strictMatch[0];

                        const emailIndex = result.pageText.indexOf(email);
                        let context = `Found on ${source} search`;
                        
                        if (emailIndex !== -1) {
                            const start = Math.max(0, emailIndex - 100);
                            const end = Math.min(result.pageText.length, emailIndex + email.length + 100);
                            context = result.pageText.substring(start, end).replace(/\s+/g, ' ').trim();
                        }
                        
                        return {
                            email: email,
                            overview: context,
                            source: source.charAt(0).toUpperCase() + source.slice(1),
                            sourceUrl: emailObj.sourceUrl || '',
                            keyword: keyword,
                            role: role || 'General',
                            selected: false
                        };
                    });

                    // Drop invalid entries and filter duplicates
                    const filteredNewEmails = newEmails.filter(Boolean);
                    const uniqueNewEmails = filteredNewEmails.filter(newEmail => 
                        !collectedEmails.some(existing => 
                            existing.email.toLowerCase() === newEmail.email.toLowerCase()
                        )
                    );

                    collectedEmails.push(...uniqueNewEmails);

                    console.log(`Collected ${collectedEmails.length} so far (attempt ${attempt})`);

                    if (result.hasNext && attempt < 10) {
                        setTimeout(() => scrapeLoop(attempt + 1), 4000 + Math.random() * 2000);
                    } else {
                        cleanupContactTab(tabId);
                        resolve({ emails: collectedEmails, pageContent: '' });
                    }
                });
            };

            // Wait for first page load
            const onTabUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete' && !hasProcessed) {
                    hasProcessed = true;
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    setTimeout(() => scrapeLoop(), 3000);
                }
            };
            chrome.tabs.onUpdated.addListener(onTabUpdated);
        });
    });
}


export function extractEmailsFromPage(source, keyword) {
    console.log('Extracting emails from page');
    const results = [];
    const emailRegex = /[a-zA-Z0-9._%+-]+@gmail\.com/g; // Specific to @gmail.com per instruction
    const pageText = document.body.textContent;

    console.log('Page content length:', pageText.length);
    console.log('Sample page content (first 500 chars):', pageText.substring(0, 500));

    if (pageText.includes('CAPTCHA') || pageText.includes('Please verify you are not a robot')) {
        console.warn('CAPTCHA detected on Bing page. Please verify manually and restart scraping.');
        chrome.runtime.sendMessage({
            action: 'contactScrapingError',
            data: 'CAPTCHA detected. Please verify manually.'
        });
        return { emails: [], pageText };
    }

    let match;
    while ((match = emailRegex.exec(pageText)) !== null) {
        const email = match[0];
        const start = Math.max(0, match.index - 50);
        const end = Math.min(pageText.length, match.index + email.length + 50);
        const snippet = pageText.substring(start, end).replace(/\s+/g, ' ').trim();

        if (!results.some(r => r.email === email)) {
            results.push({
                email: email,
                overview: snippet,
                source: source.charAt(0).toUpperCase() + source.slice(1),
                keyword: keyword
            });
        }
    }

    console.log(`Found ${results.length} emails on this page`);
    return { emails: results, pageText };
}

export function stopContactScraping() {
    console.log('Stopping contact scraping');
    isContactScraping = false;
    cleanupContactTabs();
}

export function cleanupContactTabs() {
    console.log('Cleaning up contact tabs');
    contactOpenTabs.forEach(tabId => {
        chrome.tabs.get(tabId, (tabInfo) => {
            if (chrome.runtime.lastError || !tabInfo) {
                console.log(`Tab ${tabId} already closed`);
                return;
            }
            chrome.tabs.remove(tabId, () => {
                if (chrome.runtime.lastError) {
                    console.log(`Tab ${tabId} already closed or error:`, chrome.runtime.lastError.message);
                }
            });
        });
    });
    contactOpenTabs = [];
}

export function cleanupContactTab(tabId) {
    console.log(`Cleaning up contact tab ${tabId}`);
    contactOpenTabs = contactOpenTabs.filter(id => id !== tabId);
    chrome.tabs.get(tabId, (tabInfo) => {
        if (chrome.runtime.lastError || !tabInfo) {
            console.log(`Tab ${tabId} already closed`);
            return;
        }
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                console.log(`Tab ${tabId} already closed or error:`, chrome.runtime.lastError.message);
            }
        });
    });
}

// ==================== UTILITY FUNCTIONS ====================

// Copy email list to clipboard
export function copyEmailList(emails) {
    const emailList = emails.map(e => e.email).join(', ');
    navigator.clipboard.writeText(emailList).then(() => {
        console.log('Emails copied to clipboard');
        chrome.runtime.sendMessage({
            action: 'showNotification',
            data: {
                title: 'Success',
                message: `${emails.length} emails copied to clipboard`
            }
        });
    }).catch(err => {
        console.error('Failed to copy emails:', err);
    });
}

// Open Gmail compose with Fast Blast (BCC)
export function openFastBlast(emails, subject = '', body = '') {
    const emailList = emails.map(e => e.email).join(',');
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&bcc=${emailList}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    chrome.tabs.create({ url: gmailUrl, active: true }, (tab) => {
        console.log('Opened Gmail compose for fast blast');
    });
}

// Open personalized email modal (placeholder - sends message to UI)
export function openPersonalizedEmailModal(emails) {
    chrome.runtime.sendMessage({
        action: 'openPersonalizedEmailModal',
        data: { emails: emails }
    });
}

// Export contacts to CSV
export function exportToCSV(contacts) {
    const headers = ['Email', 'Role', 'Platform', 'Keyword', 'Overview'];
    const csvRows = [];
    
    // Add headers
    csvRows.push(headers.join(','));
    
    // Add data rows
    contacts.forEach(contact => {
        const row = [
            `"${contact.email}"`,
            `"${contact.role || 'General'}"`,
            `"${contact.source}"`,
            `"${contact.keyword}"`,
            `"${(contact.overview || '').replace(/"/g, '""')}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    
    chrome.downloads.download({
        url: url,
        filename: `contacts_export_${new Date().toISOString().split('T')[0]}.csv`
    });
}

// Email validation
export function validateEmail(email) {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return re.test(email);
}

// Select all contacts
export function selectAllContacts() {
    chrome.runtime.sendMessage({
        action: 'selectAllContacts'
    });
}

// Deselect all contacts
export function deselectAllContacts() {
    chrome.runtime.sendMessage({
        action: 'deselectAllContacts'
    });
}

// Delete selected contacts
export function deleteSelectedContacts(contactIds) {
    chrome.runtime.sendMessage({
        action: 'deleteSelectedContacts',
        data: { ids: contactIds }
    });
}

// Edit contact
export function editContact(contactId, updates) {
    chrome.runtime.sendMessage({
        action: 'editContact',
        data: { id: contactId, updates: updates }
    });
}

// Bulk edit contacts
export function bulkEditContacts(contactIds, field, value) {
    chrome.runtime.sendMessage({
        action: 'bulkEditContacts',
        data: { ids: contactIds, field: field, value: value }
    });
}

// Rate limiting to avoid blocks
export const rateLimiter = {
    lastRequest: 0,
    minDelay: 3000,
    async wait() {
        const now = Date.now();
        const timeSinceLast = now - this.lastRequest;
        if (timeSinceLast < this.minDelay) {
            await new Promise(resolve => 
                setTimeout(resolve, this.minDelay - timeSinceLast)
            );
        }
        this.lastRequest = Date.now();
    }
};