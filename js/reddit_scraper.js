function scrapeRedditPage(config) {
    const { subreddit, keywords, maxPosts } = config;
    const results = [];
    
    // Find all posts on the page
    const posts = document.querySelectorAll('shreddit-post');
    
    for (let i = 0; i < Math.min(posts.length, maxPosts); i++) {
        const post = posts[i];
        
        try {
            // Extract title
            const titleElem = post.querySelector('[slot="title"]');
            const title = titleElem ? titleElem.textContent.trim() : '';
            
            // Check if post contains any of the keywords
            if (keywords && keywords.length > 0) {
                const hasKeyword = keywords.some(keyword => 
                    title.toLowerCase().includes(keyword.toLowerCase())
                );
                
                if (!hasKeyword) continue;
            }
            
            // Extract author
            const authorElem = post.querySelector('a[href*="/user/"]');
            const author = authorElem ? authorElem.textContent.trim() : 'N/A';
            
            // Extract post URL
            const postUrl = post.getAttribute('permalink');
            const fullUrl = postUrl && !postUrl.startsWith('http') ? 
                `https://www.reddit.com${postUrl}` : postUrl;
            
            // Extract timestamp
            const timeElem = post.querySelector('time');
            const timestamp = timeElem ? timeElem.getAttribute('datetime') : 'N/A';
            
            // Extract upvotes
            const voteElem = post.querySelector('[id*="vote-arrows"]') || 
                            post.querySelector('[data-testid="post-upvote-button"]');
            const votes = voteElem ? voteElem.textContent.trim() : '0';
            
            // Extract content
            const contentElem = post.querySelector('[slot="text-body"]');
            const content = contentElem ? contentElem.textContent.trim() : 'N/A';
            
            // Extract comments count
            const commentsElem = post.querySelector('a[href*="/comments/"]');
            const comments = commentsElem ? commentsElem.textContent.trim() : '0 comments';
            
            // Extract price if available
            const priceMatch = title.match(/(\$|\£|\€)\s*\d+/);
            const price = priceMatch ? priceMatch[0] : 'N/A';
            
            // Extract location if available
            const locationMatch = title.match(/\[(.*?)\]/);
            const location = locationMatch ? locationMatch[1] : 'N/A';
            
            results.push({
                source: 'reddit',
                subreddit,
                title,
                content,
                author,
                url: fullUrl,
                timestamp,
                votes,
                comments,
                price,
                location,
                scraped_at: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error processing post:', error);
        }
    }
    
    return results;
}