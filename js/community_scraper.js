export let isCommunityScraping = false;
export let communityOpenTabs = [];
export let communityScrapingConfig = null;

console.log('Community scraper loaded');

export async function startCommunityScraping(config) {
    console.log('startCommunityScraping called with config:', config);
    isCommunityScraping = true;
    communityOpenTabs = [];
    communityScrapingConfig = config;
    let allResults = [];

    try {
        chrome.runtime.sendMessage({
            action: 'communityScrapingProgress',
            data: 0
        });

        // Scrape LinkedIn
        if (config.linkedinConfig && config.linkedinConfig.keywords) {
            console.log('Starting LinkedIn community scraping');
            const linkedinResults = await scrapeBingForLinks(
                'linkedin',
                config.linkedinConfig.keywords,
                config.linkedinConfig.dateRange,
                config.linkedinConfig.location
            );
            allResults = allResults.concat(linkedinResults);
        }

        // Scrape Instagram
        if (config.instagramConfig && config.instagramConfig.keywords && isCommunityScraping) {
            console.log('Starting Instagram community scraping');
            const instagramResults = await scrapeBingForLinks(
                'instagram',
                config.instagramConfig.keywords,
                config.instagramConfig.dateRange,
                config.instagramConfig.location
            );
            allResults = allResults.concat(instagramResults);
        }

        if (isCommunityScraping) {
            console.log('Community scraping completed with results:', allResults.length);
            chrome.runtime.sendMessage({
                action: 'communityScrapingComplete',
                data: allResults
            });
        }
    } catch (error) {
        console.error('Community scraping error:', error);
        chrome.runtime.sendMessage({
            action: 'communityScrapingError',
            data: error.message
        });
    }

    isCommunityScraping = false;
    cleanupCommunityTabs();
}

export async function scrapeBingForLinks(source, keywords, dateRange, location) {
    console.log(`Scraping Bing for ${source} with keywords: ${keywords}`);
    const results = [];
    const maxPages = 5;
    let previousPageContent = '';

    const baseQuery = `site:${source}.com ${keywords} "chat.whatsapp.com"`;
    let fullQuery = baseQuery;

    if (dateRange && dateRange !== 'custom') {
        const dateStr = getDateRange(dateRange);
        fullQuery += ` after:${dateStr.start} before:${dateStr.end}`;
    } else if (dateRange === 'custom' && communityScrapingConfig) {
        fullQuery += ` after:${communityScrapingConfig.linkedinConfig.dateRange.start} before:${communityScrapingConfig.linkedinConfig.dateRange.end}`;
    }

    if (location) {
        fullQuery += ` location:${location}`;
    }

    console.log('Bing query:', fullQuery);

    for (let page = 1; page <= maxPages; page++) {
        if (!isCommunityScraping) {
            console.log('Scraping stopped by user');
            break;
        }

        try {
            console.log(`Scraping page ${page} of ${maxPages}`);
            const { links, pageContent } = await scrapeBingPage(fullQuery, page, source, keywords);

            if (pageContent === previousPageContent) {
                console.log(`No new results on page ${page}, stopping`);
                break;
            }
            previousPageContent = pageContent;

            results.push(...links);

            const progress = Math.round((page / maxPages) * 100);
            chrome.runtime.sendMessage({
                action: 'communityScrapingProgress',
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
            start.setFullYear(now.getFullYear() - 1);
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
            pinned: true
        }, (tab) => {
            if (chrome.runtime.lastError) {
                console.error('Error creating tab:', JSON.stringify(chrome.runtime.lastError, null, 2));
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            const tabId = tab.id;
            communityOpenTabs.push(tabId);
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
                                cleanupCommunityTab(tabId);
                                reject(new Error('Tab no longer exists'));
                                return;
                            }

                            chrome.scripting.executeScript({
                                target: { tabId: tabId },
                                func: extractLinksFromPage,
                                args: [source, keyword]
                            }, (results) => {
                                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                                cleanupCommunityTab(tabId);

                                if (chrome.runtime.lastError) {
                                    console.error('Error extracting links:', JSON.stringify(chrome.runtime.lastError, null, 2));
                                    reject(new Error(chrome.runtime.lastError.message || 'Unknown script execution error'));
                                    return;
                                }

                                const pageText = results && results[0] && results[0].result ? results[0].result.pageText : '';
                                const links = results && results[0] && results[0].result ? results[0].result.links : [];
                                console.log(`Found ${links.length} links on page ${page}`);
                                resolve({ links, pageContent: pageText });
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
                    cleanupCommunityTab(tabId);
                    reject(new Error('Tab was closed unexpectedly'));
                }
            };

            chrome.tabs.onRemoved.addListener(onTabRemoved);

            setTimeout(() => {
                if (!hasProcessed) {
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    chrome.tabs.onRemoved.removeListener(onTabRemoved);
                    cleanupCommunityTab(tabId);
                    reject(new Error('Timeout loading Bing page'));
                }
            }, 30000);
        });
    });
}

export function extractLinksFromPage(source, keyword) {
    console.log('Extracting WhatsApp links from page');
    const results = [];
    const linkRegex = /https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/g;
    const pageText = document.body.textContent;

    console.log('Page content length:', pageText.length);
    console.log('Sample page content (first 500 chars):', pageText.substring(0, 500));

    if (pageText.includes('CAPTCHA') || pageText.includes('Please verify you are not a robot')) {
        console.warn('CAPTCHA detected on Bing page. Please verify manually and restart scraping.');
        chrome.runtime.sendMessage({
            action: 'communityScrapingError',
            data: 'CAPTCHA detected. Please verify manually.'
        });
        return { links: [], pageText };
    }

    let match;
    while ((match = linkRegex.exec(pageText)) !== null) {
        const link = match[0];
        const start = Math.max(0, match.index - 50);
        const end = Math.min(pageText.length, match.index + link.length + 50);
        const snippet = pageText.substring(start, end).replace(/\s+/g, ' ').trim();

        if (!results.some(r => r.link === link)) {
            results.push({
                link: link,
                overview: snippet,
                source: source.charAt(0).toUpperCase() + source.slice(1),
                keyword: keyword
            });
        }
    }

    console.log(`Found ${results.length} WhatsApp links on this page`);
    return { links: results, pageText };
}

export function stopCommunityScraping() {
    console.log('Stopping community scraping');
    isCommunityScraping = false;
    cleanupCommunityTabs();
}

export function cleanupCommunityTabs() {
    console.log('Cleaning up community tabs');
    communityOpenTabs.forEach(tabId => {
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
    communityOpenTabs = [];
}

export function cleanupCommunityTab(tabId) {
    console.log(`Cleaning up community tab ${tabId}`);
    communityOpenTabs = communityOpenTabs.filter(id => id !== tabId);
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