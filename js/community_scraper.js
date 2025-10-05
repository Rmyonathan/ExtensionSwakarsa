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

        // Scrape Facebook
        if (config.facebookConfig && config.facebookConfig.keywords && isCommunityScraping) {
            console.log('Starting Facebook community scraping');
            const facebookResults = await scrapeBingForLinks(
                'facebook',
                config.facebookConfig.keywords,
                config.facebookConfig.dateRange,
                config.facebookConfig.location
            );
            allResults = allResults.concat(facebookResults);
        }

        // Scrape TikTok
        if (config.tiktokConfig && config.tiktokConfig.keywords && isCommunityScraping) {
            console.log('Starting TikTok community scraping');
            const tiktokResults = await scrapeBingForLinks(
                'tiktok',
                config.tiktokConfig.keywords,
                config.tiktokConfig.dateRange,
                config.tiktokConfig.location
            );
            allResults = allResults.concat(tiktokResults);
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

    console.log('Google query:', fullQuery);

    try {
        console.log(`Starting recursive pagination for ${source}`);
        const { links, pageContent } = await scrapeBingPageForLinks(fullQuery, 1, source, keywords);
        
        console.log(`Total unique WhatsApp links found for ${source}: ${links.length}`);
        return links;
        
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

export async function scrapeBingPageForLinks(query, page, source, keyword) {
    console.log(`Opening Google page ${page} for query: ${query}`);
    return new Promise((resolve, reject) => {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        chrome.tabs.create({ url, active: false, pinned: true }, (tab) => {
            if (chrome.runtime.lastError) {
                return reject(new Error(chrome.runtime.lastError.message));
            }

            const tabId = tab.id;
            communityOpenTabs.push(tabId);

            let hasProcessed = false;
            let collectedLinks = [];

            const scrapeLoop = (attempt = 1) => {
                if (!isCommunityScraping || attempt > 5) {
                    cleanupCommunityTab(tabId);
                    resolve({ links: collectedLinks, pageContent: '' });
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

                        // Extract WhatsApp links and get page text
                        const linkRegex = /https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+/g;
                        const pageText = document.body.innerText;
                        const matches = [...new Set(pageText.match(linkRegex) || [])];

                        // Try to find and click the "Next" button
                        const nextBtn = [...document.querySelectorAll('a')]
                            .find(a => a.innerText.toLowerCase().includes('next'));

                        if (nextBtn) {
                            nextBtn.click();
                            return { 
                                links: matches, 
                                hasNext: true,
                                pageText: pageText
                            };
                        } else {
                            return { 
                                links: matches, 
                                hasNext: false,
                                pageText: pageText
                            };
                        }
                    }
                }, (results) => {
                    if (chrome.runtime.lastError) {
                        cleanupCommunityTab(tabId);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    const result = results?.[0]?.result;
                    if (!result) {
                        cleanupCommunityTab(tabId);
                        reject(new Error('No result returned'));
                        return;
                    }

                    // Process new links with context and duplicate filtering
                    const newLinks = result.links.map(link => {
                        // Find context around the link
                        const linkIndex = result.pageText.indexOf(link);
                        let context = `Found on ${source} search`;
                        
                        if (linkIndex !== -1) {
                            const start = Math.max(0, linkIndex - 100);
                            const end = Math.min(result.pageText.length, linkIndex + link.length + 100);
                            context = result.pageText.substring(start, end).replace(/\s+/g, ' ').trim();
                        }
                        
                        return {
                            link: link,
                            overview: context,
                            source: source.charAt(0).toUpperCase() + source.slice(1),
                            keyword: keyword
                        };
                    });

                    // Better duplicate filtering - check exact link match
                    const uniqueNewLinks = newLinks.filter(newLink => 
                        !collectedLinks.some(existing => existing.link === newLink.link)
                    );

                    collectedLinks.push(...uniqueNewLinks);

                    console.log(`Collected ${collectedLinks.length} so far (attempt ${attempt})`);

                    if (result.hasNext && attempt < 10) {
                        // Wait for next page to load, then scrape again
                        setTimeout(() => scrapeLoop(attempt + 1), 4000 + Math.random() * 2000);
                    } else {
                        cleanupCommunityTab(tabId);
                        resolve({ links: collectedLinks, pageContent: '' });
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