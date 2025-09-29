// Instagram scraper using a more robust approach
async function scrapeInstagramData(hashtag, keywords, maxPosts) {
    try {
        // Use Instagram's JSON API if possible
        const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
        
        // Try to fetch data from the API
        try {
            const response = await fetch(url);
            const html = await response.text();
            
            // Extract JSON data from the HTML
            const jsonData = extractInstagramDataFromHTML(html);
            if (jsonData) {
                return processInstagramData(jsonData, hashtag, keywords, maxPosts);
            }
        } catch (error) {
            console.log('Instagram API approach failed, trying alternative method');
        }
        
        // If API approach fails, use a more direct method
        return await scrapeInstagramWithTab(hashtag, keywords, maxPosts);
    } catch (error) {
        console.error('Instagram scraping error:', error);
        throw new Error(`Failed to scrape Instagram: ${error.message}`);
    }
}

function extractInstagramDataFromHTML(html) {
    try {
        // Try to find the JSON data in the HTML
        const regex = /window\.__initialDataLoaded\(.*?\);/g;
        const matches = html.match(regex);
        
        if (matches && matches.length > 0) {
            // Extract the JSON part
            const jsonStr = matches[0]
                .replace('window.__initialDataLoaded(', '')
                .replace(');', '');
            
            return JSON.parse(jsonStr);
        }
        
        // Alternative pattern
        const alternativeRegex = /<script type="text\/javascript">window\._sharedData = (.*?);<\/script>/;
        const alternativeMatch = html.match(alternativeRegex);
        
        if (alternativeMatch && alternativeMatch[1]) {
            return JSON.parse(alternativeMatch[1]);
        }
        
        return null;
    } catch (error) {
        console.error('Error extracting Instagram data:', error);
        return null;
    }
}

function processInstagramData(jsonData, hashtag, keywords, maxPosts) {
    const results = [];
    
    try {
        // Extract posts from the JSON data
        let posts = [];
        
        // Try different possible locations for posts data
        if (jsonData.entry_data && jsonData.entry_data.TagPage) {
            posts = jsonData.entry_data.TagPage[0].graphql.hashtag.edge_hashtag_to_media.edges;
        } else if (jsonData.graphql && jsonData.graphql.hashtag) {
            posts = jsonData.graphql.hashtag.edge_hashtag_to_media.edges;
        }
        
        // Process each post
        for (let i = 0; i < Math.min(posts.length, maxPosts); i++) {
            const post = posts[i].node;
            
            // Extract caption
            const caption = post.edge_media_to_caption && post.edge_media_to_caption.edges.length > 0 
                ? post.edge_media_to_caption.edges[0].node.text 
                : '';
            
            // Check if post contains any of the keywords
            if (keywords && keywords.length > 0) {
                const hasKeyword = keywords.some(keyword => 
                    caption.toLowerCase().includes(keyword.toLowerCase())
                );
                
                if (!hasKeyword) continue;
            }
            
            // Extract price if mentioned in caption
            const priceMatch = caption.match(/(\$|\£|\€)\s*\d+/);
            const price = priceMatch ? priceMatch[0] : 'N/A';
            
            // Extract location if available
            const location = post.location ? post.location.name : 'N/A';
            
            results.push({
                source: 'instagram',
                hashtag: hashtag,
                title: caption.substring(0, 50) + (caption.length > 50 ? '...' : ''),
                content: caption,
                author: post.owner.username,
                author_id: post.owner.id,
                url: `https://www.instagram.com/p/${post.shortcode}/`,
                timestamp: new Date(post.taken_at_timestamp * 1000).toISOString(),
                likes: post.edge_media_preview_like ? post.edge_media_preview_like.count : 0,
                comments: post.edge_media_to_comment ? post.edge_media_to_comment.count : 0,
                price: price,
                location: location,
                is_video: post.is_video,
                scraped_at: new Date().toISOString()
            });
        }
        
        return results;
    } catch (error) {
        console.error('Error processing Instagram data:', error);
        throw new Error('Failed to process Instagram data');
    }
}

async function scrapeInstagramWithTab(hashtag, keywords, maxPosts) {
    return new Promise((resolve, reject) => {
        const url = `https://www.instagram.com/explore/tags/${hashtag}/`;
        
        chrome.tabs.create({ url, active: false }, (tab) => {
            // Wait for tab to load
            setTimeout(() => {
                chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: scrapeInstagramPage,
                    args: [{ hashtag, keywords, maxPosts }]
                }, (results) => {
                    // Close the tab
                    chrome.tabs.remove(tab.id);
                    
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
            }, 5000); // Wait 5 seconds for page to load
        });
    });
}

// Content script function to scrape Instagram page
function scrapeInstagramPage(config) {
    const { hashtag, keywords, maxPosts } = config;
    const results = [];
    
    try {
        // Find all post elements
        const postElements = document.querySelectorAll('article div > div > div > div a');
        
        for (let i = 0; i < Math.min(postElements.length, maxPosts); i++) {
            const postElement = postElements[i];
            const url = postElement.href;
            
            // Extract basic information
            const imageElement = postElement.querySelector('img');
            const altText = imageElement ? imageElement.alt : '';
            
            // For a more complete implementation, we would need to click on each post
            // and extract detailed information, but this is complex and might be detected
            
            results.push({
                source: 'instagram',
                hashtag: hashtag,
                title: 'Instagram Post',
                content: altText || 'Content not available',
                author: 'N/A',
                url: url,
                timestamp: new Date().toISOString(),
                likes: 'N/A',
                comments: 'N/A',
                price: 'N/A',
                location: 'N/A',
                scraped_at: new Date().toISOString(),
                note: 'Limited data available due to Instagram restrictions'
            });
        }
        
        return results;
    } catch (error) {
        console.error('Error scraping Instagram page:', error);
        return [];
    }
}