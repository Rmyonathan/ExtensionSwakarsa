import {
    isContactScraping,
    startContactScraping,
    stopContactScraping
} from './contact_scraper.js';
import {
    isCommunityScraping,
    startCommunityScraping,
    stopCommunityScraping
} from './community_scraper.js';

let isScraping = false;
let isWhatsAppAutomating = false;
let openTabs = [];
let activeOperations = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Message received:', request?.action);

    const safeSend = (data) => {
        try { sendResponse(data); } 
        catch (e) { console.warn('Failed to send response (port closed?):', e); }
    };

    const asyncWrap = (fn) => {
        Promise.resolve()
            .then(() => fn())
            .then(res => safeSend(res ?? { status: 'ok' }))
            .catch(err => {
                console.error('Async handler error:', err);
                safeSend({ status: 'error', message: err?.message ?? String(err) });
            });
        return true; // keep channel open until we call sendResponse via safeSend
    };

    try {
        switch (request.action) {
            case 'startScraping':
                if (isScraping) { safeSend({ status: 'already_running' }); return false; }
                startScraping(request.config);
                safeSend({ status: 'started' });
                return false;

            case 'stopScraping':
                stopScraping();
                safeSend({ status: 'stopped' });
                return false;

            case 'startContactScraping':
                if (isContactScraping) { safeSend({ status: 'already_running' }); return false; }
                return asyncWrap(() => startContactScraping(request.config).then(() => ({ status: 'started' })));

            case 'stopContactScraping':
                stopContactScraping();
                safeSend({ status: 'stopped' });
                return false;

            case 'startCommunityScraping':
                if (isCommunityScraping) { safeSend({ status: 'already_running' }); return false; }
                return asyncWrap(() => startCommunityScraping(request.config).then(() => ({ status: 'started' })));

            case 'stopCommunityScraping':
                stopCommunityScraping();
                safeSend({ status: 'stopped' });
                return false;

            case 'contactScrapingProgress':
            case 'contactScrapingComplete':
            case 'contactScrapingError':
            case 'contactScrapingNewContacts':
                // Forward to all extension pages but don't wait for response
                chrome.runtime.sendMessage(request).catch(err => {
                    console.log('No active popup/dashboard to receive message:', request.action);
                });
                safeSend({ status: 'forwarded' });
                return false;
            case 'communityScrapingProgress':
            case 'communityScrapingComplete':
            case 'communityScrapingError':
                // forward events to popup/dashboard or other listeners
                chrome.runtime.sendMessage({
                    action: request.action,
                    data: request.data
                });
                safeSend({ status: 'ok' });
                return false;

            case 'startWhatsAppAutomation':
                if (isWhatsAppAutomating) { safeSend({ status: 'already_running' }); return false; }
                return asyncWrap(() => startWhatsAppAutomation(request.numbers, request.messages).then(() => ({ status: 'completed' })));

            case 'groupContactScraping':
                safeSend({ status: 'handled_locally' });
                return false;

            default:
                safeSend({ status: 'unknown_action' });
                return false;
        }
    } catch (err) {
        console.error('Listener top-level error:', err);
        safeSend({ status: 'error', message: err?.message ?? String(err) });
        return false;
    }
});

async function startWhatsAppAutomation(numbers, messages) {
    if (isWhatsAppAutomating) {
        console.warn('Automation already running');
        return;
    }

    isWhatsAppAutomating = true;
    console.log('Starting WhatsApp automation for numbers:', numbers, 'with messages:', messages);

    let waTabId = null;

    try {
        for (let i = 0; i < numbers.length; i++) {
            if (!isWhatsAppAutomating) break;

            let number = numbers[i];
            if (!number.startsWith('+')) number = '+' + number;

            for (let j = 0; j < messages.length; j++) {
                const { text, attachment } = messages[j];
                const encodedMessage = text ? encodeURIComponent(text) : '';
                const chatUrl = `https://web.whatsapp.com/send?phone=${number}${text ? `&text=${encodedMessage}` : ''}`;
                console.log(`Navigating to chat for ${number} with URL: ${chatUrl}`);

                waTabId = await new Promise((resolve, reject) => {
                    if (waTabId) {
                        chrome.tabs.update(waTabId, { url: chatUrl, active: false }, (tab) => {
                            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                            resolve(tab.id);
                        });
                    } else {
                        chrome.tabs.create({ url: chatUrl, active: false }, (tab) => {
                            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                            openTabs.push(tab.id);
                            waTabId = tab.id;
                            resolve(tab.id);
                        });
                    }
                });

                await new Promise((resolve, reject) => {
                    let done = false;
                    const listener = (id, changeInfo) => {
                        if (id === waTabId && changeInfo.status === 'complete') {
                            done = true;
                            chrome.tabs.onUpdated.removeListener(listener);
                            console.log(`Tab ${waTabId} loaded for ${number}`);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(listener);
                    setTimeout(() => {
                        if (!done) {
                            chrome.tabs.onUpdated.removeListener(listener);
                            console.warn(`Timeout waiting for ${number}, continuing anyway`);
                            resolve();
                        }
                    }, 20000);
                });

                await new Promise((resolve, reject) => {
                    chrome.scripting.executeScript({
                        target: { tabId: waTabId },
                        files: ['js/wa-auto.js']
                    }, () => {
                        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));

                        chrome.scripting.executeScript({
                            target: { tabId: waTabId },
                            func: (num, msg, att) => {
                                if (typeof window.sendWhatsAppMessage === 'function') {
                                    return window.sendWhatsAppMessage(num, msg, att);
                                } else {
                                    console.error('sendWhatsAppMessage not found');
                                    return false;
                                }
                            },
                            args: [number, text, attachment]
                        }, (results) => {
                            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                            console.log(`Message send result for ${number}:`, results);
                            resolve();
                        });
                    });
                });

                const delay = Math.random() * 15000 + 15000;
                console.log(`Waiting ${Math.round(delay / 1000)}s before next...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }

        console.log('All messages processed.');
        chrome.runtime.sendMessage({
            action: 'updateStatus',
            message: 'All messages sent!',
            status: 'completed'
        });

    } catch (err) {
        console.error('Error during automation:', err);
    } finally {
        isWhatsAppAutomating = false;
        cleanupTab(waTabId);
    }
}

async function startScraping(config) {
    isScraping = true;
    openTabs = [];
    let allResults = [];

    if (config.redditConfig && config.redditConfig.subreddits) {
        const subreddits = config.redditConfig.subreddits.split(',').map(s => s.trim()).filter(s => s);
        const keywords = config.redditConfig.keywords.split(',').map(k => k.trim()).filter(k => k);
        const maxPosts = config.redditConfig.maxPosts;

        const totalRedditSources = subreddits.length;
        let completedRedditSources = 0;

        for (const subreddit of subreddits) {
            if (!isScraping) break;

            try {
                const results = await fetchSubredditData(subreddit, keywords, maxPosts);
                allResults = allResults.concat(results);

                completedRedditSources++;
                const progress = Math.round((completedRedditSources / totalRedditSources) * 50);

                chrome.runtime.sendMessage({
                    action: 'scrapingProgress',
                    data: progress
                });
            } catch (error) {
                console.error(`Error scraping r/${subreddit}:`, error);
                chrome.runtime.sendMessage({
                    action: 'scrapingError',
                    data: `Failed to scrape r/${subreddit}: ${error.message}`
                });
            }
        }
    }

    if (config.instagramConfig && config.instagramConfig.hashtags && isScraping) {
        const hashtags = config.instagramConfig.hashtags.split(',').map(h => h.trim()).filter(h => h);
        const keywords = config.instagramConfig.keywords.split(',').map(k => k.trim()).filter(k => k);
        const maxPosts = config.instagramConfig.maxPosts;

        const totalInstagramSources = hashtags.length;
        let completedInstagramSources = 0;

        for (const hashtag of hashtags) {
            if (!isScraping) break;

            try {
                const results = await scrapeInstagramWithTab(hashtag, keywords, maxPosts);
                allResults = allResults.concat(results);

                completedInstagramSources++;
                const progress = config.redditConfig
                    ? 50 + Math.round((completedInstagramSources / totalInstagramSources) * 50)
                    : Math.round((completedInstagramSources / totalInstagramSources) * 100);

                chrome.runtime.sendMessage({
                    action: 'scrapingProgress',
                    data: progress
                });

                if (isScraping && completedInstagramSources < totalInstagramSources) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.error(`Error scraping #${hashtag}:`, error);
                chrome.runtime.sendMessage({
                    action: 'scrapingError',
                    data: `Failed to scrape #${hashtag}: ${error.message}`
                });
            }
        }
    }

    if (isScraping) {
        chrome.runtime.sendMessage({
            action: 'scrapingComplete',
            data: allResults
        });
    }

    isScraping = false;
    openTabs = [];
}

function cleanupTab(tabId) {
    if (tabId) {
        openTabs = openTabs.filter(id => id !== tabId);
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                // Tab was already closed, which is fine
            }
        });
    }
}

function cleanupOperation(operationId, tabId) {
    cleanupTab(tabId);
    if (activeOperations.has(operationId)) {
        activeOperations.delete(operationId);
    }
}

function stopScraping() {
    isScraping = false;
    for (const [operationId, operation] of activeOperations.entries()) {
        operation.reject(new Error('Scraping was stopped'));
        cleanupOperation(operationId, operation.tabId);
    }
    openTabs.forEach(tabId => {
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                // Tab was already closed, which is fine
            }
        });
    });
    openTabs = [];
}

async function fetchSubredditData(subreddit, keywords, maxPosts) {
    try {
        const response = await fetch(`https://www.reddit.com/r/${subreddit}/.json?limit=${maxPosts}`);
        const data = await response.json();
        
        if (!data || !data.data || !data.data.children) {
            return [];
        }
        
        const results = [];
        const posts = data.data.children;
        
        for (const post of posts) {
            if (!post.data) continue;
            
            const postData = post.data;
            const title = postData.title || '';
            
            if (keywords && keywords.length > 0) {
                const hasKeyword = keywords.some(keyword => 
                    title.toLowerCase().includes(keyword.toLowerCase())
                );
                if (!hasKeyword) continue;
            }
            
            const priceMatch = title.match(/(\$|\£|\€)\s*\d+/);
            const price = priceMatch ? priceMatch[0] : 'N/A';
            
            const locationMatch = title.match(/\[(.*?)\]/);
            const location = locationMatch ? locationMatch[1] : 'N/A';
            
            results.push({
                source: 'reddit',
                subreddit: subreddit,
                title: title,
                content: postData.selftext || 'N/A',
                author: postData.author || 'N/A',
                url: `https://www.reddit.com${postData.permalink}`,
                timestamp: new Date(postData.created_utc * 1000).toISOString(),
                votes: postData.score || 0,
                comments: postData.num_comments || 0,
                price: price,
                location: location,
                scraped_at: new Date().toISOString()
            });
        }
        
        return results;
    } catch (error) {
        console.error(`Error fetching data for r/${subreddit}:`, error);
        throw error;
    }
}

async function scrapeInstagramWithTab(hashtag, keywords, maxPosts) {
    return new Promise((resolve, reject) => {
        const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
        
        chrome.tabs.create({
            url: url,
            active: false,
            pinned: true
        }, (tab) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }

            const tabId = tab.id;
            openTabs.push(tabId);

            const onTabUpdated = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    setTimeout(() => {
                        chrome.scripting.executeScript({
                            target: { tabId: tabId },
                            func: scrapeInstagramPage,
                            args: [{ hashtag, keywords, maxPosts }]
                        }, (results) => {
                            chrome.tabs.onUpdated.removeListener(onTabUpdated);
                            cleanupTab(tabId);

                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }

                            if (results && results[0] && results[0].result) {
                                resolve(results[0].result);
                            } else {
                                resolve([]);
                            }
                        });
                    }, 5000);
                }
            };

            chrome.tabs.onUpdated.addListener(onTabUpdated);

            const onTabRemoved = (closedTabId) => {
                if (closedTabId === tabId) {
                    chrome.tabs.onUpdated.removeListener(onTabUpdated);
                    chrome.tabs.onRemoved.removeListener(onTabRemoved);
                    reject(new Error('Tab was closed unexpectedly'));
                }
            };

            chrome.tabs.onRemoved.addListener(onTabRemoved);

            setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(onTabUpdated);
                chrome.tabs.onRemoved.removeListener(onTabRemoved);
                cleanupTab(tabId);
                reject(new Error('Timeout loading Instagram page'));
            }, 30000);
        });
    });
}

function scrapeInstagramPage(config) {
    const { hashtag, keywords, maxPosts } = config;
    const results = [];

    function scrollPage() {
        return new Promise((resolve) => {
            let lastHeight = 0;
            let sameHeightCount = 0;
            const maxAttempts = 5;

            const scrollInterval = setInterval(() => {
                window.scrollTo(0, document.body.scrollHeight);
                const newHeight = document.body.scrollHeight;

                if (newHeight === lastHeight) {
                    sameHeightCount++;
                    if (sameHeightCount >= 3) {
                        clearInterval(scrollInterval);
                        resolve();
                    }
                } else {
                    sameHeightCount = 0;
                    lastHeight = newHeight;
                }

                if (results.length >= maxPosts) {
                    clearInterval(scrollInterval);
                    resolve();
                }
            }, 2000);

            setTimeout(() => {
                clearInterval(scrollInterval);
                resolve();
            }, maxAttempts * 2000);
        });
    }

    try {
        console.log('Starting Instagram scraping...');

        if (document.querySelector('form[action*="/accounts/login/"]')) {
            console.error('Instagram requires login');
            return [];
        }
        if (document.querySelector('h2') && document.querySelector('h2').textContent.includes('suspended')) {
            console.error('Instagram has suspended this action');
            return [];
        }

        return new Promise((resolve) => {
            scrollPage().then(() => {
                let postElements = [];
                const selectorsToTry = [
                    'article a[href*="/p/"]',
                    'a[href*="/p/"]',
                    'div[role="button"] a[href*="/p/"]',
                    'div > div > a[href*="/p/"]',
                    '[data-testid="post-container"] a[href*="/p/"]'
                ];

                for (const selector of selectorsToTry) {
                    postElements = document.querySelectorAll(selector);
                    if (postElements.length > 0) {
                        console.log(`Found ${postElements.length} posts using selector: ${selector}`);
                        break;
                    }
                }

                if (postElements.length === 0) {
                    const containers = document.querySelectorAll('div > div > div > div');
                    for (const container of containers) {
                        const links = container.querySelectorAll('a[href*="/p/"]');
                        if (links.length > 0) {
                            postElements = links;
                            console.log(`Found ${postElements.length} posts in container`);
                            break;
                        }
                    }
                }

                console.log(`Total posts found: ${postElements.length}`);

                for (let i = 0; i < Math.min(postElements.length, maxPosts); i++) {
                    const postElement = postElements[i];
                    const url = postElement.href;

                    let altText = '';
                    let imageElement = postElement.querySelector('img');

                    if (imageElement) {
                        altText = imageElement.alt || '';
                    } else {
                        let parent = postElement;
                        for (let j = 0; j < 5; j++) {
                            parent = parent.parentElement;
                            if (!parent) break;
                            imageElement = parent.querySelector('img');
                            if (imageElement) {
                                altText = imageElement.alt || '';
                                break;
                            }
                        }
                    }

                    let likes = 'N/A';
                    let comments = 'N/A';
                    const engagementElement = postElement.closest('div')?.querySelector('[aria-label*="like"]') ||
                                            postElement.closest('div')?.querySelector('[aria-label*="comment"]');

                    if (engagementElement) {
                        const engagementText = engagementElement.getAttribute('aria-label') || '';
                        const likeMatch = engagementText.match(/(\d+(\.\d+)?[KM]?)\s+likes/);
                        const commentMatch = engagementText.match(/(\d+(\.\d+)?[KM]?)\s+comments/);

                        if (likeMatch) likes = likeMatch[1];
                        if (commentMatch) comments = commentMatch[1];
                    }

                    if (keywords && keywords.length > 0) {
                        const hasKeyword = keywords.some(keyword =>
                            altText.toLowerCase().includes(keyword.toLowerCase())
                        );
                        if (!hasKeyword) continue;
                    }

                    results.push({
                        source: 'instagram',
                        hashtag: hashtag,
                        title: 'Instagram Post',
                        content: altText || 'Content not available',
                        author: 'N/A',
                        url: url,
                        timestamp: new Date().toISOString(),
                        likes: likes,
                        comments: comments,
                        price: 'N/A',
                        location: 'N/A',
                        scraped_at: new Date().toISOString(),
                        note: 'Data may be limited due to Instagram restrictions'
                    });
                }

                resolve(results);
            });
        });
    } catch (error) {
        console.error('Error scraping Instagram page:', error);
        return [];
    }
}