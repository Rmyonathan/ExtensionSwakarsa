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
    const results = [];
    const maxPages = 5;
    let previousPageContent = '';

    const baseQuery = `site:${source}.com ${keywords} "@gmail.com"`; // Added @gmail.com
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
    
    console.log('Bing query:', fullQuery);

    for (let page = 1; page <= maxPages; page++) {
        if (!isContactScraping) {
            console.log('Scraping stopped by user');
            break;
        }

        try {
            console.log(`Scraping page ${page} of ${maxPages}`);
            const { emails, pageContent } = await scrapeBingPage(fullQuery, page, source, keywords);

            // Check if page content is the same as the previous page (indicating no more results)
            if (pageContent === previousPageContent) {
                console.log(`No new results on page ${page}, stopping`);
                break;
            }
            previousPageContent = pageContent;

            results.push(...emails);

            const progress = Math.round((page / maxPages) * 100);
            chrome.runtime.sendMessage({
                action: 'contactScrapingProgress',
                data: progress
            });

            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`Error scraping page ${page}:`, error);
            break;
        }
    }

    return results;
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
    console.log(`Opening Bing page ${page} for query: ${query}`);
    return new Promise((resolve, reject) => {
        const first = (page - 1) * 10 + 1;
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&first=${first}`;

        chrome.tabs.create({
            url: url,
            active: false,
            pinned: true // Pinned tabs are less likely to be closed
        }, (tab) => {
            if (chrome.runtime.lastError) {
                console.error('Error creating tab:', JSON.stringify(chrome.runtime.lastError, null, 2));
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            const tabId = tab.id;
            contactOpenTabs.push(tabId);
            console.log(`Created tab with URL: ${tab.pendingUrl || tab.url}`);

            let hasProcessed = false;
            const onTabUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete' && !hasProcessed) {
                    hasProcessed = true;
                    console.log(`Tab ${tabId} loaded completely`);
                    setTimeout(() => {
                        chrome.tabs.get(tabId, (tabInfo) => {
                            if (chrome.runtime.lastError || !tabInfo) {
                                console.error('Tab no longer exists:', JSON.stringify(chrome.runtime.lastError || { message: 'Tab not found' }));
                                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                                cleanupContactTab(tabId);
                                reject(new Error('Tab no longer exists'));
                                return;
                            }

                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: extractEmailsFromPage,
                                args: [source, keyword]
                            }, (results) => {
                                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                                cleanupContactTab(tabId);

                                if (chrome.runtime.lastError) {
                                    console.error('Error extracting emails:', JSON.stringify(chrome.runtime.lastError, null, 2));
                                    reject(new Error(chrome.runtime.lastError.message || 'Unknown script execution error'));
                                    return;
                                }

                                const pageText = results && results[0] && results[0].result ? results[0].result.pageText : '';
                                const emails = results && results[0] && results[0].result ? results[0].result.emails : [];
                                console.log(`Found ${emails.length} emails on page ${page}`);
                                resolve({ emails, pageContent: pageText });
                            });
                        });
                    }, 5000);
                }
            };

            chrome.tabs.onUpdated.addListener(onTabUpdated);

            const onTabRemoved = (closedTabId) => {
                if (closedTabId === tabId && !hasProcessed) {
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    chrome.tabs.onRemoved.removeListener(onTabRemoved);
                    cleanupContactTab(tabId);
                    reject(new Error('Tab was closed unexpectedly'));
                }
            };

            chrome.tabs.onRemoved.addListener(onTabRemoved);

            setTimeout(() => {
                if (!hasProcessed) {
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    chrome.tabs.onRemoved.removeListener(onTabRemoved);
                    cleanupContactTab(tabId);
                    reject(new Error('Timeout loading Bing page'));
                }
            }, 30000);
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