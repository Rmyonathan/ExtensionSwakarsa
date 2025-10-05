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

        // Scrape LinkedIn
        if (config.linkedinConfig && config.linkedinConfig.keywords) {
            console.log('Starting LinkedIn scraping');
            const linkedinResults = await scrapeBingForEmails(
                'linkedin',
                config.linkedinConfig.keywords,
                config.linkedinConfig.dateRange,
                config.linkedinConfig.location
            );
            allResults = allResults.concat(linkedinResults);
        }

        // Scrape Instagram
        if (config.instagramConfig && config.instagramConfig.keywords && isContactScraping) {
            console.log('Starting Instagram scraping');
            const instagramResults = await scrapeBingForEmails(
                'instagram',
                config.instagramConfig.keywords,
                config.instagramConfig.dateRange,
                config.instagramConfig.location
            );
            allResults = allResults.concat(instagramResults);
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

export async function scrapeBingForEmails(source, keywords, dateRange, location) {
    console.log(`Scraping Bing for ${source} with keywords: ${keywords}`);
    
    const baseQuery = `site:${source}.com ${keywords} "@gmail.com"`;
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
    
    console.log('Google query:', fullQuery);

    try {
        console.log(`Starting recursive pagination for ${source}`);
        const { emails, pageContent } = await scrapeBingPage(fullQuery, 1, source, keywords);
        
        console.log(`Total unique emails found for ${source}: ${emails.length}`);
        return emails;
        
    } catch (error) {
        console.error(`Error scraping ${source}:`, error);
        return [];
    }
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

export async function scrapeBingPage(query, page, source, keyword) {
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

                        // Extract emails and get page text
                        const emailRegex = /[a-zA-Z0-9._%+-]+@gmail\.com/g;
                        const pageText = document.body.innerText;
                        const matches = [...new Set(pageText.match(emailRegex) || [])]; // ← FIXED: changed 'text' to 'pageText'

                        // Try to find and click the "Next" button
                        const nextBtn = [...document.querySelectorAll('a')]
                            .find(a => a.innerText.toLowerCase().includes('next'));

                        if (nextBtn) {
                            nextBtn.click();
                            return { 
                                emails: matches, 
                                hasNext: true,
                                pageText: pageText // Return page text for context
                            };
                        } else {
                            return { 
                                emails: matches, 
                                hasNext: false,
                                pageText: pageText // Return page text for context
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

                    // === REPLACE THIS PART ===
                    // Process emails with context and duplicate filtering
                    const newEmails = result.emails.map(email => {
                        // Find context around the email
                        const emailIndex = result.pageText.indexOf(email);
                        let context = `Found on ${source} search`;
                        
                        if (emailIndex !== -1) {
                            const start = Math.max(0, emailIndex - 100);
                            const end = Math.min(result.pageText.length, emailIndex + email.length + 100);
                            context = result.pageText.substring(start, end).replace(/\s+/g, ' ').trim();
                        }
                        
                        return {
                            email: email.toLowerCase(), // normalize case
                            overview: context,
                            source: source.charAt(0).toUpperCase() + source.slice(1),
                            keyword: keyword
                        };
                    });

                    // Better duplicate filtering - check exact email match
                    const uniqueNewEmails = newEmails.filter(newEmail => 
                        !collectedEmails.some(existing => 
                            existing.email.toLowerCase() === newEmail.email.toLowerCase()
                        )
                    );

                    collectedEmails.push(...uniqueNewEmails);
                    // === END REPLACEMENT ===

                    console.log(`Collected ${collectedEmails.length} so far (attempt ${attempt})`);

                    if (result.hasNext && attempt < 10) {
                        // Wait for next page to load, then scrape again
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