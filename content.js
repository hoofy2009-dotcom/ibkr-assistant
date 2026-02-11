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

    // Try professional macro sources (CBOE / TradingView) via proxyFetch.
    // This is intentionally flexible: attempt several candidate endpoints and
    // return the first successful parsed { symbol, price } object or null.
    async fetchExternalMacro(symbol) {
        // 优先使用 Yahoo Finance（最可靠且无权限限制）
        // CBOE 和 TradingView 需要额外认证，容易 403
        const candidates = [
            // Yahoo Finance - 最可靠
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`
            // 注释掉不可用的源以减少错误日志：
            // CBOE: 需要认证，会返回 403
            // TradingView: 需要 API key
        ];

        for (let url of candidates) {
            try {
                const raw = await this.proxyFetch(url);
                if (!raw) continue;
                // Try to parse JSON; different providers use different shapes
                try {
                    const j = JSON.parse(raw);
                    // Yahoo chart response
                    if (j && j.chart && j.chart.result && j.chart.result[0]) {
                        const meta = j.chart.result[0].meta;
                        if (meta && meta.regularMarketPrice != null) {
                            return { symbol, price: parseFloat(meta.regularMarketPrice) };
                        }
                    }
                } catch(e) {
                    // Not JSON; skip
                }
            } catch(e) {
                // 只记录非 403 错误（403 是预期的权限问题）
                if (!e.message || !e.message.includes('403')) {
                    console.warn('fetchExternalMacro failed for', symbol, e.message || e);
                }
            }
        }
        return null;
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
                
                // 5) Init Executor
                this.executor = new TradeExecutor(this);

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

                <!-- 技术指标 -->
                <div class="tech-indicators" style="margin-top:8px; padding-top:8px; border-top:1px dashed #333;">
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="相对强弱指标 (Relative Strength Index)&#10;范围: 0-100&#10;• RSI < 30: 超卖区，可能反弹&#10;• RSI > 70: 超买区，可能回调&#10;• RSI 30-70: 中性区域">RSI(14) ℹ️</span>
                        <span class="value">
                            <span id="assist-rsi">--</span>
                            <span id="assist-rsi-signal" style="margin-left:5px; font-size:9px;"></span>
                        </span>
                    </div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="指数平滑异同移动平均线&#10;(Moving Average Convergence Divergence)&#10;• MACD > 0: 多头趋势&#10;• MACD < 0: 空头趋势&#10;• 金叉: MACD从负转正，看涨信号&#10;• 死叉: MACD从正转负，看跌信号">MACD ℹ️</span>
                        <span class="value">
                            <span id="assist-macd">--</span>
                            <span id="assist-macd-signal" style="margin-left:5px; font-size:9px;"></span>
                        </span>
                    </div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="平均真实波幅 (Average True Range)&#10;衡量价格波动性&#10;• 数值越大 = 波动越剧烈&#10;• 用于计算动态止损位">ATR(14) ℹ️</span>
                        <span class="value" id="assist-atr">--</span>
                    </div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="动态止损位 = 当前价 - (ATR × 2)&#10;根据波动性自动调整&#10;避免被正常波动扫损">动态止损 ℹ️</span>
                        <span class="value" id="assist-stop" style="color:#f44336;">--</span>
                    </div>
                </div>

                <!-- 做T专用指标 -->
                <div class="dayt-indicators" style="margin-top:8px; padding-top:8px; border-top:1px dashed #333;">
                    <div style="font-size:10px; color:#64b5f6; margin-bottom:5px; font-weight:bold;">📊 日内做T参考</div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="日内区间 = (当日最高价 - 当日最低价) / 最低价&#10;反映当天的波动幅度&#10;• 区间 > 3%: 波动大，适合做T&#10;• 区间 < 1.5%: 窄幅震荡，谨慎操作">日内区间 ℹ️</span>
                        <span class="value" style="font-size:10px;">
                            <span id="assist-intraday-range">--</span>
                        </span>
                    </div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="区间位置 = (当前价 - 最低价) / (最高价 - 最低价)&#10;显示当前价在日内区间的百分比位置&#10;• 0-25%: 区间底部，低吸机会&#10;• 75-100%: 区间顶部，高抛时机&#10;• 40-60%: 中间位置，观望为主">区间位置 ℹ️</span>
                        <span class="value">
                            <span id="assist-range-position">--</span>
                            <span id="assist-range-signal" style="margin-left:5px; font-size:9px;"></span>
                        </span>
                    </div>
                    <div class="data-row">
                        <span class="label" style="cursor:help;" title="做T信号综合判断:&#10;📉高抛: 位置>75% + RSI>60 (价格高位+超买)&#10;📥低吸: 位置<25% + RSI<40 (价格低位+超卖)&#10;🔒窄幅: 区间<1.5% (波动太小不适合做T)&#10;⚖️观望: 其他情况(等待更好时机)">做T信号 ℹ️</span>
                        <span class="value" id="assist-dayt-signal" style="font-weight:bold;">--</span>
                    </div>
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
                    
                    <div style="border-top: 1px solid #444; margin: 10px 0;"></div>
                    <div style="color: #64b5f6; font-size: 11px; margin-bottom: 5px;">OpenRouter (推荐: Claude/GPT聚合)</div>
                    <div class="setting-item">
                        <span>OpenRouter Key:</span>
                        <input type="password" id="set-or-key" placeholder="sk-or-..." autocomplete="off">
                    </div>
                    <div class="setting-item">
                        <span>OpenRouter Model:</span>
                        <select id="set-or-model" class="model-input" style="background:#333; color:#fff; border:1px solid #444; padding:4px;">
                            <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet (最强逻辑)</option>
                            <option value="openai/gpt-4o">GPT-4o (综合能力)</option>
                            <option value="google/gemini-pro-1.5">Gemini 1.5 Pro (百万上下文)</option>
                            <option value="meta-llama/llama-3.1-70b-instruct">Llama 3.1 70B (高性价比)</option>
                            <option value="deepseek/deepseek-chat">DeepSeek V3 (原生)</option>
                            <option value="perplexity/llama-3.1-sonar-huge-128k-online">Perplexity Online (实时联网)</option>
                        </select>
                    </div>
                    <div style="border-top: 1px solid #444; margin: 10px 0;"></div>

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
                    <div style="margin:15px 0; border-top:1px dashed #444; padding-top:10px;">
                        <div class="setting-item">
                            <span style="color:#ff5252; font-weight:bold;">⚠️ 自动交易 (实验性):</span>
                            <input type="checkbox" id="set-autotrade" style="width:20px;">
                        </div>
                        <div style="font-size:9px; color:#aaa; line-height:1.2;">
                            开启后，AI 给出明确买卖建议(Buy/Sell)且置信度高时，将尝试模拟点击下单页面。<br/>
                            <b>风险自负！建议仅用于模拟盘测试。</b>
                        </div>
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
        document.getElementById("set-or-key").value = this.apiKeys.openrouterKey || "";
        document.getElementById("set-or-model").value = this.modelConfig.openrouterModel || "anthropic/claude-3.5-sonnet";
        document.getElementById("set-tongyi-key").value = this.apiKeys.tongyiKey || "";
        document.getElementById("set-doubao-key").value = this.apiKeys.doubaoKey || "";
        document.getElementById("set-claude-key").value = this.apiKeys.claudeKey || "";
        document.getElementById("set-chatgpt-key").value = this.apiKeys.chatgptKey || "";
        document.getElementById("set-grok-key").value = this.apiKeys.grokKey || "";
        document.getElementById("set-doubao-model").value = this.modelConfig.doubaoModel || AI_CONFIG.DOUBAO_MODEL;
        document.getElementById("set-autotrade").checked = !!this.settings.autoTradeEnabled;

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
        // Detect URL change to force symbol reset
        const currentUrl = window.location.href;
        if (this.lastUrl && this.lastUrl !== currentUrl) {
            console.log("🔄 URL Changed, resetting symbol:", this.lastUrl, "→", currentUrl);
            this.state.symbol = "";
            this.state.history = [];
            this.state.lastPrice = 0;
        }
        this.lastUrl = currentUrl;

        // 1. Get Price & Symbol
        let price = 0;
        let symbol = "";
        const now = Date.now();
        const title = document.title;

        const shouldScanDom = (now - this.state.lastDomScan) > 1200;

        if (shouldScanDom) {
            // Strategy A: Extract from URL first (most reliable)
            // IBKR URL pattern: /quote/76792991?source=wl or similar
            // We'll look for symbol in page header elements
            const urlMatch = window.location.pathname.match(/\/quote\/(\d+)/);
            
            // Strategy B: Look for prominent symbol in page (h1, h2, or large text)
            if (!symbol) {
                const headerElements = document.querySelectorAll("h1, h2, h3, .symbol, [class*='symbol'], [class*='ticker']");
                for (let el of headerElements) {
                    const text = el.innerText?.trim() || "";
                    // Match 1-5 letter stock symbols
                    const match = text.match(/\b([A-Z]{1,5})\b/);
                    if (match && !["USD", "EUR", "HKD", "CNY", "AVG", "POS", "DAY", "LOW", "HIGH", "VOL", "ASK", "BID", "INC", "CORP", "LTD"].includes(match[1])) {
                        symbol = match[1];
                        console.log("✅ Symbol detected from header:", symbol);
                        break;
                    }
                }
            }

            // Strategy C: Regex match on title (Flexible)
            if (!symbol) {
                const titleMatch = title.match(/([A-Z]{1,5})[:\s]+([\d,]+\.\d{2})/);
                if (titleMatch) {
                    symbol = titleMatch[1];
                    price = parseFloat(titleMatch[2].replace(/,/g, ""));
                }
            }

            // Strategy D: DOM Heuristic for price (If title failed or we want to confirm)
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
                                const matches = txt.match(/\b([A-Z]{1,5})\b/g);
                                if (matches) {
                                    const ignore = ["USD", "EUR", "HKD", "CNY", "AVG", "POS", "DAY", "LOW", "HIGH", "HGH", "VOL", "ASK", "BID", "INC", "CORP", "LTD", "LLC"];
                                    const found = matches.find(m => !ignore.includes(m));
                                    if (found) {
                                        symbol = found;
                                        console.log("✅ Symbol detected near price:", symbol);
                                    }
                                }
                            }
                         } catch(e) {}
                    }
                }
            }

            // Strategy E: Fallback - scan page for any prominent stock symbol pattern
            if (!symbol) {
                try {
                    const bodyText = document.body.innerText;
                    // Look for pattern like "ENTG" followed by company name
                    const symbolMatch = bodyText.match(/\b([A-Z]{2,5})\s+[A-Z][a-z]+\s+(?:Inc|Corp|Ltd|LLC|Company)/);
                    if (symbolMatch) {
                        symbol = symbolMatch[1];
                        console.log("✅ Symbol detected from company pattern:", symbol);
                    }
                } catch(e) {}
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
        
        // Debug log (only log occasionally to avoid spam)
        if (Math.random() < 0.05) { // 5% chance to log
            const now = new Date();
            const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
            const cache = this.remoteQuoteCache[symbol];
            console.log(`📊 Session Debug: ${symbol} = ${session} | EST: ${estTime.toLocaleTimeString()} | API state: ${cache?.marketState || 'N/A'} (${cache ? Math.floor((now.getTime() - cache.ts)/1000) : '?'}s old)`);
        }
        
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

        // 技术指标计算
        if (this.state.history.length >= 14) {
            const rsi = this.calculateRSI(this.state.history, 14);
            const rsiEl = document.getElementById("assist-rsi");
            if (rsiEl) rsiEl.innerText = rsi.toFixed(2);
            
            const rsiSignal = document.getElementById("assist-rsi-signal");
            if (rsiSignal) {
                if (rsi < 30) {
                    rsiSignal.innerText = "超卖";
                    rsiSignal.style.color = "#4caf50";
                } else if (rsi > 70) {
                    rsiSignal.innerText = "超买";
                    rsiSignal.style.color = "#f44336";
                } else {
                    rsiSignal.innerText = "中性";
                    rsiSignal.style.color = "#999";
                }
            }
        } else {
            // 显示数据积累进度
            const rsiEl = document.getElementById("assist-rsi");
            if (rsiEl) rsiEl.innerText = `积累中 ${this.state.history.length}/14`;
        }

        if (this.state.history.length >= 26) {
            const macd = this.calculateMACD(this.state.history);
            const macdEl = document.getElementById("assist-macd");
            if (macdEl) macdEl.innerText = macd.histogram.toFixed(3);
            
            const macdSignal = document.getElementById("assist-macd-signal");
            if (macdSignal) {
                if (macd.histogram > 0 && macd.prev < 0) {
                    macdSignal.innerText = "金叉";
                    macdSignal.style.color = "#4caf50";
                } else if (macd.histogram < 0 && macd.prev > 0) {
                    macdSignal.innerText = "死叉";
                    macdSignal.style.color = "#f44336";
                } else {
                    macdSignal.innerText = macd.histogram > 0 ? "多头" : "空头";
                    macdSignal.style.color = "#999";
                }
            }

            // ATR 和动态止损
            const atr = this.calculateATR(this.state.history, 14);
            const atrEl = document.getElementById("assist-atr");
            if (atrEl) atrEl.innerText = atr.toFixed(2);
            
            const stopEl = document.getElementById("assist-stop");
            if (stopEl) {
                const stopLoss = price - (atr * 2);
                stopEl.innerText = stopLoss.toFixed(2);
            }
        } else {
            // 显示数据积累进度
            const macdEl = document.getElementById("assist-macd");
            if (macdEl) macdEl.innerText = `积累中 ${this.state.history.length}/26`;
            const atrEl = document.getElementById("assist-atr");
            if (atrEl) atrEl.innerText = `积累中 ${this.state.history.length}/26`;
        }

        // === 做T专用指标计算 ===
        if (this.state.sessionHigh > -Infinity && this.state.sessionLow < Infinity && this.state.sessionLow < this.state.sessionHigh) {
            // 1. 日内区间
            const range = this.state.sessionHigh - this.state.sessionLow;
            const rangePercent = (range / this.state.sessionLow) * 100;
            const rangeEl = document.getElementById("assist-intraday-range");
            if (rangeEl) {
                rangeEl.innerText = `${this.state.sessionLow.toFixed(2)}-${this.state.sessionHigh.toFixed(2)} (${rangePercent.toFixed(2)}%)`;
            }

            // 2. 当前价格在区间中的位置 (0-100%)
            const positionInRange = ((price - this.state.sessionLow) / range) * 100;
            const posEl = document.getElementById("assist-range-position");
            if (posEl) posEl.innerText = positionInRange.toFixed(0) + "%";
            
            const rangeSignalEl = document.getElementById("assist-range-signal");
            if (rangeSignalEl) {
                if (positionInRange >= 80) {
                    rangeSignalEl.innerText = "高位";
                    rangeSignalEl.style.color = "#f44336";
                } else if (positionInRange >= 60) {
                    rangeSignalEl.innerText = "偏高";
                    rangeSignalEl.style.color = "#ff9800";
                } else if (positionInRange <= 20) {
                    rangeSignalEl.innerText = "低位";
                    rangeSignalEl.style.color = "#4caf50";
                } else if (positionInRange <= 40) {
                    rangeSignalEl.innerText = "偏低";
                    rangeSignalEl.style.color = "#66bb6a";
                } else {
                    rangeSignalEl.innerText = "中位";
                    rangeSignalEl.style.color = "#9e9e9e";
                }
            }

            // 3. 综合做T信号（结合位置 + RSI + 波动率）
            const rsi = this.state.history.length >= 14 ? this.calculateRSI(this.state.history, 14) : 50;
            const volEl = document.getElementById("assist-vol");
            const vol = volEl ? parseFloat(volEl.innerText) || 0 : 0;
            
            let daytSignal = "⚖️观望";
            let daytColor = "#9e9e9e";
            
            // 判断是否有做T空间（区间至少 1.5%）
            const hasSpace = rangePercent >= 1.5;
            
            if (!hasSpace) {
                daytSignal = "🔒窄幅震荡";
                daytColor = "#555";
            } else if (positionInRange >= 75 && rsi > 60) {
                // 高位 + RSI偏高 = 卖出做T
                daytSignal = "📉高抛";
                daytColor = "#f44336";
            } else if (positionInRange >= 65 && rsi > 65) {
                // 偏高 + RSI超买 = 减仓
                daytSignal = "📤减仓";
                daytColor = "#ff5722";
            } else if (positionInRange <= 25 && rsi < 40) {
                // 低位 + RSI偏低 = 买入做T
                daytSignal = "📥低吸";
                daytColor = "#4caf50";
            } else if (positionInRange <= 35 && rsi < 45) {
                // 偏低 + RSI适中 = 加仓
                daytSignal = "✅加仓";
                daytColor = "#66bb6a";
            } else if (vol > 0.5 && positionInRange < 50) {
                // 波动率大 + 低位 = 收筹
                daytSignal = "📥收筹";
                daytColor = "#4caf50";
            } else if (vol > 0.5 && positionInRange > 50) {
                // 波动率大 + 高位 = 出货
                daytSignal = "📤出货";
                daytColor = "#f44336";
            }
            
            const daytSignalEl = document.getElementById("assist-dayt-signal");
            if (daytSignalEl) {
                daytSignalEl.innerText = daytSignal;
                daytSignalEl.style.color = daytColor;
            }
        } else {
            // 数据还在积累中
            const rangeEl = document.getElementById("assist-intraday-range");
            if (rangeEl) rangeEl.innerText = "监控中...";
            const posEl = document.getElementById("assist-range-position");
            if (posEl) posEl.innerText = "监控中...";
            const signalEl = document.getElementById("assist-dayt-signal");
            if (signalEl) {
                signalEl.innerText = "⏳监控中";
                signalEl.style.color = "#999";
            }
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
            // -- 做T机会扫描（仅盘中）--
            // 不再自动触发AI分析，用户需要手动点击
            // 只在极端波动时发送提醒通知
            const volStr = document.getElementById("assist-vol").innerText || "0";
            const vol = parseFloat(volStr);
            const now = Date.now();

            if (isRegular && this.state.history.length > 20 && (!this.lastAutoTrigger || (now - this.lastAutoTrigger > 600000))) {
                 // 极端波动提醒（不触发AI分析）
                 if (vol > (VOL_THRESHOLD + 0.5)) {
                     this.lastAutoTrigger = now;
                     console.log("🔔 Volatility Alert: " + vol.toFixed(3));
                     this.notify("� 波动提醒", `${ctx.symbol} 波动率飙升至 ${vol.toFixed(3)}，关注做T机会`);
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
        
        // 更准确的 EST/EDT 时区转换
        const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
        const day = estTime.getDay(); // 0=Sun, 6=Sat
        const hh = estTime.getHours();
        const mm = estTime.getMinutes();
        const totalMinutes = hh * 60 + mm;

        // 硬判定：周末
        const isWeekend = (day === 0 || day === 6);
        
        // 优先使用 Yahoo API 返回的实时市场状态（如果有且新鲜）
        const info = symbol ? this.remoteQuoteCache[symbol] : null;
        if (info && info.marketState && (now.getTime() - info.ts) < 30000) { // 30秒内的数据才信任
            const ms = info.marketState.toUpperCase();
            
            // 完全信任 API 返回的状态
            if (ms === "CLOSED") return "CLOSED";
            if (ms === "PRE" || ms.includes("PREPRE") || ms.includes("PREMARKET")) return "PRE";
            if (ms === "POST" || ms.includes("POSTPOST") || ms.includes("AFTERHOURS")) return "POST";
            if (ms === "REGULAR" || ms === "REG") {
                // API 说 REGULAR，但如果时间不对就降级
                if (isWeekend) return "CLOSED";
                if (totalMinutes < 9 * 60 + 30 || totalMinutes >= 16 * 60) return "CLOSED";
                return "REG";
            }
        }

        // Fallback：基于美东时间的本地判定
        if (isWeekend) return "CLOSED";
        
        // 美股交易时间（美东时间）：
        // PRE: 04:00 - 09:30
        // REG: 09:30 - 16:00
        // POST: 16:00 - 20:00
        // CLOSED: 20:00 - 04:00 (次日)
        
        if (totalMinutes >= 4 * 60 && totalMinutes < 9 * 60 + 30) {
            return "PRE";
        } else if (totalMinutes >= 9 * 60 + 30 && totalMinutes < 16 * 60) {
            return "REG";
        } else if (totalMinutes >= 16 * 60 && totalMinutes < 20 * 60) {
            return "POST";
        } else {
            return "CLOSED";
        }
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
        const orKey = this.keyFilled(this.apiKeys?.openrouterKey) ? this.apiKeys.openrouterKey : "";
        if (!dsKey && !orKey) { // Relax check if OR key is present
            analysisEl.innerText = "请先在设置中填写 DeepSeek Key 或 OpenRouter Key";
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

            // [FIX] Show popup immediately so user knows it is working
            this.updateAiPopup("Initiating AI Analysis...<br/>Fetching News & Macro Data...", ctx.symbol, true);
            
            // 1. Fetch News First
            const newsHeadlines = await this.fetchMarketNews(ctx.symbol);
            const newsText = newsHeadlines.length > 0 ? newsHeadlines.join("; ") : "暂无重磅新闻";
            const portfolioText = this.getPortfolioSummary();

            // 2. Build Enhanced Prompt (Aggressive Context Injection)
            const prompt = `
                身份：华尔街资深对冲基金经理 (Macro-driven Technical Trader)。
                任务：这不仅是分析，而是针对我（用户）账户的实战操作建议。
                
                【核心原则】
                1. **必须检查用户持仓**：如果你在下方【用户持仓参考】中能找到当前标的 (${ctx.symbol})，务必根据具体盈亏给出建议（例："持有xx股浮亏，建议反弹减仓"）。不要假装我没持仓！
                2. **宏观风控**：若 VIX > 25，禁止推荐激进买入。
                
                【宏观环境】
                ${this.macroCache ? this.macroCache.summary : "Pending"}
                
                【用户持仓参考 (务必阅读)】
                ${portfolioText}

                【标的实时数据】
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
                    "action": "BUY" | "SELL" | "HOLD",
                    "confidence": 0.0-1.0 (置信度),
                    "quantity_pct": 0-100 (建议仓位比例),
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

            // Helpers for OpenAI-compatible endpoints
            const buildOAIBody = (model) => ({
                model,
                messages: [
                    { role: "system", content: "你是一位资深对冲基金经理。请用中文回答，并只返回有效的 JSON 格式。You are a Hedge Fund Manager. Reply in Chinese and return ONLY valid JSON." },
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

            // DeepSeek
            if (dsKey) {
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
                                    {"role": "system", "content": "你是一位资深对冲基金经理。请用中文回答，并只返回有效的 JSON 格式。"},
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
            }

            // OpenRouter (The Universal Key solution)
            if (orKey) {
                const userModel = (this.modelConfig && this.modelConfig.openrouterModel) || "anthropic/claude-3.5-sonnet";
                
                addTask("openrouter", "OpenRouter", "#AB47BC", async () => {
                    const url = "https://openrouter.ai/api/v1/chat/completions";
                    const headers = { 
                        "Content-Type": "application/json", 
                        "Authorization": `Bearer ${orKey}`,
                        "HTTP-Referer": "https://ibkr.com", // Required by OpenRouter for ranking
                        "X-Title": "IBKR Copilot"
                    };
                    
                    const resp = await runViaBackground(url, headers, {
                        model: userModel,
                        messages: [
                            { role: "system", content: "你是一位资深对冲基金经理。请用中文回答，并只返回有效的 JSON 格式。" },
                            { role: "user", content: prompt }
                        ],
                        temperature: 0.4,
                        max_tokens: 500
                    });

                    if (!resp.choices || !resp.choices.length) throw new Error("OpenRouter Empty Response");
                    let raw = resp.choices[0].message.content;
                    raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                    return JSON.parse(raw);
                });
            }

            // Only manual triggers will fan out to other models to节省调用
            if (!autoTriggerReason && gemKey) {
                addTask("gemini", "Gemini", "#ba68c8", async () => {
                    let userModelID = (this.modelConfig && this.modelConfig.geminiModel) ? this.modelConfig.geminiModel : "gemini-1.5-flash";
                    userModelID = userModelID.replace(/^models\//, "").trim();
                    if(!userModelID) userModelID = "gemini-1.5-flash"; 

                    const candidates = [
                        { id: userModelID, version: "v1beta" },
                        { id: "gemini-1.5-flash", version: "v1beta" },
                        { id: "gemini-1.5-pro", version: "v1beta" },
                        { id: "gemini-2.0-flash-exp", version: "v1beta" },
                        { id: "gemini-pro", version: "v1beta" },
                        { id: "gemini-pro", version: "v1" }
                    ];
                    
                    const unique = [];
                    const seen = new Set();
                    candidates.forEach(c => {
                         const k = c.id + c.version;
                         if(!seen.has(k)) { seen.add(k); unique.push(c); }
                    });

                    let lastError = null;

                    const execute = async (mid, ver) => {
                         const baseUrl = `https://generativelanguage.googleapis.com/${ver}/models/`;
                         const cleanId = mid.replace(/^models\//, "");
                         const url = `${baseUrl}${cleanId}:generateContent?key=${gemKey}`;
                         
                         console.log(`[IBKR AI] Gemini Try: ${mid} (${ver})`);
                         const response = await runViaBackground(url, null, {
                                contents: [{ parts: [{ text: "You are a Hedge Fund Manager. Return ONLY valid JSON. " + prompt }] }]
                         }, 15000);

                         if (response && response.candidates && response.candidates.length) {
                                let raw = response.candidates[0].content.parts[0].text;
                                raw = raw.replace(/```json/g, "").replace(/```/g, "").trim();
                                return JSON.parse(raw);
                         }
                         if (response && response.error) {
                             throw new Error(response.error.message || JSON.stringify(response.error));
                         }
                         throw new Error("Invalid structure");
                    };

                    for (const cand of unique) {
                        try {
                            return await execute(cand.id, cand.version);
                        } catch (e) {
                            lastError = e;
                            const msg = e.message.toLowerCase();
                            if (msg.includes("404") || msg.includes("not found")) continue;
                            if (msg.includes("key") || msg.includes("auth") || msg.includes("403")) throw e;
                        }
                    }

                    // Discovery Fallback using GET
                    try {
                        console.log("[IBKR AI] Gemini Fallback: Discovery Mode");
                        const listUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${gemKey}`;
                        const listRaw = await this.proxyFetch(listUrl); 
                        const listData = (typeof listRaw === 'string') ? JSON.parse(listRaw) : listRaw;
                        
                        if (listData && listData.models) {
                            const valid = listData.models.find(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"));
                            if (valid) {
                                console.log(`[IBKR AI] Discovered: ${valid.name}`);
                                return await execute(valid.name, "v1beta");
                            }
                        }
                    } catch(e) {
                        console.warn("Discovery failed", e);
                    }

                    if (lastError && lastError.message) {
                        if (lastError.message.includes("404")) throw new Error("Gemini: All models 404 (Check API Key / VPN Region)");
                    }
                    throw lastError || new Error("Gemini Connection Failed");
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

            // Action Aggregation
            const voteMap = { "BUY": 0, "SELL": 0, "HOLD": 0 };
            let highConfAction = null;

            validResults.forEach(r => {
                 const json = this.tryParse(r.data);
                 if (json) {
                    totalSent += (json.sentiment || 5);
                    if (json.support) { supSum += parseFloat(json.support); supCount++; }
                    if (json.resistance) { resSum += parseFloat(json.resistance); resCount++; }
                    
                    // Vote logic
                    const act = (json.action || "HOLD").toUpperCase();
                    if (voteMap[act] !== undefined) voteMap[act]++;
                    else voteMap["HOLD"]++; // Default fallback

                    count++;
                    
                    commentaryHTML += `
                        <div style="margin-bottom:8px; border-left:2px solid ${r.color}; padding-left:6px;">
                            <strong style="color:${r.color}; font-size:11px;">[${r.name}]</strong>
                            <span style="font-size:10px; font-weight:bold; color:${act==='BUY'?'#4caf50':(act==='SELL'?'#f44336':'#aaa')}">[${act}]</span>
                            <span style="font-size:12px;">${json.analysis}</span>
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

            // Determine Winner Action
            let winner = "HOLD";
            let maxVotes = -1;
            for(let k in voteMap) {
                if(voteMap[k] > maxVotes) { maxVotes = voteMap[k]; winner = k; }
            }
            if (winner !== "HOLD" && maxVotes < count / 2) winner = "HOLD"; // Weak consensus -> Hold

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

            const actionColor = winner==='BUY'?'#4caf50':(winner==='SELL'?'#f44336':'#aaa');
            analysisEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>综合评级 ${avgSent}/10</strong>
                    <strong style="color:${actionColor}; border:1px solid ${actionColor}; padding:0 4px; border-radius:3px;">${winner}</strong>
                </div>
            `;
            
            // Show detailed popup
            this.updateAiPopup(commentaryHTML, `${ctx.symbol} AI Analysis`, false);

            // AUTO-TRADE TRIGGER (Experimental)
            if (this.settings.autoTradeEnabled) {
                this.executor.evaluateSignal(winner, avgSent, ctx); 
            }

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
            // Do NOT return if panel missing. Some IBKR pages change DOM; show popup anyway.
            popup = document.createElement("div");
            popup.id = "ibkr-ai-popup";
            popup.className = "ibkr-ai-popup";
            popup.innerHTML = `
                <div class="ibkr-ai-popup-header">
                    <span class="ibkr-ai-popup-title">AI Analysis</span>
                    <button class="ibkr-ai-popup-close" id="ibkr-ai-popup-close">✕</button>
                </div>
                <div class="ibkr-ai-popup-content" id="ibkr-ai-popup-content"></div>
                <div class="ibkr-ai-popup-chat" id="ibkr-ai-popup-chat">
                    <div class="ibkr-ai-chat-history" id="ibkr-ai-chat-history"></div>
                    <div class="ibkr-ai-chat-input-wrapper">
                        <input type="text" id="ibkr-ai-chat-input" placeholder="继续提问..." />
                        <button id="ibkr-ai-chat-send">发送</button>
                    </div>
                </div>
            `;
            // Append to body so visibility isn't dependent on the panel's parent
            document.body.appendChild(popup);
            popup.style.zIndex = 2147483647;

            // Close handler
            const closeBtn = document.getElementById("ibkr-ai-popup-close");
            if (closeBtn) {
                closeBtn.addEventListener("click", () => {
                    popup.style.display = "none";
                });
            }

            // Chat handlers
            this.setupChatHandlers();
        }

        const contentDiv = document.getElementById("ibkr-ai-popup-content");
        const titleEl = document.querySelector(".ibkr-ai-popup-title");
        if (titleEl) titleEl.innerText = title || "AI Analysis";

        if (isLoading) {
             popup.style.display = "block";
             if (contentDiv) contentDiv.innerHTML = `<div style="text-align:center; padding:20px; color:#aaa;">Thinking...<br/>(Calling DeepSeek & Models)</div>`;
        } else {
             popup.style.display = "block";
             if (contentDiv) contentDiv.innerHTML = contentHtml;
        }

        try { console.log(`[IBKR AI] updateAiPopup: title=${title} loading=${!!isLoading}`); } catch(e) {}
        this.positionAiPopup();
    }

    setupChatHandlers() {
        const sendBtn = document.getElementById("ibkr-ai-chat-send");
        const input = document.getElementById("ibkr-ai-chat-input");
        
        const sendMessage = async () => {
            const question = input.value.trim();
            if (!question) return;
            
            input.value = "";
            this.addChatMessage("user", question);
            this.addChatMessage("assistant", "正在思考...", true);
            
            try {
                const answer = await this.askFollowUpQuestion(question);
                this.updateLastChatMessage(answer);
            } catch (e) {
                this.updateLastChatMessage("抱歉，回答失败: " + e.message);
            }
        };
        
        if (sendBtn) {
            sendBtn.addEventListener("click", sendMessage);
        }
        
        if (input) {
            input.addEventListener("keypress", (e) => {
                if (e.key === "Enter") {
                    sendMessage();
                }
            });
        }
    }

    addChatMessage(role, content, isLoading = false) {
        const history = document.getElementById("ibkr-ai-chat-history");
        if (!history) return;
        
        const msgDiv = document.createElement("div");
        msgDiv.className = `ibkr-chat-msg ibkr-chat-msg-${role}`;
        if (isLoading) msgDiv.classList.add("ibkr-chat-loading");
        msgDiv.innerHTML = `<div class="ibkr-chat-msg-content">${content}</div>`;
        history.appendChild(msgDiv);
        history.scrollTop = history.scrollHeight;
    }

    updateLastChatMessage(content) {
        const history = document.getElementById("ibkr-ai-chat-history");
        if (!history) return;
        
        const lastMsg = history.lastElementChild;
        if (lastMsg) {
            lastMsg.classList.remove("ibkr-chat-loading");
            lastMsg.querySelector(".ibkr-chat-msg-content").textContent = content;
        }
    }

    async askFollowUpQuestion(question) {
        // Use the primary AI (DeepSeek by default)
        const ctx = this.currentMarketContext || {
            symbol: this.state.symbol,
            price: this.state.price,
            change: 0,
            volatility: "N/A",
            position: null,
            pnlPercentage: 0,
            session: "REG"
        };
        
        // 构建完整上下文（避免 AI 幻觉）
        const rsi = document.getElementById("assist-rsi")?.innerText || "--";
        const macd = document.getElementById("assist-macd")?.innerText || "--";
        const atr = document.getElementById("assist-atr")?.innerText || "--";
        
        const prompt = `【实时市场数据】
标的: ${ctx.symbol}
当前价格: $${ctx.price}
价格变动: ${ctx.change > 0 ? '+' : ''}${ctx.change.toFixed(2)}
波动率: ${ctx.volatility}
市场状态: ${ctx.session}

【技术指标】
RSI(14): ${rsi}
MACD: ${macd}
ATR(14): ${atr}

【用户持仓】
${ctx.position ? `持有 ${ctx.position.shares} 股，成本 $${ctx.position.avgPrice}，当前浮动盈亏 ${ctx.pnlPercentage.toFixed(2)}%` : '无持仓'}

【用户追问】
"${question}"

【回答要求】
1. **基于上述真实数据回答**，不要凭空猜测或编造信息
2. 如果用户提到的价格（如137.42）与当前价格不同，说明是历史入场价
3. 给出具体操作建议：持有/加仓/减仓/止损，并说明理由
4. 考虑技术指标信号（RSI超买超卖、MACD多空）
5. 用中文简洁回答，100-150字

**禁止编造**：不要说股票退市、停牌等未经确认的信息！`;

        const deepseekKey = this.apiKeys.deepseekKey;
        if (!this.keyFilled(deepseekKey)) {
            throw new Error("DeepSeek API Key 未配置");
        }

        const url = AI_CONFIG.API_URL;
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${deepseekKey}`
        };
        const body = {
            model: AI_CONFIG.MODEL || "deepseek-chat",
            messages: [
                { 
                    role: "system", 
                    content: "你是专业交易顾问。你必须严格基于提供的实时数据回答，不能编造信息。如果数据不足，明确说明'数据不足'而非猜测。用中文回答。" 
                },
                { 
                    role: "user", 
                    content: prompt 
                }
            ],
            max_tokens: 300,
            temperature: 0.5
        };

        // Use chrome.runtime.sendMessage to call background script
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: "FETCH_AI", url, headers, body },
                (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (!response.success) {
                        reject(new Error(response.error || "API调用失败"));
                        return;
                    }
                    const resp = response.data;
                    if (!resp.choices || !resp.choices.length) {
                        reject(new Error("Empty Response"));
                        return;
                    }
                    resolve(resp.choices[0].message.content.trim());
                }
            );
        });
    }

    positionAiPopup() {
        const popup = document.getElementById("ibkr-ai-popup");
        const panel = document.getElementById("ibkr-pnl-panel");
        if (popup) {
            if (panel) {
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
            popup.style.right = "auto"; // Force clear right to prevent CSS conflict
            } else {
                // No panel found: position to top-right corner
                popup.style.top = "20px";
                popup.style.right = "20px";
                popup.style.left = "auto";
            }
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

    async fetchTickerData(symbol) {
        try {
            const rawText = await this.proxyFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`);
            const data = JSON.parse(rawText);
            const result = data.chart?.result?.[0];
            if (!result) return null;
            
            const meta = result.meta;
            let price = meta.regularMarketPrice;
            const prevClose = meta.chartPreviousClose || meta.previousClose;
            
            if (price == null) {
                const quotes = result.indicators.quote[0].close;
                const valid = quotes.filter(c => c != null);
                if (valid.length) price = valid[valid.length - 1];
            }
            
            if (price != null && prevClose) {
                const changePct = ((price - prevClose) / prevClose) * 100;
                return { 
                    symbol, 
                    price, 
                    changePct, 
                    fmt: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%` 
                };
            }
            return null;
        } catch (e) {
            console.warn(`Failed to fetch ${symbol}`, e);
            return null;
        }
    }

    async fetchMacroData() {
        if (this.macroCache && (Date.now() - this.macroCache.ts < 300000)) return; 
        
        try {
            // Try primary providers, but prefer external professional sources when available
            const [spy, xlk, xlf, iwm] = await Promise.all([
                this.fetchTickerData("SPY"),
                this.fetchTickerData("XLK"),
                this.fetchTickerData("XLF"),
                this.fetchTickerData("IWM")
            ]);

            // For VIX and TNX try external providers first (CBOE / TradingView via proxyFetch)
            let vix = null, tnx = null;
            try { vix = await this.fetchExternalMacro('^VIX'); } catch(e){ console.warn('fetchExternalMacro VIX failed', e); }
            try { tnx = await this.fetchExternalMacro('^TNX'); } catch(e){ console.warn('fetchExternalMacro TNX failed', e); }

            // Fallback to Yahoo if external provider didn't return usable data
            if (!vix) vix = await this.fetchTickerData("^VIX");
            if (!tnx) tnx = await this.fetchTickerData("^TNX");

            let regime = "Normal";
            let vixVal = vix ? vix.price : 0;
            if (vixVal < 15) regime = "Low Vol (Complacency)";
            else if (vixVal > 30) regime = "Extreme Fear (Crash)";
            else if (vixVal > 20) regime = "High Vol (Risk-Off)";
            
            const summary = `SPY:${spy?spy.fmt:"--"} | VIX:${vixVal.toFixed(1)}(${regime}) | 10Y:${tnx?tnx.price.toFixed(2)+"%":"--"} | XLK:${xlk?xlk.fmt:"--"} XLF:${xlf?xlf.fmt:"--"}`;

            this.macroCache = { 
                summary,
                vix: vixVal,
                regime,
                ts: Date.now() 
            };
            
            const ribbon = document.getElementById("macro-ribbon");
            if (ribbon) {
                let color = '#4caf50'; 
                if (vixVal > 20) color = '#ff9800'; 
                if (vixVal > 30) color = '#ff5252'; 
                
                ribbon.innerHTML = `
                    <span style="font-weight:bold;color:${color}">VIX: ${vixVal.toFixed(2)} (${regime})</span>
                    <span style="margin-left:10px;font-size:0.9em;color:#aaa">SPY ${spy?spy.fmt:"--"} | XLK ${xlk?xlk.fmt:"--"}</span>
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

    // === 技术指标计算方法 ===
    calculateRSI(prices, period = 14) {
        if (prices.length < period + 1) return 50;
        
        let gains = 0;
        let losses = 0;
        
        for (let i = prices.length - period; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses += Math.abs(change);
            }
        }
        
        const avgGain = gains / period;
        const avgLoss = losses / period;
        
        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    calculateEMA(prices, period) {
        if (prices.length < period) return prices[prices.length - 1];
        
        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
        
        for (let i = period; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        
        return ema;
    }

    calculateMACD(prices) {
        if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0, prev: 0 };
        
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macd = ema12 - ema26;
        
        // 简化: 使用最近9个MACD值计算signal (实际应用EMA，这里简化为SMA)
        const macdLine = [];
        for (let i = 26; i <= prices.length; i++) {
            const slice = prices.slice(0, i);
            const e12 = this.calculateEMA(slice, 12);
            const e26 = this.calculateEMA(slice, 26);
            macdLine.push(e12 - e26);
        }
        
        const signal = macdLine.length >= 9 
            ? macdLine.slice(-9).reduce((a, b) => a + b, 0) / 9
            : macd;
        
        const histogram = macd - signal;
        const prev = macdLine.length >= 2 ? macdLine[macdLine.length - 2] - signal : 0;
        
        return { macd, signal, histogram, prev };
    }

    calculateATR(prices, period = 14) {
        if (prices.length < period + 1) return 0;
        
        let trSum = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const high = prices[i];
            const low = prices[i];
            const prevClose = prices[i - 1];
            
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );
            trSum += tr;
        }
        
        return trSum / period;
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

    showTopBanner(msg, action) {
        // 移除已存在的横幅
        const existing = document.getElementById("ibkr-top-banner");
        if (existing) existing.remove();

        const banner = document.createElement("div");
        banner.id = "ibkr-top-banner";
        
        const colors = {
            "BUY": { bg: "#4caf50", text: "#fff" },
            "SELL": { bg: "#f44336", text: "#fff" },
            "HOLD": { bg: "#ffa726", text: "#000" }
        };
        
        const color = colors[action] || colors.HOLD;
        
        banner.style.position = "fixed";
        banner.style.top = "0";
        banner.style.left = "0";
        banner.style.width = "100%";
        banner.style.background = color.bg;
        banner.style.color = color.text;
        banner.style.padding = "12px 20px";
        banner.style.fontSize = "14px";
        banner.style.fontWeight = "bold";
        banner.style.textAlign = "center";
        banner.style.zIndex = 2147483646;
        banner.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
        banner.style.display = "flex";
        banner.style.alignItems = "center";
        banner.style.justifyContent = "center";
        banner.style.gap = "10px";
        
        banner.innerHTML = `
            <span>${msg}</span>
            <button id="ibkr-banner-close" style="
                background: rgba(255,255,255,0.2);
                border: none;
                color: ${color.text};
                padding: 4px 8px;
                border-radius: 3px;
                cursor: pointer;
                font-size: 12px;
            ">关闭</button>
        `;
        
        document.body.prepend(banner);
        
        // 自动关闭
        setTimeout(() => {
            if (banner.parentNode) {
                banner.style.opacity = "0";
                banner.style.transition = "opacity 0.5s";
                setTimeout(() => banner.remove(), 500);
            }
        }, 10000);
        
        // 手动关闭
        const closeBtn = document.getElementById("ibkr-banner-close");
        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                banner.style.opacity = "0";
                banner.style.transition = "opacity 0.3s";
                setTimeout(() => banner.remove(), 300);
            });
        }
    }

    formatGeminiError(msg) {
        if (!msg) return "无响应";
        const lower = msg.toLowerCase();
        // Tongyi / Alibaba specific
        if (lower.includes("arrearage")) return "阿里云账户欠费/额度耗尽，请充值";
        if (lower.includes("invalidapikey")) return "API Key 无效或不存在";

        // Gemini / General
        if (lower.includes("403")) return "403 禁止：检查 API Key 或切换 VPN 节点";
        if (lower.includes("404")) return `404: 模型/路径错误 | ${msg}`; // Show full msg
        if (lower.includes("429")) return "429 限流：调用太频繁或模型配额已满 (建议换 gemini-1.5-flash)";
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

    // Scrape visible rows to give LLM context on user's potential holdings (Heuristic)
    getPortfolioSummary() {
        try {
            // SlickGrid often splits rows into locked (left) and scrollable (right) panes.
            // Rows are positioned absolutely with 'top: Xpx'. We need to merge them by 'top'.
            const rows = Array.from(document.querySelectorAll(".slick-row"));
            if (!rows.length) return "Portfolio not visible (List Empty)";

            const map = new Map();
            
            rows.forEach(r => {
                const top = r.style.top || "0px";
                if (!map.has(top)) map.set(top, []);
                map.get(top).push(r.innerText.replace(/[\r\n]+/g, " ").trim());
            });

            // Sort by pixel position (parse "123px")
            const sortedKeys = Array.from(map.keys()).sort((a,b) => {
                return parseInt(a) - parseInt(b);
            });

            const summary = sortedKeys.map(k => {
                // Join parts (e.g. Symbol part + Data part)
                return map.get(k).join(" "); 
            })
            .filter(t => t.length > 3 && /[0-9]/.test(t)) // Filter out empty headers
            .slice(0, 20) // Limit to top 20 rows
            .join("\n");

            // Attach click handlers so user can click a row to deep-dive
            try { this.attachPortfolioRowHandlers(rows); } catch(e) { console.warn("attachPortfolioRowHandlers failed", e); }

            return summary || "None detected";
        } catch (e) {
            return "Error scanning portfolio";
        }
    }

    // Make visible portfolio rows clickable for deep-dive analysis
    attachPortfolioRowHandlers(rows) {
        if (!rows || !rows.length) return;
        rows.forEach(r => {
            try {
                r.style.cursor = 'pointer';
                r.title = '点击查看持仓深度分析';
                // Avoid duplicate handlers
                if (!r.__ibkr_row_click) {
                    r.__ibkr_row_click = true;
                    r.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        const txt = r.innerText.replace(/[\r\n]+/g, ' ').trim();
                        this.onPortfolioRowClick(txt, r);
                    });
                }
            } catch(e) {}
        });
    }

    // Called when a portfolio row is clicked. Parse basic fields and show popup with Analyze button.
    onPortfolioRowClick(rowText, rowEl) {
        // Try to heuristically parse: symbol, shares, avg price, cost
        let symbol = null, shares = null, avg = null;
        // Symbol: first uppercase token of 1-5 letters
        const symMatch = rowText.match(/\b([A-Z]{1,5})\b/);
        if (symMatch) symbol = symMatch[1];

        // Shares: look for patterns like '100', '100.0', or 'Shares: 100'
        const shMatch = rowText.match(/(\d{1,6}(?:[\.,]\d{1,3})?)\s*(?:shares|sh|股)?/i);
        if (shMatch) shares = parseFloat(shMatch[1].replace(/,/g, ''));

        // Avg price: look for '@ 123.45' or 'Avg: 123.45' or '平均价 123.45'
        const avgMatch = rowText.match(/(?:@|Avg(?:\w*)?:|平均价\s*)(\d{1,6}(?:[\.,]\d{1,4})?)/i);
        if (avgMatch) avg = parseFloat(avgMatch[1].replace(/,/g, ''));

        // Build display
        let html = `<div style="font-size:13px;">
            <div><b>Row:</b> ${symbol || 'Unknown'}</div>
            <div><b>Shares:</b> ${shares != null ? shares : 'Unknown'}</div>
            <div><b>Avg:</b> ${avg != null ? avg : 'Unknown'}</div>
            <div style="margin-top:8px; color:#ccc; font-size:12px;">原始行: <div style='font-size:11px; color:#999; margin-top:6px;'>${rowText}</div></div>
            <div style="margin-top:8px; text-align:right;"><button id='__ibkr_analyze_row' style='background:#007acc;color:#fff;border:none;padding:6px 8px;border-radius:3px;cursor:pointer;'>AI 深度分析</button></div>
        </div>`;

        this.updateAiPopup(html, `${symbol || 'Position'} Deep-Dive`, false);

        // Click handler for analyze button
        setTimeout(() => {
            const btn = document.getElementById('__ibkr_analyze_row');
            if (!btn) return;
            btn.onclick = async () => {
                // Prepare context for AI
                const ctx = this.currentMarketContext || {};
                ctx.position = ctx.position || {};
                if (symbol) ctx.symbol = symbol;
                if (shares != null) ctx.position.shares = shares;
                if (avg != null) ctx.position.avgPrice = avg;
                // Set PnL if current price known
                if (ctx.price && ctx.position && ctx.position.avgPrice) {
                    const mktVal = ctx.position.shares * ctx.price;
                    const cost = ctx.position.shares * ctx.position.avgPrice;
                    ctx.pnlPercentage = ((mktVal - cost)/cost) * 100;
                }
                // Ensure popup indicates loading
                this.updateAiPopup('Preparing portfolio deep-dive...<br/>调用模型中...', `${ctx.symbol} Deep-Dive`, true);
                // Trigger the normal AI pipeline (manual)
                try {
                    // Give triggerAIAnalysis a hint by setting lastAutoRun small to allow immediate run
                    this.lastAutoRun = 0;
                    await this.triggerAIAnalysis(null);
                } catch(e) {
                    console.error('Deep-dive analyze failed', e);
                    this.updateAiPopup(`<div style="color:#ff5252">分析失败: ${e.message}</div>`, `${ctx.symbol} Deep-Dive`, false);
                }
            };
        }, 200);
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
                
                // --- 做T策略信号逻辑（Watchlist）---
                // 基于日内涨跌判断低吸高抛机会
                let action = "观望";
                let actionColor = "#555";
                let actionReason = "涨跌幅在正常波动范围内";
                
                if (changeP >= 2.5) { 
                    action = "�卖出"; 
                    actionColor = "#f44336"; // Red
                    actionReason = `日内涨幅${changeP.toFixed(2)}%，高位卖出做T，等待回调再接`;
                } else if (changeP >= 1.0) {
                    action = "📤减仓";
                    actionColor = "#ff9800"; // Orange
                    actionReason = `日内涨幅${changeP.toFixed(2)}%，部分获利了结，保留底仓`;
                } else if (changeP <= -3.0) {
                    action = "📥收筹";
                    actionColor = "#4caf50"; // Green
                    actionReason = `日内跌幅${Math.abs(changeP).toFixed(2)}%，低位收筹码，分批建仓`;
                } else if (changeP <= -1.5) {
                    action = "✅买入";
                    actionColor = "#66bb6a"; // Light Green
                    actionReason = `日内跌幅${Math.abs(changeP).toFixed(2)}%，回调到位，适合低吸做T`;
                } else if (changeP > -0.5 && changeP < 0.5) {
                    action = "🔄观察";
                    actionColor = "#9e9e9e"; // Gray
                    actionReason = "价格窄幅震荡，等待明确方向";
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

                // 2. Build Mini List HTML with tooltip
                miniHTML += `
                    <div class="mini-wl-row">
                        <span class="mini-wl-symbol" title="${sym}">${sym}</span>
                        <span class="mini-wl-price">${price.toFixed(2)}</span>
                        <span class="mini-wl-action" 
                              style="color:${actionColor}; border:1px solid ${actionColor}; border-radius:3px; cursor:help;" 
                              title="${actionReason}">${action}</span>
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
            openrouterKey: document.getElementById("set-or-key").value.trim(),
            tongyiKey: document.getElementById("set-tongyi-key").value.trim(),
            doubaoKey: document.getElementById("set-doubao-key").value.trim(),
            claudeKey: document.getElementById("set-claude-key").value.trim(),
            chatgptKey: document.getElementById("set-chatgpt-key").value.trim(),
            grokKey: document.getElementById("set-grok-key").value.trim()
        };
        
        // Auto-Trade Settings
        this.settings.autoTradeEnabled = document.getElementById("set-autotrade").checked;

        // Save Models
        const dbModel = document.getElementById("set-doubao-model").value.trim();
        const gemModel = document.getElementById("set-gemini-model").value.trim();
        this.modelConfig.doubaoModel = dbModel;
        this.modelConfig.geminiModel = gemModel;
        const orModel = document.getElementById("set-or-model").value.trim();
        this.modelConfig.openrouterModel = orModel;

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

class TradeExecutor {
    constructor(app) {
        this.app = app;
    }

    evaluateSignal(action, sentiment, ctx) {
        // 取消顶部横幅通知（做T模式下不需要追涨提示）
        // 用户需要手动查看分析结果决策
        
        if (action === "HOLD") return;

        // Safety Gates
        if (action === "BUY" && sentiment < 7) {
            console.log("[AutoTrade] Skipped BUY due to low sentiment:", sentiment);
            return;
        }
        if (action === "SELL" && sentiment > 4) {
             console.log("[AutoTrade] Skipped SELL due to high sentiment:", sentiment);
             return;
        }

        this.app.showToast(`🤖 AutoTrade Triggered: ${action} ${ctx.symbol}`, "warn");
        
        // Execution
        this.attemptExecution(action, ctx.symbol);
    }

    async attemptExecution(action, symbol) {
        console.log(`[AutoTrade] Executing ${action} on ${symbol}...`);
        
        // 1. Identify Order Ticket Elements
        // NOTE: These selectors are HYPOTHETICAL. 
        // User needs to inspect IBKR page and update these IDs/Classes.
        const selectors = {
            buyBtn: "button[data-action='buy'], .order-button-buy", 
            sellBtn: "button[data-action='sell'], .order-button-sell",
            quantityInput: "input.order-quantity",
            priceInput: "input.order-price",
            submitBtn: "button.submit-order"
        };
        
        // 2. Try to find Buy/Sell button and Click
        const btnSelector = action === "BUY" ? selectors.buyBtn : selectors.sellBtn;
        const btn = document.querySelector(btnSelector);
        
        if (btn) {
            btn.click();
            this.app.showToast("✅ AutoTrade: Clicked Order Button", "success");
            
            // Wait for ticket to open
            await new Promise(r => setTimeout(r, 1000));
            
            // 3. Fill Quantity (Example: 100 shares default)
            const qtyInput = document.querySelector(selectors.quantityInput);
            if (qtyInput) {
                qtyInput.value = "100";
                qtyInput.dispatchEvent(new Event('input', { bubbles: true }));
                qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
            
            // 4. NOTE: We do NOT click Submit automatically for safety.
            // asking user to confirm.
            this.app.showToast("⚠️ 订单已预填，请人工确认提交！", "warn");
            
        } else {
            // Fallback: If no button found, just alert
            const msg = `[模拟交易] 应执行 ${action}，但未找到下单按钮 (需适配 DOM)`;
            console.warn(msg);
            this.app.updateAiPopup(`<div style="color:orange">${msg}</div>`, "AutoTrade Algo", false);
        }
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
