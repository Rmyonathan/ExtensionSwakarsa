document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('open-dashboard').addEventListener('click', function() {
        chrome.tabs.create({
            url: chrome.runtime.getURL('dashboard.html')
        });
    });
});