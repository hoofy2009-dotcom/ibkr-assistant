chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // Standard GET fetch for Yahoo Finance (API + HTML)
    if (request.action === "FETCH_DATA") {
        // 区分API请求和HTML页面请求
        const isHtmlPage = request.url.includes('/quote/') && !request.url.includes('query1.finance');
        
        const headers = isHtmlPage ? {
            // HTML页面请求 - 完全模拟浏览器
            // 注意: Sec-Fetch-* 头是禁止手动设置的，必须移除，否则会导致 "Refused to set unsafe header" 错误
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://finance.yahoo.com/',
            'Cache-Control': 'max-age=0'
        } : {
            // API请求
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Origin': 'https://finance.yahoo.com',
            'Referer': 'https://finance.yahoo.com/'
        };

        fetch(request.url, { 
            credentials: 'include',
            cache: 'no-store',
            headers: headers
        })
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.text();
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