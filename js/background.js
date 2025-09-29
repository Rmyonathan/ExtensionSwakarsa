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
let openTabs = [];
let activeOperations = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    try {
        console.log('Message received:', request.action);
        if (request.action === 'startScraping') {
            if (isScraping) {
                sendResponse({ status: 'already_running' });
                return false;
            }
            startScraping(request.config);
            sendResponse({ status: 'started' });
            return false;
        } else if (request.action === 'stopScraping') {
            stopScraping();
            sendResponse({ status: 'stopped' });
            return false;
        } else if (request.action === 'startContactScraping') {
            if (isContactScraping) {
                sendResponse({ status: 'already_running' });
                return false;
            }
            startContactScraping(request.config).then(() => {
                sendResponse({ status: 'started' });
            }).catch(error => {
                console.error('Error starting contact scraping:', error);
                sendResponse({ status: 'error', message: error.message });
            });
            return true;
        } else if (request.action === 'stopContactScraping') {
            stopContactScraping();
            sendResponse({ status: 'stopped' });
            return false;
        } else if (request.action === 'startCommunityScraping') {
            if (isCommunityScraping) {
                sendResponse({ status: 'already_running' });
                return false;
            }
            startCommunityScraping(request.config).then(() => {
                sendResponse({ status: 'started' });
            }).catch(error => {
                console.error('Error starting community scraping:', error);
                sendResponse({ status: 'error', message: error.message });
            });
            return true;
        } else if (request.action === 'stopCommunityScraping') {
            stopCommunityScraping();
            sendResponse({ status: 'stopped' });
            return false;
        } else if (request.action === 'contactScrapingProgress') {
            chrome.runtime.sendMessage({
                action: 'contactScrapingProgress',
                data: request.data
            });
            sendResponse({ status: 'progress_updated' });
            return false;
        } else if (request.action === 'contactScrapingComplete') {
            chrome.runtime.sendMessage({
                action: 'contactScrapingComplete',
                data: request.data
            });
            sendResponse({ status: 'completed' });
            return false;
        } else if (request.action === 'contactScrapingError') {
            chrome.runtime.sendMessage({
                action: 'contactScrapingError',
                data: request.data
            });
            sendResponse({ status: 'error' });
            return false;
        } else if (request.action === 'communityScrapingProgress') {
            chrome.runtime.sendMessage({
                action: 'communityScrapingProgress',
                data: request.data
            });
            sendResponse({ status: 'progress_updated' });
            return false;
        } else if (request.action === 'communityScrapingComplete') {
            chrome.runtime.sendMessage({
                action: 'communityScrapingComplete',
                data: request.data
            });
            sendResponse({ status: 'completed' });
            return false;
        } else if (request.action === 'communityScrapingError') {
            chrome.runtime.sendMessage({
                action: 'communityScrapingError',
                data: request.data
            });
            sendResponse({ status: 'error' });
            return false;
        } else if (request.action === 'groupContactScraping') {
            // Group contact scraping is handled entirely on the client side
            // No background processing needed
            sendResponse({ status: 'handled_locally' });
            return false;
        } else {
            sendResponse({ status: 'unknown_action' });
            return false;
        }
    } catch (error) {
        console.error('Error in message listener:', error);
        sendResponse({ status: 'error', message: error.message });
        return false;
    }
});

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

// Include your existing fetchSubredditData, scrapeInstagramWithTab, scrapeInstagramPage, cleanupTab, cleanupOperation, and stopScraping functions here (unchanged)
// import {
//     isContactScraping,
//     contactOpenTabs,
//     contactScrapingConfig,
//     startContactScraping,
//     stopContactScraping,
//     scrapeBingForEmails,
//     scrapeBingPage,
//     extractEmailsFromPage,
//     cleanupContactTabs,
//     cleanupContactTab
// } from './contact_scraper.js';

// // let isContactScraping = false;
// // let contactOpenTabs = [];
// // let contactScrapingConfig = null;

// let isScraping = false;
// let openTabs = [];
// let activeOperations = new Map();

// chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//     if (request.action === 'startScraping') {
//         if (isScraping) {
//             sendResponse({ status: 'already_running' });
//             return;
//         }
//         startScraping(request.config);
//         sendResponse({ status: 'started' });
//     } else if (request.action === 'stopScraping') {
//         stopScraping();
//         sendResponse({ status: 'stopped' });
//     } else if (request.action === 'startContactScraping') {
//         if (isContactScraping) {
//             sendResponse({ status: 'already_running' });
//             return;
//         }
//         startContactScraping(request.config);
//         sendResponse({ status: 'started' });
//     } else if (request.action === 'stopContactScraping') {
//         stopContactScraping();
//         sendResponse({ status: 'stopped' });
//     } else if (request.action === 'contactScrapingProgress') {
//         chrome.runtime.sendMessage({
//             action: 'contactScrapingProgress',
//             data: request.data
//         });
//     } else if (request.action === 'contactScrapingComplete') {
//         chrome.runtime.sendMessage({
//             action: 'contactScrapingComplete',
//             data: request.data
//         });
//     } else if (request.action === 'contactScrapingError') {
//         chrome.runtime.sendMessage({
//             action: 'contactScrapingError',
//             data: request.data
//         });
//     }
//     return true;
// });

// async function startScraping(config) {
//     isScraping = true;
//     openTabs = [];
//     let allResults = [];

//     // Scrape Reddit if configured
//     if (config.redditConfig && config.redditConfig.subreddits) {
//         const subreddits = config.redditConfig.subreddits.split(',').map(s => s.trim()).filter(s => s);
//         const keywords = config.redditConfig.keywords.split(',').map(k => k.trim()).filter(k => k);
//         const maxPosts = config.redditConfig.maxPosts;

//         const totalRedditSources = subreddits.length;
//         let completedRedditSources = 0;

//         for (const subreddit of subreddits) {
//             if (!isScraping) break;

//             try {
//                 const results = await fetchSubredditData(subreddit, keywords, maxPosts);
//                 allResults = allResults.concat(results);

//                 completedRedditSources++;
//                 const progress = Math.round((completedRedditSources / totalRedditSources) * 50);

//                 chrome.runtime.sendMessage({
//                     action: 'scrapingProgress',
//                     data: progress
//                 });
//             } catch (error) {
//                 console.error(`Error scraping r/${subreddit}:`, error);
//                 chrome.runtime.sendMessage({
//                     action: 'scrapingError',
//                     data: `Failed to scrape r/${subreddit}: ${error.message}`
//                 });
//             }
//         }
//     }

//     // Scrape Instagram if configured
//     if (config.instagramConfig && config.instagramConfig.hashtags && isScraping) {
//         const hashtags = config.instagramConfig.hashtags.split(',').map(h => h.trim()).filter(h => h);
//         const keywords = config.instagramConfig.keywords.split(',').map(k => k.trim()).filter(k => k);
//         const maxPosts = config.instagramConfig.maxPosts;

//         const totalInstagramSources = hashtags.length;
//         let completedInstagramSources = 0;

//         for (const hashtag of hashtags) {
//             if (!isScraping) break;

//             try {
//                 // Use tab-based scraping directly
//                 const results = await scrapeInstagramWithTab(hashtag, keywords, maxPosts);
//                 allResults = allResults.concat(results);

//                 completedInstagramSources++;
//                 const progress = config.redditConfig
//                     ? 50 + Math.round((completedInstagramSources / totalInstagramSources) * 50)
//                     : Math.round((completedInstagramSources / totalInstagramSources) * 100);

//                 chrome.runtime.sendMessage({
//                     action: 'scrapingProgress',
//                     data: progress
//                 });

//                 // Add a delay between requests
//                 if (isScraping && completedInstagramSources < totalInstagramSources) {
//                     await new Promise(resolve => setTimeout(resolve, 2000));
//                 }
//             } catch (error) {
//                 console.error(`Error scraping #${hashtag}:`, error);
//                 chrome.runtime.sendMessage({
//                     action: 'scrapingError',
//                     data: `Failed to scrape #${hashtag}: ${error.message}`
//                 });
//             }
//         }
//     }

//     if (isScraping) {
//         chrome.runtime.sendMessage({
//             action: 'scrapingComplete',
//             data: allResults
//         });
//     }

//     isScraping = false;
//     openTabs = [];
// }

// Improved Instagram tab-based scraping with better error handling
// async function scrapeInstagramWithTab(hashtag, keywords, maxPosts) {
//     return new Promise((resolve, reject) => {
//         const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
//         let tabId = null;
//         let isResolved = false;
        
//         // Create tab in a more stealthy way
//         chrome.tabs.create({ 
//             url: url, 
//             active: false,
//             pinned: true // Pinned tabs are less likely to be closed
//         }, (tab) => {
//             if (chrome.runtime.lastError) {
//                 reject(new Error(chrome.runtime.lastError.message));
//                 return;
//             }
            
//             tabId = tab.id;
//             openTabs.push(tabId);
            
//             // Add a listener for tab removal
//             const onTabRemoved = (closedTabId, removeInfo) => {
//                 if (closedTabId === tabId && !isResolved) {
//                     reject(new Error('Tab was closed by Instagram'));
//                     chrome.tabs.onRemoved.removeListener(onTabRemoved);
//                 }
//             };
            
//             chrome.tabs.onRemoved.addListener(onTabRemoved);
            
//             // Add a listener for tab updates
//             const onTabUpdated = (updatedTabId, changeInfo, tabInfo) => {
//                 if (updatedTabId === tabId && changeInfo.status === 'complete' && !isResolved) {
//                     // Wait a bit longer for Instagram's JavaScript to fully load
//                     setTimeout(() => {
//                         executeContentScript();
//                     }, 3000);
                    
//                     // Remove the listener after first complete
//                     chrome.tabs.onUpdated.removeListener(onTabUpdated);
//                 }
//             };
            
//             chrome.tabs.onUpdated.addListener(onTabUpdated);
            
//             // Set a timeout for the entire operation
//             const timeoutId = setTimeout(() => {
//                 if (!isResolved) {
//                     cleanupTab(tabId);
//                     reject(new Error('Timeout while loading Instagram page'));
//                     chrome.tabs.onUpdated.removeListener(onTabUpdated);
//                     chrome.tabs.onRemoved.removeListener(onTabRemoved);
//                 }
//             }, 45000); // 45 seconds timeout
            
//             const executeContentScript = () => {
//                 chrome.scripting.executeScript({
//                     target: { tabId: tabId },
//                     func: scrapeInstagramPage,
//                     args: [{ hashtag, keywords, maxPosts }]
//                 }, (results) => {
//                     isResolved = true;
//                     clearTimeout(timeoutId);
                    
//                     // Clean up listeners
//                     chrome.tabs.onUpdated.removeListener(onTabUpdated);
//                     chrome.tabs.onRemoved.removeListener(onTabRemoved);
                    
//                     // Always close the tab
//                     cleanupTab(tabId);
                    
//                     if (chrome.runtime.lastError) {
//                         reject(new Error(chrome.runtime.lastError.message));
//                         return;
//                     }
                    
//                     if (results && results[0] && results[0].result) {
//                         resolve(results[0].result);
//                     } else {
//                         resolve([]);
//                     }
//                 });
//             };
//         });
//     });
// }

// Helper function to clean up a tab
function cleanupTab(tabId) {
    if (tabId) {
        // Remove from openTabs array
        openTabs = openTabs.filter(id => id !== tabId);
        
        // Try to close the tab, but ignore errors
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                // Tab was already closed, which is fine
            }
        });
    }
}

// Helper function to clean up an operation
function cleanupOperation(operationId, tabId) {
    cleanupTab(tabId);
    if (activeOperations.has(operationId)) {
        activeOperations.delete(operationId);
    }
}

function stopScraping() {
    isScraping = false;
    
    // Reject all active operations
    for (const [operationId, operation] of activeOperations.entries()) {
        operation.reject(new Error('Scraping was stopped'));
        cleanupOperation(operationId, operation.tabId);
    }
    
    // Close all open tabs
    openTabs.forEach(tabId => {
        chrome.tabs.remove(tabId, () => {
            if (chrome.runtime.lastError) {
                // Tab was already closed, which is fine
            }
        });
    });
    
    openTabs = [];
}

// Reddit API-based scraping (keep this as it's working)
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
            
            // Check if post contains any of the keywords
            if (keywords && keywords.length > 0) {
                const hasKeyword = keywords.some(keyword => 
                    title.toLowerCase().includes(keyword.toLowerCase())
                );
                
                if (!hasKeyword) continue;
            }
            
            // Extract price if available
            const priceMatch = title.match(/(\$|\£|\€)\s*\d+/);
            const price = priceMatch ? priceMatch[0] : 'N/A';
            
            // Extract location if available
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

// Content script function to scrape Instagram page
function scrapeInstagramPage(config) {
    const { hashtag, keywords, maxPosts } = config;
    const results = [];

    // Function to scroll the page
    function scrollPage() {
        return new Promise((resolve) => {
            let lastHeight = 0;
            let sameHeightCount = 0;
            const maxAttempts = 5; // Try scrolling 5 times to load more posts

            const scrollInterval = setInterval(() => {
                window.scrollTo(0, document.body.scrollHeight);
                const newHeight = document.body.scrollHeight;

                if (newHeight === lastHeight) {
                    sameHeightCount++;
                    if (sameHeightCount >= 3) {
                        // Stop if page height doesn't change after 3 attempts
                        clearInterval(scrollInterval);
                        resolve();
                    }
                } else {
                    sameHeightCount = 0;
                    lastHeight = newHeight;
                }

                if (results.length >= maxPosts) {
                    // Stop if we have enough posts
                    clearInterval(scrollInterval);
                    resolve();
                }
            }, 2000); // Scroll every 2 seconds

            // Stop after maxAttempts to avoid infinite loop
            setTimeout(() => {
                clearInterval(scrollInterval);
                resolve();
            }, maxAttempts * 2000);
        });
    }

    try {
        console.log('Starting Instagram scraping...');

        // Check for login or suspension
        if (document.querySelector('form[action*="/accounts/login/"]')) {
            console.error('Instagram requires login');
            return [];
        }
        if (document.querySelector('h2') && document.querySelector('h2').textContent.includes('suspended')) {
            console.error('Instagram has suspended this action');
            return [];
        }

        // Scroll to load more posts
        return new Promise((resolve) => {
            scrollPage().then(() => {
                // Try multiple selectors to find posts
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

                // Fallback: look for any elements containing post links
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

                    // Extract information (same as original)
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

// Updated function to handle Instagram scraping
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
                    }, 5000); // Increased to 5 seconds
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