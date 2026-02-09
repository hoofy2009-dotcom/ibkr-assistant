// IBKR Trading Assistant - Professional Edition

class TradingAssistant {
    constructor() {
        this.panel = null;
        this.minimizedBtn = null;
        this.checkInterval = null;
        
        // State
        this.state = {
            symbol: "",
            price: 0,
            lastPrice: 0,
            sessionHigh: -Infinity,
            sessionLow: Infinity,
            history: [], // For volatility calc
            position: null,
            isDragging: false,
            minimized: false,
            lastDomScan: 0,
            lastDomPrice: 0
        };

        // API keys (stored locally via chrome.storage)
        this.apiKeys = {
            deepseekKey: "",
            geminiKey: "",
            tongyiKey: "",
            doubaoKey: "",
            claudeKey: "",
            chatgptKey: "",
            grokKey: ""
        };
            // Model overrides (user-specified)
            this.modelConfig = {
                doubaoModel: AI_CONFIG.DOUBAO_MODEL,
                geminiModel: "gemini-3-pro-preview"
            };
        // Remote quote cache per symbol { price, session, ts }
        this.remoteQuoteCache = {};

        this.initPromise = this.init();
    }

    keyFilled(k) {
        return !!(k && k.trim() && !k.startsWith("__REPLACE"));
    }

    async init() {
        console.log("IBKR Assistant Pro Initializing...");

        try {
            await this.loadSettings();
        } catch (e) {
            console.error("Init settings failed", e);
            this.showToast("⚠️ 配置加载失败，使用默认参数", "error");
        }

        this.createPanel();
        this.createMinimizedBtn();
        this.startMonitoring();
        
        // Initial Macro Fetch
        this.fetchMacroData();
        setInterval(() => this.fetchMacroData(), 60000); // Update Macro every minute
        
        // Watchlist loop
        this.updateWatchlistData(); // Initial fetch immediately
        setInterval(() => this.updateWatchlistData(), 15000); // Update WL every 15s
    }

    async loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["assist_settings", "assist_watchlist", "assist_keys", "assist_models"], (result) => {
                let migrated = false;

                // 1) Settings
                if (result.assist_settings) {
                    this.settings = result.assist_settings;
                } else {
                    const legacy = localStorage.getItem("assist_settings");
                    this.settings = legacy ? JSON.parse(legacy) : {
                        stopLoss: -5.0,
                        takeProfit: 10.0,
                        volThreshold: 1.2
                    };
                    if (legacy) migrated = true;
                }

                // 2) Watchlist
                if (result.assist_watchlist) {
                    this.watchlist = result.assist_watchlist;
                } else {
                    const legacyWL = localStorage.getItem("assist_watchlist");
                    this.watchlist = legacyWL ? JSON.parse(legacyWL) : ["AAPL", "NVDA", "TSLA"];
                    if (legacyWL) migrated = true;
                }

                // 3) API Keys (local only, default empty)
                    this.apiKeys = result.assist_keys || {
                    deepseekKey: "",
                    geminiKey: "",
                    tongyiKey: "",
                    doubaoKey: "",
                    claudeKey: "",
                    chatgptKey: "",
                    grokKey: ""
                };
                    // 4) Model overrides
                    this.modelConfig = result.assist_models || {
                        doubaoModel: AI_CONFIG.DOUBAO_MODEL,
                        geminiModel: "gemini-3-pro-preview"
                    };

                // Persist migrated data into chrome storage
                if (migrated) {
                    chrome.storage.local.set({
                        assist_settings: this.settings,
                        assist_watchlist: this.watchlist
                    }, () => {
                        this.showToast("✅ 已导入旧配置并全局保存", "success");
                        this.watchlistAlerts = {};
                        resolve();
                    });
                } else {
                    this.watchlistAlerts = {};
                    resolve();
                }
            });
        });
    }

    createMinimizedBtn() {
        this.minimizedBtn = document.createElement("div");
        this.minimizedBtn.className = "minimized-btn";
        this.minimizedBtn.innerHTML = "🤖";
        this.minimizedBtn.style.display = "none";
        this.minimizedBtn.onclick = () => this.toggleMinimize();
        document.body.appendChild(this.minimizedBtn);
    }

    createPanel() {
        this.panel = document.createElement("div");
        this.panel.id = "ibkr-pnl-panel"; // Set ID for positioning references
        this.panel.className = "ibkr-assistant-panel";
        this.panel.innerHTML = `
            <div class="ibkr-assistant-header" id="ibkr-drag-handle">
                <span class="ibkr-assistant-title">🤖 智能投顾 (HedgeFund AI)</span>
                <div>
                   <button class="icon-btn" id="ibkr-watchlist" title="Watchlist">📋</button>
                   <button class="icon-btn" id="ibkr-settings" title="Settings">⚙</button>
                   <button class="icon-btn" id="ibkr-minimize">_</button>
                   <button class="icon-btn" id="ibkr-close">✕</button>
                </div>
            </div>
            
            <div class="macro-ribbon" id="macro-ribbon">
                <span>MACRO: Loading...</span>
                <span>SENTIMENT: Calculating...</span>
            </div>

            <div class="ibkr-assistant-content">
                <div class="data-row">
                    <span class="label">标的代码</span>
                    <span class="value" id="assist-symbol">扫描中...</span>
                </div>
                
                <div class="data-row">
                    <span class="label">当前价格</span>
                    <div style="text-align:right;">
                        <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
                            <span class="value" id="assist-price">--</span>
                            <span id="assist-session" style="font-size:10px; padding:1px 4px; border-radius:3px; border:1px solid #555; color:#bbb;">REG</span>
                        </div>
                        <div style="font-size:10px; color:#aaa;" id="assist-change">--</div>
                    </div>
                </div>
                
                <!-- Sparkline Canvas -->
                <div class="sparkline-container">
                    <canvas id="sparkline-canvas" width="230" height="40"></canvas>
                </div>

                 <div class="data-row">
                    <span class="label">波动率 (σ)</span>
                    <span class="value" id="assist-vol">--</span>
                </div>
                
                <!-- Position Section -->
                <div id="assist-pos-container" style="display:none; margin-top:5px; border-top:1px dashed #333; padding-top:5px;">
                    <div class="data-row">
                        <span class="label">持仓 / 均价</span>
                        <span class="value"><span id="assist-shares">--</span> @ <span id="assist-avg">--</span></span>
                    </div>
                     <div class="data-row">
                        <span class="label">浮动盈亏</span>
                        <span class="value" id="assist-pnl">--</span>
                    </div>
                </div>

                <div class="strategy-box">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <span class="label" style="font-size:11px;">AI 策略分析</span>
                        <button id="btn-ask-ai" style="font-size:10px; background:#007acc; color:white; border:none; padding:2px 6px; cursor:pointer; border-radius:2px;">点击分析</button>
                    </div>
                    
                    <!-- Sentiment Bar -->
                    <div class="sentiment-wrapper" title="AI Market Sentiment Score (0-10)">
                        <div class="sentiment-label">
                            <span>Panic</span>
                            <span id="sentiment-val">5.0</span>
                            <span>Greed</span>
                        </div>
                        <div class="sentiment-track">
                             <div class="sentiment-marker" id="sentiment-marker" style="left: 50%;"></div>
                        </div>
                    </div>

                    <!-- Key Levels -->
                    <div class="key-levels-box" id="key-levels" style="display:none;">
                       <span>Sup: <b id="lvl-sup">--</b></span>
                       <span>Res: <b id="lvl-res">--</b></span>
                    </div>

                    <div id="assist-analysis" class="analysis-box">
                        DeepSeek 将根据实时盘面为您提供私募级策略建议...
                    </div>
                    <div class="analysis-actions">
                        <button id="btn-copy-analysis" class="btn-copy">复制结果</button>
                    </div>
                    
                    <!-- Mini Watchlist (Pinned to bottom) -->
                    <div id="mini-watchlist" class="mini-watchlist" style="color:#666; text-align:center;">
                        Loading Watchlist...
                    </div>
                </div>
            </div>

            <!-- Settings Modal -->
            <div id="settings-modal" class="modal-overlay">
                <div class="modal-panel">
                    <div class="modal-header">
                        <span>Risk Management Settings</span>
                        <button class="modal-close-btn" id="close-settings">✕</button>
                    </div>
                    <div class="setting-item">
                        <span>Stop Loss (%):</span>
                        <input type="number" id="set-stop" value="-5.0" step="0.5">
                    </div>
                    <div class="setting-item">
                        <span>Take Profit (%):</span>
                        <input type="number" id="set-profit" value="10.0" step="1.0">
                    </div>
                    <div class="setting-item">
                        <span>Volatility Alert (>):</span>
                        <input type="number" id="set-vol" value="1.2" step="0.1">
                    </div>
                    <div class="setting-item">
                        <span>DeepSeek Key:</span>
                        <input type="password" id="set-ds-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>Gemini Key:</span>
                        <input type="password" id="set-gem-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>Gemini 模型:</span>
                        <input type="text" id="set-gemini-model" class="model-input" placeholder="默认: gemini-3-pro-preview" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>通义千问 Key:</span>
                        <input type="password" id="set-tongyi-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>豆包 Key:</span>
                        <input type="password" id="set-doubao-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>Claude Key:</span>
                        <input type="password" id="set-claude-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>ChatGPT Key:</span>
                        <input type="password" id="set-chatgpt-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>Grok Key:</span>
                        <input type="password" id="set-grok-key" placeholder="仅本地保存" autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>豆包模型:</span>
                        <input type="text" id="set-doubao-model" class="model-input" placeholder="如 doubao-lite-1-5 或 ep-xxxxx" autocomplete="off">
                    </div>
                    <div class="settings-hint">密钥只会存储在本机 chrome.storage，不会上传。</div>
                    </div>
                    <div class="settings-actions">
                        <button class="btn-save" id="btn-save-settings">Save & Close</button>
                    </div>
                </div>
            </div>

            <!-- Watchlist Modal -->
            <div id="watchlist-modal" class="modal-overlay">
                <div class="modal-panel">
                    <div class="modal-header">
                        <span>Global Watchlist</span>
                        <button class="modal-close-btn" id="close-watchlist">✕</button>
                    </div>
                    <div class="watchlist-input-group">
                        <input type="text" id="wl-new-symbol" placeholder="Symbol (e.g. AAPL)">
                        <button id="btn-add-wl">+</button>
                    </div>
                    <div class="watchlist-items" id="wl-container">
                        <!-- Items go here -->
                        <div style="padding:10px; text-align:center; color:#555;">No symbols. Add one to start.</div>
                    </div>
                    <div style="text-align:right; font-size:9px; color:#555; margin-top:5px;">
                        Auto-refresh every 15s
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.panel);

        // Populate settings with stored values
        document.getElementById("set-stop").value = this.settings.stopLoss;
        document.getElementById("set-profit").value = this.settings.takeProfit;
        document.getElementById("set-vol").value = this.settings.volThreshold;
        document.getElementById("set-ds-key").value = this.apiKeys.deepseekKey || "";
        document.getElementById("set-gem-key").value = this.apiKeys.geminiKey || "";
        document.getElementById("set-gemini-model").value = this.modelConfig.geminiModel || "gemini-3-pro-preview";
        document.getElementById("set-tongyi-key").value = this.apiKeys.tongyiKey || "";
        document.getElementById("set-doubao-key").value = this.apiKeys.doubaoKey || "";
        document.getElementById("set-claude-key").value = this.apiKeys.claudeKey || "";
        document.getElementById("set-chatgpt-key").value = this.apiKeys.chatgptKey || "";
        document.getElementById("set-grok-key").value = this.apiKeys.grokKey || "";
        document.getElementById("set-doubao-model").value = this.modelConfig.doubaoModel || AI_CONFIG.DOUBAO_MODEL;

        // Event Listeners
        document.getElementById("ibkr-close").onclick = () => this.panel.remove();
        document.getElementById("ibkr-minimize").onclick = () => this.toggleMinimize();
        
        // Modals
        document.getElementById("ibkr-settings").onclick = () => this.toggleModal("settings-modal");
        document.getElementById("close-settings").onclick = () => this.toggleModal("settings-modal");
        document.getElementById("btn-save-settings").onclick = () => this.saveSettings();
        
        document.getElementById("ibkr-watchlist").onclick = () => this.toggleWatchlist();
        document.getElementById("close-watchlist").onclick = () => this.toggleModal("watchlist-modal");
        document.getElementById("btn-add-wl").onclick = () => this.addToWatchlist();

        document.getElementById("btn-ask-ai").onclick = () => this.triggerAIAnalysis();
        document.getElementById("btn-copy-analysis").onclick = () => this.copyAnalysis();
        
        // Draggable Logic
        this.initDrag();
    }

    initDrag() {
        const header = this.panel.querySelector(".ibkr-assistant-header");
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener("mousedown", (e) => {
            isDragging = true;
            this.state.isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.panel.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            
            // Remove 'right' and use 'left' for dragging logic
            this.panel.style.right = "auto";
            this.panel.style.left = initialLeft + "px";
            this.panel.style.top = initialTop + "px";

            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            // Calculate new position
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // REMOVED strict clamping to allow free movement across multi-monitor browser windows
            // We only prevent it from being completely lost (e.g. extremely far off)
            
            this.panel.style.left = newLeft + "px";
            this.panel.style.top = newTop + "px";
            
            // Sync AI Popup position
            this.positionAiPopup();
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                this.state.isDragging = false;
                // Optional: Snap to edge or ensure fully visible only ON DROP
                this.ensurePanelInView(); 
            }
        });

        // Ensure visibility on resize
        window.addEventListener("resize", () => {
             this.ensurePanelInView();
             this.positionAiPopup();
        });
    }

    ensurePanelInView() {
        if (!this.panel) return;
        const rect = this.panel.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        
        let newLeft = rect.left;
        let newTop = rect.top;
        let changed = false;

        if (newLeft + rect.width > viewportWidth) {
            newLeft = viewportWidth - rect.width - 20; // 20px padding
            changed = true;
        }
        if (newLeft < 0) {
            newLeft = 20;
            changed = true;
        }
        if (newTop + rect.height > viewportHeight) {
            newTop = viewportHeight - rect.height - 20;
            changed = true;
        }
        if (newTop < 0) {
            newTop = 100; // Reset to default top
            changed = true;
        }

        if (changed) {
            this.panel.style.left = newLeft + "px";
            this.panel.style.top = newTop + "px";
            this.panel.style.right = "auto";
        }
    }

    toggleMinimize() {
        this.state.minimized = !this.state.minimized;
        if (this.state.minimized) {
            this.panel.style.display = "none";
            this.minimizedBtn.style.display = "flex";
        } else {
            this.panel.style.display = "block";
            this.minimizedBtn.style.display = "none";
        }
    }

    startMonitoring() {
        this.checkInterval = setInterval(() => {
            this.updateData();
        }, 800); // Faster polling for pro feel
    }

    updateData() {
        // 1. Get Price & Symbol
        let price = 0;
        let symbol = "";
        const now = Date.now();
        const title = document.title;

        const shouldScanDom = (now - this.state.lastDomScan) > 1200;

        if (shouldScanDom) {
            // Strategy A: Regex match on title (Flexible)
            const titleMatch = title.match(/([A-Z]{1,5})[:\s]+([\d,]+\.\d{2})/);
            if (titleMatch) {
                symbol = titleMatch[1];
                price = parseFloat(titleMatch[2].replace(/,/g, ""));
            }

            // Strategy B: DOM Heuristic (If title failed or we want to confirm)
            if (price === 0) {
                const candidates = [];
                const elements = document.querySelectorAll("div, span, h1, h2, h3, strong, b");
                elements.forEach(el => {
                    if (el.children.length > 1) return;
                    const text = el.innerText ? el.innerText.trim().replace(/,/g, "") : "";
                    if (/^\d+\.\d{2}$/.test(text)) {
                        const val = parseFloat(text);
                        if (val > 0) {
                             const style = window.getComputedStyle(el);
                             const fontSize = parseFloat(style.fontSize);
                             if (style.display !== 'none' && style.visibility !== 'hidden' && fontSize > 16) {
                                 candidates.push({ price: val, size: fontSize, element: el });
                             }
                        }
                    }
                });

                candidates.sort((a, b) => b.size - a.size);
                if (candidates.length > 0) {
                    const best = candidates[0];
                    price = best.price;
                    if (!symbol) {
                         try {
                            const container = best.element.parentElement?.parentElement; 
                            if (container) {
                                const txt = container.innerText;
                                const matches = txt.match(/\b([A-Z]{2,5})\b/g);
                                if (matches) {
                                    const ignore = ["USD", "EUR", "HKD", "CNY", "AVG", "POS", "DAY", "LOW", "HGH", "VOL", "ASK", "BID"];
                                    const found = matches.find(m => !ignore.includes(m));
                                    if (found) symbol = found;
                                }
                            }
                         } catch(e) {}
                    }
                }
            }

            this.state.lastDomScan = now;
            this.state.lastDomPrice = price || this.state.lastDomPrice;
        } else {
            // Reuse last DOM price when within throttle window
            price = this.state.lastDomPrice || 0;
            symbol = this.state.symbol || "";
        }

        // Persist symbol softly
        if (!symbol && this.state.symbol && this.state.symbol !== "DETECTED") {
            symbol = this.state.symbol;
        }
        if (!symbol) symbol = "DETECTED";

        // Kick off remote quote refresh (non-blocking) every 20s per symbol
        const cache = this.remoteQuoteCache[symbol];
        if (symbol !== "DETECTED" && (!cache || (now - cache.ts) > 20000)) {
            this.fetchRemoteQuote(symbol);
        }

        // Fallback / sanity-check with remote quote
        const remote = this.remoteQuoteCache[symbol];
        if ((price === 0 || Number.isNaN(price)) && remote) {
            price = remote.price;
        } else if (remote && remote.price > 0) {
            const drift = Math.abs(price - remote.price) / remote.price;
            if (drift > 0.08 && (now - remote.ts) < 15000) {
                // Prefer fresher remote quote if DOM drifts too much
                price = remote.price;
            }
        }

        if (price === 0) {
            // Debugging log only if we haven't found anything for a while
            if (Date.now() % 5000 < 1000) console.log("IBKR Assistant: Scanning for price... (Title: " + title + ")");
            return; // No data yet
        }

        // 2. Get Position Data
        let position = null;
        let avgPrice = 0, shares = 0;
        
        // Heuristic scan for position
        // This regex is tailored for the specific Chinese screenshots provided earlier
        const bodyText = document.body.innerText; 
        // Optimization: Don't scan full body every ms, scan only if we suspect change? 
        // For real-time tool, scanning full body text is heavy. 
        // Let's look for specific container classes if possible, or stick to the treeWalker which is faster than innerText on body.
        
        // Use a lightweight check specific to "Positions" panel often found near the bottom
        // We'll trust the previous logic's robustness but make it safer
        try {
             const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
             let node;
             let foundPos = false;
             while(node = treeWalker.nextNode()) {
                 if (node.textContent.includes("平均价格") || node.textContent.includes("Avg Price")) {
                     let container = node.parentElement;
                     // Walk up 3 levels max
                     for(let i=0; i<3; i++) { if(container.parentElement) container = container.parentElement; }
                     
                     const txt = container.innerText;
                     const avg = txt.match(/(?:平均价格|Avg Price)[\s\n\r]+([\d,]+\.\d+)/);
                     const qty = txt.match(/(?:股数|Shares|Position)[\s\n\r]+(\d+)/);
                     
                     if (avg && qty) {
                         avgPrice = parseFloat(avg[1].replace(/,/g, ''));
                         shares = parseFloat(qty[1].replace(/,/g, ''));
                         foundPos = true;
                         break;
                     }
                 }
                 if(foundPos) break;
             }
        } catch(e) {}

        if (shares > 0) position = { avgPrice, shares };

        // 3. Update State
        if (symbol && this.state.symbol !== symbol) {
            // New symbol DETECTED, reset session stats completely
            console.log(`Symbol Switched: ${this.state.symbol} -> ${symbol}`);
            this.state.symbol = symbol;
            this.state.sessionHigh = price;
            this.state.sessionLow = price;
            this.state.history = []; // Clear volatility history to avoid mixing stocks
            this.state.lastPrice = 0; // Reset last price to avoid huge "gap" calculation
            
            // Clear Sparkline
            const canvas = document.getElementById("sparkline-canvas");
            if(canvas) {
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
        } else {
            this.state.sessionHigh = Math.max(this.state.sessionHigh, price);
            this.state.sessionLow = Math.min(this.state.sessionLow, price);
        }

        this.updateUI(symbol || this.state.symbol, price, position);
    }

    updateUI(symbol, price, position) {
        document.getElementById("assist-symbol").innerText = symbol;
        const priceEl = document.getElementById("assist-price");
        priceEl.innerText = price.toFixed(2);
        
        // Color update on tick
        if (price > this.state.lastPrice) {
            priceEl.className = "value value-up";
        } else if (price < this.state.lastPrice) {
            priceEl.className = "value value-down";
        }

        // Session badge (PRE / REG / POST)
        const sessionBadge = document.getElementById("assist-session");
        const session = this.deriveSession(symbol);
        if (sessionBadge) {
            sessionBadge.innerText = session;
            if (session === "PRE") {
                sessionBadge.style.borderColor = "#ffa726";
                sessionBadge.style.color = "#ffa726";
            } else if (session === "POST") {
                sessionBadge.style.borderColor = "#4fc3f7";
                sessionBadge.style.color = "#4fc3f7";
            } else if (session === "CLOSED") {
                sessionBadge.style.borderColor = "#777";
                sessionBadge.style.color = "#777";
            } else {
                sessionBadge.style.borderColor = "#555";
                sessionBadge.style.color = "#bbb";
            }
        }

        // Change from session start (simplified to change from prev for now, or fetch open if possible)
        // Let's show Tick Change
        const change = price - this.state.lastPrice;
        if (this.state.lastPrice !== 0 && change !== 0) {
             document.getElementById("assist-change").innerText = (change > 0 ? "+" : "") + change.toFixed(2);
             
             // Add to history for volatility
             this.state.history.push(price);
             if (this.state.history.length > 50) this.state.history.shift(); // Keep 50 pts for sparkline
        }
        
        this.state.lastPrice = price;
        this.drawSparkline();

        // Volatility Calculation (Standard Deviation of last 20 ticks)
        if (this.state.history.length > 5) {
            // Use last 20 for Vol calculation even if history has 50
            const recent = this.state.history.slice(-20);
            const mean = recent.reduce((a,b)=>a+b,0) / recent.length;
            const variance = recent.reduce((a,b)=>a + Math.pow(b-mean, 2), 0) / recent.length;
            const stdDev = Math.sqrt(variance);
            document.getElementById("assist-vol").innerText = stdDev.toFixed(3);
        }

        // Position UI
        const posContainer = document.getElementById("assist-pos-container");
        if (position) {
            posContainer.style.display = "block";
            document.getElementById("assist-shares").innerText = position.shares;
            document.getElementById("assist-avg").innerText = position.avgPrice.toFixed(2);
            
            const mktValue = position.shares * price;
            const costBasis = position.shares * position.avgPrice;
            const pnl = mktValue - costBasis;
            const pnlP = (pnl / costBasis) * 100;
            
            const pnlEl = document.getElementById("assist-pnl");
            pnlEl.innerText = `${pnl > 0 ? "+" : ""}${pnl.toFixed(2)} (${pnlP.toFixed(2)}%)`;
            pnlEl.className = pnl >= 0 ? "value value-up" : "value value-down";
            
            this.calculateProStrategy(price, position, pnlP);
        } else {
            posContainer.style.display = "none";
            this.calculateProStrategy(price, null, 0);
        }
    }

    calculateProStrategy(price, position, pnlPercentage) {
        // Session awareness from remote cache (default REG)
        const session = this.deriveSession(this.state.symbol);

        // Just store data for AI access
        this.currentMarketContext = {
            symbol: this.state.symbol,
            price: price,
            change: price - this.state.lastPrice,
            volatility: this.state.history.length > 5 ? document.getElementById("assist-vol").innerText : "Calculating",
            sessionHigh: this.state.sessionHigh,
            sessionLow: this.state.sessionLow,
            position: position,
            pnlPercentage: pnlPercentage,
            session: session
        };
        
        // Use user settings
        const STOP_LOSS = this.settings.stopLoss;     // e.g. -5.0
        const TAKE_PROFIT = this.settings.takeProfit; // e.g. 10.0
        const VOL_THRESHOLD = this.settings.volThreshold;

        // Suppress auto triggers during PRE/POST to避免盘前盘后噪声
        const isRegular = session === "REG";

        if (position) {
            const profitP = pnlPercentage;
            let autoReason = null;
            const volStr = document.getElementById("assist-vol").innerText || "0";
            const vol = parseFloat(volStr);
            
            const now = Date.now();
            if (isRegular && (!this.lastAutoTrigger || (now - this.lastAutoTrigger > 300000))) { // 5 min cooldown
                 if (profitP <= STOP_LOSS) autoReason = `触及止损线 (${STOP_LOSS}%)`;
                 else if (profitP >= TAKE_PROFIT) autoReason = `触及止盈线 (+${TAKE_PROFIT}%)`;
                 else if (vol > VOL_THRESHOLD && (price < this.state.lastPrice)) autoReason = "波动率飙升预警";
                 
                 if (autoReason) {
                     this.lastAutoTrigger = now;
                     console.log("Auto AI Trigger: " + autoReason);
                     this.notify("⚠️ AI Alert", autoReason); // Desktop Push
                     this.triggerAIAnalysis(autoReason);
                 }
            }
        } else {
            // -- Opportunity Scanning --
            const volStr = document.getElementById("assist-vol").innerText || "0";
            const vol = parseFloat(volStr);
            let autoReason = null;
            const now = Date.now();

            if (isRegular && this.state.history.length > 20 && (!this.lastAutoTrigger || (now - this.lastAutoTrigger > 300000))) {
                 if (price >= this.state.sessionHigh && price > this.state.lastPrice) {
                     autoReason = "强势突破日内新高 (Potential Buy)";
                 }
                 else if (vol > (VOL_THRESHOLD + 0.3)) { // Higher threshold for entry
                     autoReason = "盘面剧烈异动 (Volatility Spike)";
                 }

                 if (autoReason) {
                     this.lastAutoTrigger = now;
                     console.log("Auto AI Trigger (Buy): " + autoReason);
                     this.notify("🚀 Opportunity Alert", autoReason); // Desktop Push
                     this.triggerAIAnalysis(autoReason);
                 }
            }
        }
    }

    async fetchMarketNews(symbol) {
        if (!symbol || symbol === "DETECTED" || symbol === "扫描中...") return [];
        
        try {
            // Fetch Yahoo Finance RSS via Proxy
            const text = await this.proxyFetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbol}&region=US&lang=en-US`);
            
            // Simple XML Parsing for headlines
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(text, "text/xml");
            const items = xmlDoc.querySelectorAll("item");
            
            const headlines = [];
            for (let i = 0; i < Math.min(items.length, 3); i++) {
                headlines.push(items[i].querySelector("title").textContent);
            }
            return headlines;
        } catch (e) {
            console.error("News Fetch Error:", e);
            return ["无法获取即时新闻 (Network Error)"];
        }
    }

    // Remote quote fetch via Yahoo as secondary source (also provides session info)
    async fetchRemoteQuote(symbol) {
        if (!symbol || symbol === "DETECTED") return;
        try {
            const raw = await this.proxyFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1m&range=1d`);
            const data = JSON.parse(raw);
            if (!data.chart || !data.chart.result || !data.chart.result[0]) return;
            const meta = data.chart.result[0].meta || {};

            // Determine best available price and session (respect marketState)
            let price = meta.regularMarketPrice;
            let session = "REG";

            if (meta.marketState) {
                // marketState examples: PRE, REGULAR, POST, CLOSED
                const ms = meta.marketState.toUpperCase();
                if (ms.includes("PRE")) session = "PRE";
                else if (ms.includes("POST")) session = "POST";
                else if (ms.includes("REG")) session = "REG";
                else if (ms.includes("CLOSED")) session = "CLOSED";
            }

            if (meta.postMarketPrice) { price = meta.postMarketPrice; session = "POST"; }
            else if (meta.preMarketPrice) { price = meta.preMarketPrice; session = "PRE"; }

            if (price == null) {
                const quotes = data.chart.result[0].indicators?.quote?.[0]?.close || [];
                const valid = quotes.filter(v => v != null);
                if (valid.length) price = valid[valid.length - 1];
            }

            if (price != null) {
                this.remoteQuoteCache[symbol] = {
                    price: parseFloat(price),
                    session,
                    marketState: meta.marketState || session,
                    ts: Date.now()
                };
            }
        } catch (e) {
            console.warn("Remote quote fetch failed", e);
        }
    }

    // Derive session considering remote marketState and US market hours (fallback)
    deriveSession(symbol) {
        const now = new Date();
        const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const day = estTime.getDay(); // 0=Sun
        const hh = estTime.getHours();
        const mm = estTime.getMinutes();
        const minutes = hh * 60 + mm;

        // Hard gate for weekend
        const isWeekend = (day === 0 || day === 6);

        const info = symbol ? this.remoteQuoteCache[symbol] : null;
        if (info && info.marketState) {
            const ms = info.marketState.toUpperCase();
            if (ms.includes("CLOSED")) return "CLOSED";
            if (ms.includes("PRE")) return "PRE";
            if (ms.includes("POST")) return "POST";
            if (ms.includes("REG")) {
                // If API says REG but本地判定在周末/收盘后，则降级为 CLOSED
                if (isWeekend || minutes < 9 * 60 + 30 || minutes >= 16 * 60) {
                    return "CLOSED";
                }
                return "REG";
            }
        }

        // Time-based fallback using US Eastern
        if (isWeekend) return "CLOSED";
        if (minutes >= 16 * 60 && minutes < 20 * 60) return "POST"; // 16:00-20:00
        if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "REG"; // 9:30-16:00
        if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE"; // 4:00-9:30
        return "CLOSED";
    }

    async triggerAIAnalysis(autoTriggerReason = null) {
        const btn = document.getElementById("btn-ask-ai");
        const analysisEl = document.getElementById("assist-analysis");
        
        if(!this.currentMarketContext || !this.currentMarketContext.price) {
            if (!autoTriggerReason) analysisEl.innerText = "数据收集中，请稍后再试...";
            return;
        }

        const dsKey = this.keyFilled(this.apiKeys?.deepseekKey) ? this.apiKeys.deepseekKey : (this.keyFilled(AI_CONFIG.API_KEY) ? AI_CONFIG.API_KEY : "");
        const gemKey = this.keyFilled(this.apiKeys?.geminiKey) ? this.apiKeys.geminiKey : "";
        const tongyiKey = this.keyFilled(this.apiKeys?.tongyiKey) ? this.apiKeys.tongyiKey : "";
        const doubaoKey = this.keyFilled(this.apiKeys?.doubaoKey) ? this.apiKeys.doubaoKey : "";
        const claudeKey = this.keyFilled(this.apiKeys?.claudeKey) ? this.apiKeys.claudeKey : "";
        const chatgptKey = this.keyFilled(this.apiKeys?.chatgptKey) ? this.apiKeys.chatgptKey : "";
        const grokKey = this.keyFilled(this.apiKeys?.grokKey) ? this.apiKeys.grokKey : "";
        if (!dsKey) {
            analysisEl.innerText = "请先在设置中填写 DeepSeek Key（仅本地存储）";
            return;
        }

        // Debounce auto-triggers (don't spam AI API)
        if (autoTriggerReason) {
             const lastRun = this.lastAutoRun || 0;
             if (Date.now() - lastRun < 60000) return; // Max once per minute for auto
             this.lastAutoRun = Date.now();
        }

        btn.disabled = true;
        btn.innerText = autoTriggerReason ? "自动分析中..." : "多模态会诊中...";
        
        if (autoTriggerReason) {
             analysisEl.innerText = `【自动触发: ${autoTriggerReason}】正在结合新闻面分析...`;
        } else {
             analysisEl.innerText = "正在同步调用 DeepSeek V3 与 Google Gemini Pro ...";
        }

        try {
            const ctx = this.currentMarketContext;
            
            // 1. Fetch News First
            const newsHeadlines = await this.fetchMarketNews(ctx.symbol);
            const newsText = newsHeadlines.length > 0 ? newsHeadlines.join("; ") : "暂无重磅新闻";

            // 2. Build Enhanced Prompt
            const prompt = `
                身份：华尔街资深对冲基金经理 (Macro-driven Technical Trader)。
                任务：结合技术面、宏观背景与新闻，给出操作指令。
                
                【宏观】
                SPY Context: ${this.macroCache ? this.macroCache.change : "Unknown"}
                
                【标的】
                Symbol: ${ctx.symbol}
                Price: ${ctx.price} (Change: ${ctx.change.toFixed(2)})
                Volatility: ${ctx.volatility}
                PnL: ${ctx.position ? ctx.pnlPercentage.toFixed(2) + "%" : "FLAT"}
                Trigger: ${autoTriggerReason || "Manual Check"}
                
                【新闻】
                ${newsText}
                
                请输出 JSON 格式（不要Markdown）：
                {
                    "sentiment": 1-10的整数(1=极度恐慌, 10=极度贪婪),
                    "support": 关键支撑位数字(无则0),
                    "resistance": 关键阻力位数字(无则0),
                    "analysis": "100字以内的犀利操作建议，包含止损提示。"
                }
            `;

            // 3. Parallel AI Execution (multi-provider). 仅调用已配置密钥的模型
            const tasks = [];
            const providers = [];

            // Add clear indication of processing in sidebar
            this.updateAiPopup("正在进行多模型会诊分析...", ctx.symbol, true);

            const addTask = (id, name, color, executor) => {
                providers.push({ id, name, color });
                tasks.push((async () => {
                    try {
                        const data = await executor();
                        return { id, name, color, data };
                    } catch (e) {
                        console.error(name + " Error", e);
                        return { id, name, color, data: { __isError: true, msg: e.message } };
                    }
                })());
            };

            // DeepSeek (always runs; fallback even在自动模式)
            addTask("deepseek", "DeepSeek", "#4fc3f7", async () => {
                const dsRes = await this.fetchWithTimeout(async (signal) => {
                    const response = await fetch(AI_CONFIG.API_URL, {
                        method: "POST",
                        signal,
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${dsKey}`
                        },
                        body: JSON.stringify({
                            model: "deepseek-chat",
                            messages: [
                                {"role": "system", "content": "You are a Hedge Fund Manager. Return ONLY valid JSON."},
                                {"role": "user", "content": prompt}
                            ],
                            temperature: 0.4,
                            max_tokens: 350
                        })
                    });
                    if (!response.ok) throw new Error(`DS HTTP ${response.status}`);
                    const data = await response.json();
                    if (!data.choices || !data.choices.length || !data.choices[0].message || !data.choices[0].message.content) {
                        throw new Error("DS Empty Response");
                    }
                    let raw = data.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                }, 10000, 1);
                return dsRes;
            });

            // Helpers for OpenAI-compatible endpoints
            const buildOAIBody = (model) => ({
                model,
                messages: [
                    { role: "system", content: "You are a Hedge Fund Manager. Return ONLY valid JSON." },
                    { role: "user", content: prompt }
                ],
                temperature: 0.4,
                max_tokens: 350
            });

            const runViaBackground = (url, headers, body, timeoutMs = 12000) => {
                return this.fetchWithTimeout(() => new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage({
                        action: "FETCH_AI",
                        url,
                        method: "POST",
                        headers,
                        body
                    }, (res) => {
                        if (res && res.success) resolve(res.data);
                        else reject(new Error(res ? res.error : "Background Fetch Failed"));
                    });
                }), timeoutMs, 0);
            };

            // Only manual triggers will fan out to other models to节省调用
            if (!autoTriggerReason && gemKey) {
                addTask("gemini", "Gemini", "#ba68c8", async () => {
                    const modelID = (this.modelConfig && this.modelConfig.geminiModel) ? this.modelConfig.geminiModel : "gemini-3-pro-preview";
                    
                    // Construct URL dynamically based on model name
                    // Standard pattern: .../models/{modelID}:generateContent
                    const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models/";
                    const url = `${baseUrl}${modelID}:generateContent?key=${gemKey}`;
                    
                    const response = await runViaBackground(url, null, {
                        contents: [{ parts: [{ text: "You are a Hedge Fund Manager. Return ONLY valid JSON. " + prompt }] }]
                    }, 10000);

                    if (!response || !response.candidates || !response.candidates.length) {
                        if (response && response.promptFeedback && response.promptFeedback.blockReason) {
                            throw new Error("Gemini Blocked: " + response.promptFeedback.blockReason);
                        }
                        throw new Error("Gemini Invalid Response");
                    }
                    let raw = response.candidates[0].content.parts[0].text;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            if (!autoTriggerReason && tongyiKey) {
                addTask("tongyi", "通义千问", "#ffb74d", async () => {
                    const url = AI_CONFIG.TONGYI_URL;
                    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${tongyiKey}` };
                    const resp = await runViaBackground(url, headers, buildOAIBody(AI_CONFIG.TONGYI_MODEL || "qwen-plus"));
                    if (!resp.choices || !resp.choices.length) throw new Error("Tongyi Empty Response");
                    let raw = resp.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            if (!autoTriggerReason && doubaoKey) {
                addTask("doubao", "豆包", "#81d4fa", async () => {
                    const url = AI_CONFIG.DOUBAO_URL;
                    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${doubaoKey}` };
                    const modelName = (this.modelConfig && this.modelConfig.doubaoModel) ? this.modelConfig.doubaoModel : (AI_CONFIG.DOUBAO_MODEL || "doubao-pro-1-5");
                    const resp = await runViaBackground(url, headers, buildOAIBody(modelName));
                    if (!resp.choices || !resp.choices.length) throw new Error("Doubao Empty Response");
                    let raw = resp.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            if (!autoTriggerReason && claudeKey) {
                addTask("claude", "Claude", "#ffd54f", async () => {
                    const url = AI_CONFIG.CLAUDE_URL;
                    const headers = {
                        "Content-Type": "application/json",
                        "x-api-key": claudeKey,
                        "anthropic-version": "2023-06-01"
                    };
                    const body = {
                        model: AI_CONFIG.CLAUDE_MODEL || "claude-3-5-sonnet-20241022",
                        max_tokens: 350,
                        temperature: 0.4,
                        messages: [{ role: "user", content: prompt }]
                    };
                    const resp = await runViaBackground(url, headers, body);
                    if (!resp.content || !resp.content.length || !resp.content[0].text) throw new Error("Claude Empty Response");
                    let raw = resp.content[0].text.replace(/```json/g, "").replace(/```/g, "");
                    return JSON.parse(raw);
                });
            }

            if (!autoTriggerReason && chatgptKey) {
                addTask("chatgpt", "ChatGPT", "#7e57c2", async () => {
                    const url = AI_CONFIG.OPENAI_URL;
                    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${chatgptKey}` };
                    const resp = await runViaBackground(url, headers, buildOAIBody(AI_CONFIG.CHATGPT_MODEL || "gpt-4o-mini"));
                    if (!resp.choices || !resp.choices.length) throw new Error("ChatGPT Empty Response");
                    let raw = resp.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            if (!autoTriggerReason && grokKey) {
                addTask("grok", "Grok", "#26c6da", async () => {
                    const url = AI_CONFIG.GROK_URL;
                    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${grokKey}` };
                    const resp = await runViaBackground(url, headers, buildOAIBody(AI_CONFIG.GROK_MODEL || "grok-2-latest"));
                    if (!resp.choices || !resp.choices.length) throw new Error("Grok Empty Response");
                    let raw = resp.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            // 4. Aggregation
            const results = await Promise.all(tasks);
            
            // Re-enable button
            btn.disabled = false;
            btn.innerText = "重新分析";

            // Parse Results
            const validResults = [];
            const errorResults = [];
            
            results.forEach(r => {
                if (r.data && !r.data.__isError && this.tryParse(r.data)) {
                    validResults.push(r);
                } else {
                    errorResults.push(r);
                }
            });
            
            if (validResults.length === 0) {
                let errHtml = `<div style="color:#ff5252;">All models failed:</div>`;
                errorResults.forEach(r => {
                    const msg = r.data && r.data.msg ? r.data.msg : "Unknown Error";
                     errHtml += `<div style="font-size:11px; margin-top:4px;"><b>${r.name}:</b> ${msg}</div>`;
                });
                this.updateAiPopup(errHtml, `${ctx.symbol} Analysis Failed`, false);
                return;
            }

            // Simple weighted aggregation
            let totalSent = 0;
            let count = 0;
            let commentaryHTML = "";
            let supSum = 0, resSum = 0;
            let supCount = 0, resCount = 0;

            validResults.forEach(r => {
                 const json = this.tryParse(r.data);
                 if (json) {
                    totalSent += (json.sentiment || 5);
                    if (json.support) { supSum += parseFloat(json.support); supCount++; }
                    if (json.resistance) { resSum += parseFloat(json.resistance); resCount++; }
                    count++;
                    
                    commentaryHTML += `
                        <div style="margin-bottom:8px; border-left:2px solid ${r.color}; padding-left:6px;">
                            <strong style="color:${r.color}; font-size:11px;">[${r.name}]</strong> <span style="font-size:12px;">${json.analysis}</span>
                        </div>
                    `;
                 }
            });

             // Append Errors at bottom if any
            if (errorResults.length > 0) {
                commentaryHTML += `<div style="margin-top:12px; border-top:1px solid #333; padding-top:8px;">
                    <div style="font-size:11px; color:#aaa; margin-bottom:4px;">Failed Models:</div>`;
                
                errorResults.forEach(r => {
                    let msg = r.data && r.data.msg ? r.data.msg : "Invalid Response / Parsing Error";
                    try { msg = this.formatGeminiError(msg); } catch(e) {}
                    
                    commentaryHTML += `
                        <div style="font-size:10px; color:#ef5350; margin-bottom:2px;">
                            • <b>${r.name}:</b> ${msg}
                        </div>
                    `;
                });
                commentaryHTML += `</div>`;
            }

            const avgSent = (totalSent / count).toFixed(1);
            const avgSup = supCount > 0 ? (supSum / supCount).toFixed(2) : "N/A";
            const avgRes = resCount > 0 ? (resSum / resCount).toFixed(2) : "N/A";

            // Update UI
            document.getElementById("sentiment-val").innerText = avgSent;
            const trackW = document.querySelector(".sentiment-track").offsetWidth;
            const marker = document.getElementById("sentiment-marker");
            if (trackW && marker) {
                // Map 1..10 to 0..100%
                const pct = ((avgSent - 1) / 9) * 100;
                marker.style.left = pct + "%";
            }
            
            document.getElementById("key-levels").style.display = "flex";
            document.getElementById("lvl-sup").innerText = avgSup;
            document.getElementById("lvl-res").innerText = avgRes;

            analysisEl.innerHTML = `<strong>综合评级 ${avgSent}/10</strong><br/>`; // Inline summary
            
            // Show detailed popup
            this.updateAiPopup(commentaryHTML, `${ctx.symbol} AI Analysis`, false);

        } catch (e) {
            console.error("Analysis Pipeline Error", e);
            btn.disabled = false;
            btn.innerText = "点击分析";
            analysisEl.innerText = "系统错误: " + e.message;
        }
    }
    
    // New Method for Side Popup
    updateAiPopup(contentHtml, title, isLoading) {
        let popup = document.getElementById("ibkr-ai-popup");
        if (!popup) {
            const panel = document.getElementById("ibkr-pnl-panel");
            if (!panel) return;
            
            popup = document.createElement("div");
            popup.id = "ibkr-ai-popup";
            popup.className = "ibkr-ai-popup";
            popup.innerHTML = `
                <div class="ibkr-ai-popup-header">
                    <span class="ibkr-ai-popup-title">AI Analysis</span>
                    <button class="ibkr-ai-popup-close" id="ibkr-ai-popup-close">✕</button>
                </div>
                <div class="ibkr-ai-popup-content" id="ibkr-ai-popup-content"></div>
            `;
            // Append to body to ensure correct positioning relative to viewport or panel parent
            document.body.appendChild(popup);
            
            // Make draggable/movable consistent with panel logic if needed, 
            // for now, statically position via JS relative to main panel
            this.positionAiPopup();

            document.getElementById("ibkr-ai-popup-close").addEventListener("click", () => {
                popup.style.display = "none";
            });
        }
        
        const contentDiv = document.getElementById("ibkr-ai-popup-content");
        document.querySelector(".ibkr-ai-popup-title").innerText = title || "AI Analysis";
        
        if (isLoading) {
             popup.style.display = "block";
             contentDiv.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Thinking...<br/>(Calling DeepSeek & Gemini)</div>`;
        } else {
             popup.style.display = "block";
             contentDiv.innerHTML = contentHtml;
        }
        
        this.positionAiPopup();
    }

    positionAiPopup() {
        const popup = document.getElementById("ibkr-ai-popup");
        const panel = document.getElementById("ibkr-pnl-panel");
        if (popup && panel) {
            const rect = panel.getBoundingClientRect();
            const popupWidth = 300; // css defined width
            const gap = 10;
            
            // Attempt to place on the left side first
            let leftPos = rect.left - popupWidth - gap;
            
            // Intelligent positioning: if left side is clipped off-screen (left < 0),
            // move it to the right side of the main panel instead.
            if (leftPos < 10) {
                leftPos = rect.right + gap;
            }

            popup.style.top = rect.top + "px";
            popup.style.left = leftPos + "px";
        }
    }

    tryParse(textOrObj) {
        if (typeof textOrObj === "object") return textOrObj;
        if (typeof textOrObj !== "string") return null;
        textOrObj = textOrObj.trim();
        if (!textOrObj) return null;
        try {
            return JSON.parse(textOrObj);
        } catch(e) {
            return null;
        }
    }

    async fetchWithTimeout(executor, timeoutMs = 10000, retries = 0) {
        let lastErr = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                return await executor(controller.signal);
            } catch (e) {
                lastErr = e;
                if (attempt === retries) throw e;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastErr || new Error("Unknown fetch error");
    }

    copyAnalysis() {
        const analysisEl = document.getElementById("assist-analysis");
        if (!analysisEl) return;
        const text = analysisEl.innerText?.trim();
        if (!text) {
            this.showToast("⚠️ 暂无可复制内容", "warn");
            return;
        }

        const doCopy = async () => {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            // Fallback: textarea
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand("copy");
            ta.remove();
            return ok;
        };

        doCopy().then(() => this.showToast("✅ 已复制策略结果", "success"))
               .catch(() => this.showToast("⚠️ 复制失败，请手动复制", "error"));
    }

    // Proxy Fetch Helper to bypass CORS using Background Script
    async proxyFetch(url) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                    return reject(new Error("Extension Context Invalid"));
                }

                chrome.runtime.sendMessage({ action: "FETCH_DATA", url: url }, (response) => {
                    // Check for runtime errors (e.g. background script not found)
                    if (chrome.runtime.lastError) {
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    
                    if (response && response.success) {
                        resolve(response.data);
                    } else {
                        const msg = response ? response.error : "Unknown Background Error";
                        reject(new Error(msg));
                    }
                });
            } catch(e) { reject(e instanceof Error ? e : new Error(String(e))); }
        });
    }

    async fetchMacroData() {
        try {
            // Using Background Proxy to fetch Yahoo
            const rawText = await this.proxyFetch("https://query1.finance.yahoo.com/v8/finance/chart/SPY?interval=1d&range=5d");
            const data = JSON.parse(rawText);
            
            if (!data.chart || !data.chart.result || data.chart.result.length === 0) {
                 throw new Error("Invalid or Empty API Response");
            }

            const result = data.chart.result[0];
            const meta = result.meta;
            
            // Robust Price Resolving
            let currentPrice = meta.regularMarketPrice;
            let prevClose = meta.chartPreviousClose || meta.previousClose;

            // Fallback 1: Use last quote if regularMarketPrice is missing
            if (currentPrice === undefined || currentPrice === null) {
                const quotes = result.indicators.quote[0];
                if (quotes && quotes.close) {
                    const valid = quotes.close.filter(c => c != null);
                    if (valid.length > 0) currentPrice = valid[valid.length - 1];
                }
            }
            
            // Fallback 2: Fail gracefully
            if (currentPrice == null || prevClose == null || prevClose === 0) {
                this.macroCache = { price: 0, change: "0.00% (NoData)" };
            } else {
                const changeP = ((currentPrice - prevClose) / prevClose) * 100;
                const sign = changeP >= 0 ? "+" : "";
                this.macroCache = { 
                    price: currentPrice, 
                    change: isNaN(changeP) ? "Error" : (sign + changeP.toFixed(2) + "%") 
                };
            }
            
            const ribbon = document.getElementById("macro-ribbon");
            if (ribbon) {
                // Determine sentiment based on calculated change
                const numericChange = parseFloat(this.macroCache.change.replace('%', ''));
                const isBullish = !isNaN(numericChange) && numericChange > 0.5;
                const isBearish = !isNaN(numericChange) && numericChange < -0.5;
                
                ribbon.innerHTML = `
                    <span style="color:${isBearish ? '#ff5252' : '#4caf50'}">SPY (S&P500): ${this.macroCache.change}</span>
                    <span>SENTIMENT: ${isBullish ? 'BULLISH' : (isBearish ? 'BEARISH' : 'NEUTRAL')}</span>
                `;
            }
        } catch(e) {
            console.log("Macro Fetch Err", e);
            const ribbon = document.getElementById("macro-ribbon");
            if(ribbon) ribbon.innerHTML = `<span style='color:orange'>Macro: Data Err (${e.message})</span>`;
        }
    }

    drawSparkline() {
        const history = this.state.history;
        if (history.length < 2) return;
        
        const canvas = document.getElementById("sparkline-canvas");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const w = canvas.width;
        const h = canvas.height;
        
        ctx.clearRect(0, 0, w, h);
        
        const min = Math.min(...history);
        const max = Math.max(...history);
        const range = max - min || 1;
        
        ctx.beginPath();
        ctx.strokeStyle = history[history.length-1] >= history[0] ? "#4caf50" : "#ff5252";
        ctx.lineWidth = 2;
        
        for(let i=0; i<history.length; i++) {
            const x = (i / (history.length - 1)) * w;
            const y = h - ((history[i] - min) / range) * (h - 4) - 2; // Padding 2px
            if (i===0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    notify(title, body) {
        if (window.Notification && Notification.permission === "granted") {
            new Notification(title, { body: body });
        } else if (window.Notification && Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    new Notification(title, { body: body });
                }
            });
        }
    }

    showToast(msg, type = "info") {
        const colors = {
            info: "#90caf9",
            success: "#66bb6a",
            error: "#ef5350",
            warn: "#ffa726"
        };

        let container = document.getElementById("ibkr-toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "ibkr-toast-container";
            container.style.position = "fixed";
            container.style.bottom = "20px";
            container.style.right = "20px";
            container.style.display = "flex";
            container.style.flexDirection = "column";
            container.style.gap = "6px";
            container.style.zIndex = 99999;
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.innerText = msg;
        toast.style.background = "#1e1e1e";
        toast.style.border = `1px solid ${colors[type] || colors.info}`;
        toast.style.color = colors[type] || colors.info;
        toast.style.padding = "8px 10px";
        toast.style.borderRadius = "4px";
        toast.style.fontSize = "12px";
        toast.style.boxShadow = "0 4px 10px rgba(0,0,0,0.35)";

        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s";
            setTimeout(() => toast.remove(), 300);
        }, 2200);
    }

    formatGeminiError(msg) {
        if (!msg) return "无响应";
        const lower = msg.toLowerCase();
        if (lower.includes("403")) return "403 禁止：检查 API Key 或切换 VPN 节点";
        if (lower.includes("404")) return "404 模型不存在：请确认模型或等待开通";
        if (lower.includes("429")) return "429 频率/配额受限：稍后再试或更换 Key";
        if (lower.includes("blocked")) return "提示被安全策略拦截：放宽措辞或缩短提示";
        if (lower.includes("timeout") || lower.includes("abort")) return "请求超时：网络/VPN 不稳定";
        return msg;
    }

    toggleModal(id) {
        const modal = document.getElementById(id);
        if(!modal) return;
        modal.style.display = modal.style.display === "flex" ? "none" : "flex";
        
        if (id === "settings-modal" && modal.style.display === "flex") {
             // Populate settings
            document.getElementById("set-stop").value = this.settings.stopLoss;
            document.getElementById("set-profit").value = this.settings.takeProfit;
            document.getElementById("set-vol").value = this.settings.volThreshold;
        }
        else if (id === "watchlist-modal" && modal.style.display === "flex") {
             this.renderWatchlistUI();
             this.updateWatchlistData(); // Trigger fetch immediately
        }
    }

    toggleWatchlist() {
        this.toggleModal("watchlist-modal");
    }

    // --- Watchlist Logic ---

    addToWatchlist() {
        const input = document.getElementById("wl-new-symbol");
        const symbol = input.value.trim().toUpperCase();
        if (symbol && !this.watchlist.includes(symbol)) {
            this.watchlist.push(symbol);
            // Save to chrome.storage.local
            chrome.storage.local.set({ assist_watchlist: this.watchlist });
            input.value = "";
            this.renderWatchlistUI();
            this.updateWatchlistData();
        }
    }

    removeWatchlist(symbol) {
        this.watchlist = this.watchlist.filter(s => s !== symbol);
        // Save to chrome.storage.local
        chrome.storage.local.set({ assist_watchlist: this.watchlist });
        this.renderWatchlistUI();
    }

    renderWatchlistUI() {
        const container = document.getElementById("wl-container");
        if (!container) return;
        
        if (this.watchlist.length === 0) {
            container.innerHTML = `<div style="padding:10px;text-align:center;color:#555;">No symbols</div>`;
            return;
        }

        container.innerHTML = "";
        this.watchlist.forEach(sym => {
            const div = document.createElement("div");
            div.className = "wl-item";
            div.innerHTML = `
                <span class="wl-symbol">${sym}</span>
                <span class="wl-price" id="wl-p-${sym}">--</span>
                <span class="wl-change" id="wl-c-${sym}">--</span>
                <span class="wl-del" data-sym="${sym}">✕</span>
            `;
            container.appendChild(div);
        });
        
        // Add delete events
        container.querySelectorAll(".wl-del").forEach(btn => {
            btn.onclick = (e) => this.removeWatchlist(e.target.dataset.sym);
        });
    }

    async updateWatchlistData() {
        const miniContainer = document.getElementById("mini-watchlist");
        if (!miniContainer) return;
        
        if (!this.watchlist || this.watchlist.length === 0) {
            miniContainer.innerHTML = "<div style='text-align:center;color:#444;'>- Watchlist Empty -</div>";
            return;
        }
        
        try {
            // Strategy Switch: 
            // The batch "v7/finance/quote" endpoint often throws 401 without a crumb.
            // The "v8/finance/chart" endpoint is more open. We will use Promise.all to fetch charts in parallel.
            
            const promises = this.watchlist.map(sym => 
                this.proxyFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`)
                    .then(raw => {
                        const data = JSON.parse(raw);
                        if (!data.chart || !data.chart.result) return null;
                        const meta = data.chart.result[0].meta;
                        return { 
                            symbol: sym, 
                            regularMarketPrice: meta.regularMarketPrice, 
                            previousClose: meta.chartPreviousClose || meta.previousClose 
                        };
                    })
                    .catch(e => {
                        console.error(`Failed to fetch ${sym}`, e);
                        return null; // Skip failed symbols
                    })
            );

            const results = await Promise.all(promises);
            const validResults = results.filter(r => r !== null);
            
            if (validResults.length === 0) throw new Error("All symbols failed (API Blocked?)");

            let miniHTML = "";

            validResults.forEach(quote => {
                const sym = quote.symbol;
                const price = quote.regularMarketPrice;
                const prev = quote.previousClose;
                
                // Calculate Change Manually
                let changeP = 0;
                if (price && prev) {
                    changeP = ((price - prev) / prev) * 100;
                }
                
                const sign = changeP >= 0 ? "+" : "";
                const colorClass = changeP >= 0 ? "value-up" : "value-down";
                const changeStr = sign + changeP.toFixed(2) + "%";
                
                // --- Strategy Signal Logic for Watchlist ---
                // Based on simple daily change thresholds
                let action = "观望";
                let actionColor = "#555";
                
                if (changeP >= 3.0) { 
                    action = "🚀追涨"; 
                    actionColor = "#4caf50"; // Green
                } else if (changeP >= 1.0) {
                    action = "持有";
                    actionColor = "#81c784"; // Light Green
                } else if (changeP <= -5.0) {
                    action = "⚠️避险";
                    actionColor = "#ef5350"; // Red
                } else if (changeP <= -2.5) {
                    action = "🛒抄底";
                    actionColor = "#ff9800"; // Orange
                }

                // 1. Update Modal UI
                const pEl = document.getElementById(`wl-p-${sym}`);
                const cEl = document.getElementById(`wl-c-${sym}`);
                if (pEl && cEl) {
                    pEl.innerText = price.toFixed(2);
                    cEl.innerText = changeStr;
                    cEl.className = "wl-change " + colorClass;
                    pEl.style.color = "#eee";
                }

                // 2. Build Mini List HTML
                miniHTML += `
                    <div class="mini-wl-row">
                        <span class="mini-wl-symbol" title="${sym}">${sym}</span>
                        <span class="mini-wl-price">${price.toFixed(2)}</span>
                        <span class="mini-wl-action" style="color:${actionColor}; border:1px solid ${actionColor}; border-radius:3px;">${action}</span>
                        <span class="mini-wl-change ${colorClass}">${changeStr}</span>
                    </div>
                `;
                
                // Alert Logic
                if (Math.abs(changeP) >= 3.0) {
                     const now = Date.now();
                     const lastAlert = this.watchlistAlerts[sym] || 0;
                     if (now - lastAlert > 600000) {
                         const type = changeP > 0 ? "🚀 Surge Alert" : "🔻 Drop Alert";
                         this.notify(type, `${sym} is moving fast! Current: ${changeStr}`);
                         this.watchlistAlerts[sym] = now;
                     }
                }
            });
            
            miniContainer.innerHTML = miniHTML || "<div style='text-align:center;color:#444;'>No Data</div>";

        } catch(e) {
            console.log("WL Update Err", e); // Log full error object
            const errMsg = e.message || String(e); // Handle both Error objects and strings
            if(miniContainer) miniContainer.innerHTML = `<div style='color:#ff5252;font-size:9px;padding:5px;'>⚠️ Error: ${errMsg}</div>`;
        }
    }

    saveSettings() {
        this.settings.stopLoss = parseFloat(document.getElementById("set-stop").value);
        this.settings.takeProfit = parseFloat(document.getElementById("set-profit").value);
        this.settings.volThreshold = parseFloat(document.getElementById("set-vol").value);
        this.apiKeys = {
            deepseekKey: document.getElementById("set-ds-key").value.trim(),
            geminiKey: document.getElementById("set-gem-key").value.trim(),
            tongyiKey: document.getElementById("set-tongyi-key").value.trim(),
            doubaoKey: document.getElementById("set-doubao-key").value.trim(),
            claudeKey: document.getElementById("set-claude-key").value.trim(),
            chatgptKey: document.getElementById("set-chatgpt-key").value.trim(),
            grokKey: document.getElementById("set-grok-key").value.trim()
        };
        // Save Models
        const dbModel = document.getElementById("set-doubao-model").value;
        const gemModel = document.getElementById("set-gemini-model").value;
        this.modelConfig.doubaoModel = dbModel;
        this.modelConfig.geminiModel = gemModel;

        chrome.storage.local.set({
            assist_settings: this.settings,
            assist_keys: this.apiKeys,
            assist_models: this.modelConfig
        }, () => {
            this.toggleModal("settings-modal");
            this.showToast("✅ 设置与密钥已本地保存", "success");
        });
    }
}

// Start
const startAssistant = async () => {
    if (!document.querySelector('.ibkr-assistant-panel')) {
        const app = new TradingAssistant();
        try {
            await app.initPromise;
        } catch (e) {
            console.error("Assistant init failed", e);
        }
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startAssistant);
} else {
    startAssistant();
}

// Keep-alive
setInterval(() => {
    if (!document.querySelector('.ibkr-assistant-panel') && !document.querySelector('.minimized-btn')) {
        startAssistant();
    }
}, 5000);
