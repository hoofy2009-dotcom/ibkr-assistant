chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Standard GET fetch for Yahoo Finance
    if (request.action === "FETCH_DATA") {
        fetch(request.url, { 
            credentials: 'omit', 
            cache: 'no-store',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://finance.yahoo.com/'
            }
        })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text(); // Return text/json string
            })
            .then(data => sendResponse({ success: true, data: data }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true; 
    }

    // Generic API Proxy (POST/GET with Headers/Body) for AI Services
    if (request.action === "FETCH_AI") {
        fetch(request.url, {
            method: request.method || "POST",
            headers: request.headers || { "Content-Type": "application/json" },
            body: request.body ? JSON.stringify(request.body) : null
        })
        .then(async response => {
            if (!response.ok) {
                const txt = await response.text();
                throw new Error(`HTTP ${response.status}: ${txt}`);
            }
            return response.json();
        })
        .then(data => sendResponse({ success: true, data: data }))
        .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }
});