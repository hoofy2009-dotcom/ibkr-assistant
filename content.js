// IBKR Trading Assistant - 闪电侠 (快速日内交易专家)

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
            lastDomPrice: 0,
            updateInterval: 20000, // 默认20秒，可动态调整
            spyChange: 0 // 🚨 大盘涨跌幅 - 用于大盘过滤
        };

        // 性能优化：Watchlist历史数据追踪
        this.watchlistHistory = new Map(); // symbol -> {history: [], lastUpdate: timestamp}
        this.watchlistUpdateTimer = null;

        // Cache latest AI verdict per symbol (used by watchlist to stay consistent)
        this.aiDecisionCache = new Map();

        // 技术指标趋势追踪
        this.indicatorHistory = {
            rsi: [],
            macd: [],
            lastRSI: null,
            lastMACD: null
        };

        // 通知去重
        this.lastNotifications = new Map(); // key -> timestamp
        this.notificationCooldown = 300000; // 5分钟冷却期

        // API keys (stored locally via chrome.storage)
        this.apiKeys = {
            deepseekKey: "",
            geminiKey: "",
            tongyiKey: "",
            doubaoKey: "",
            claudeKey: "",
            chatgptKey: "",
            grokKey: "",
            finnhubKey: ""  // Finnhub免费API: https://finnhub.io/register
        };
            // Model overrides (user-specified)
            this.modelConfig = {
                doubaoModel: AI_CONFIG.DOUBAO_MODEL,
                geminiModel: "gemini-3-pro-preview"
            };
        
        // 用户设置
        this.settings = {
            updateMode: "auto", // auto/fast/normal/slow
            notificationsEnabled: true
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
        
        // Watchlist历史数据追踪 (每分钟更新一次，节省API)
        this.startWatchlistHistoryTracking();
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
                <span class="ibkr-assistant-title">🏃 闪电侠</span>
                <div>
                   <button class="icon-btn" id="ibkr-watchlist" title="Watchlist">📋</button>
                   <button class="icon-btn" id="ibkr-settings" title="Settings">⚙</button>
                   <button class="icon-btn" id="ibkr-minimize">_</button>
                   <button class="icon-btn" id="ibkr-close">✕</button>
                </div>
            </div>
            
            <div class="macro-ribbon" id="macro-ribbon">
                <div class="macro-row">
                    <span id="macro-market">📊 SPY: --</span>
                    <span id="macro-vix">🔥 VIX: --</span>
                </div>
                <div class="macro-row">
                    <span id="macro-sentiment">😐 情绪: --</span>
                    <span id="macro-options">🎲 P/C: --</span>
                </div>
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

                <!-- Advanced Data Section (Collapsible) -->
                <div class="advanced-data-section" style="margin-top:8px; border-top:1px dashed #333; padding-top:5px;">
                    <div class="data-row" style="cursor:pointer;" id="advanced-data-toggle">
                        <span class="label" style="font-weight:bold; color:#64b5f6;">📊 高级数据</span>
                        <div style="display:flex; align-items:center; gap:5px;">
                            <button id="btn-refresh-advanced" style="font-size:9px; background:#007acc; color:white; border:none; padding:1px 4px; cursor:pointer; border-radius:2px;" title="立即刷新">🔄</button>
                            <span class="value" style="font-size:10px; color:#888;" id="advanced-toggle-icon">▶ 点击展开</span>
                        </div>
                    </div>
                    <div id="advanced-data-content" style="display:none; margin-top:5px;">
                        <!-- Loading indicator -->
                        <div id="advanced-loading" style="text-align:center; color:#888; padding:10px; font-size:10px;">
                            ⏳ 正在加载数据...<br/>
                            <span style="font-size:9px;">(首次加载需要3-5秒)</span>
                        </div>
                        
                        <!-- Volume Analysis -->
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">📈 成交量</span>
                            <span class="value" id="adv-volume">--</span>
                        </div>
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">量比</span>
                            <span class="value">
                                <span id="adv-volume-ratio">--</span>
                                <span id="adv-volume-signal" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        
                        <!-- 52 Week Position -->
                        <div class="data-row" style="font-size:10px; margin-top:3px;">
                            <span class="label">📍 52周位置</span>
                            <span class="value">
                                <span id="adv-52w-position">--</span>
                                <span id="adv-52w-signal" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">52周区间</span>
                            <span class="value" id="adv-52w-range">--</span>
                        </div>
                        
                        <!-- Options Data -->
                        <div class="data-row" style="font-size:10px; margin-top:3px;">
                            <span class="label">🎲 期权P/C</span>
                            <span class="value">
                                <span id="adv-pc-ratio">--</span>
                                <span id="adv-pc-signal" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">隐含波动率</span>
                            <span class="value">
                                <span id="adv-iv">--</span>
                                <span id="adv-iv-signal" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        
                        <!-- Analyst Ratings -->
                        <div class="data-row" style="font-size:10px; margin-top:3px;">
                            <span class="label">👔 分析师</span>
                            <span class="value">
                                <span id="adv-analyst">--</span>
                                <span id="adv-analyst-count" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">目标价</span>
                            <span class="value">
                                <span id="adv-target-price">--</span>
                                <span id="adv-upside" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
                        
                        <!-- Institutional Data -->
                        <div class="data-row" style="font-size:10px; margin-top:3px;">
                            <span class="label">🏦 机构持股</span>
                            <span class="value" id="adv-institution">--</span>
                        </div>
                        <div class="data-row" style="font-size:10px;">
                            <span class="label">机构动向</span>
                            <span class="value">
                                <span id="adv-institution-trend">--</span>
                            </span>
                        </div>
                        
                        <!-- Market Sentiment -->
                        <div class="data-row" style="font-size:10px; margin-top:3px;">
                            <span class="label">😊 市场情绪</span>
                            <span class="value">
                                <span id="adv-sentiment-score">--</span>
                                <span id="adv-sentiment-level" style="margin-left:5px; font-size:9px;"></span>
                            </span>
                        </div>
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
                        <span>Finnhub Key:</span>
                        <input type="password" id="set-finnhub-key" placeholder="免费注册: finnhub.io/register" autocomplete="off">
                        <small style="display:block; color:#888; font-size:9px; margin-top:2px;">获取分析师评级和机构持股数据</small>
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
            
            <!-- Side Watchlist Panel -->
            <div id="side-watchlist-panel" class="side-watchlist-panel">
                <div class="side-wl-header">
                    <span class="side-wl-title">📋 Watchlist</span>
                    <button class="icon-btn" id="toggle-side-wl">_</button>
                </div>
                <div id="mini-watchlist" class="mini-watchlist" style="color:#666; text-align:center;">
                    Loading Watchlist...
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
        document.getElementById("set-finnhub-key").value = this.apiKeys.finnhubKey || "";
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
        
        // Advanced Data Toggle
        document.getElementById("advanced-data-toggle").onclick = () => this.toggleAdvancedData();
        
        // Advanced Data Refresh Button (prevent event bubbling)
        document.getElementById("btn-refresh-advanced").onclick = (e) => {
            e.stopPropagation(); // 防止触发toggle
            this.updateAdvancedDataPeriodically();
        };
        
        // Side Watchlist Toggle
        document.getElementById("toggle-side-wl").onclick = () => this.toggleSideWatchlist();
        
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

    toggleAdvancedData() {
        const content = document.getElementById("advanced-data-content");
        const icon = document.getElementById("advanced-toggle-icon");
        if (content.style.display === "none") {
            content.style.display = "block";
            icon.innerText = "▼ 收起";
        } else {
            content.style.display = "none";
            icon.innerText = "▶ 点击展开";
        }
    }

    toggleSideWatchlist() {
        const panel = document.getElementById("side-watchlist-panel");
        const wlContent = document.getElementById("mini-watchlist");
        if (wlContent.style.display === "none") {
            wlContent.style.display = "block";
            panel.style.width = "200px";
        } else {
            wlContent.style.display = "none";
            panel.style.width = "40px";
        }
    }

    // Update macro ribbon with real-time data
    updateMacroRibbon() {
        if (!this.macroCache) return;
        
        const { spx, vix, regime } = this.macroCache;
        
        // Update market section
        const marketEl = document.getElementById("macro-market");
        if (marketEl && spx) {
            const color = spx.changePct > 0 ? '#4caf50' : spx.changePct < 0 ? '#f44336' : '#aaa';
            marketEl.innerHTML = `<span style="color:${color}">📊 S&P ${spx.fmt}</span>`;
        }
        
        // Update VIX section
        const vixEl = document.getElementById("macro-vix");
        if (vixEl) {
            let color = '#4caf50';
            let icon = '✅';
            if (vix > 30) { color = '#ff5252'; icon = '🔥'; }
            else if (vix > 20) { color = '#ff9800'; icon = '⚠️'; }
            vixEl.innerHTML = `<span style="color:${color}">${icon} VIX ${vix.toFixed(1)}</span>`;
        }
    }

    // Update advanced data section
    updateAdvancedData(detailedQuote, optionsData, analystRatings, institutionalData, sentiment) {
        console.log("🖼️ 更新高级数据UI", {
            detailedQuote: !!detailedQuote,
            optionsData: !!optionsData,
            analystRatings: !!analystRatings,
            institutionalData: !!institutionalData,
            sentiment: !!sentiment
        });
        
        // 隐藏加载提示
        const loadingEl = document.getElementById("advanced-loading");
        if (loadingEl) loadingEl.style.display = "none";
        
        // Volume Analysis
        const volEl = document.getElementById("adv-volume");
        const volRatioEl = document.getElementById("adv-volume-ratio");
        const volSignal = document.getElementById("adv-volume-signal");
        
        if (detailedQuote && volEl && volRatioEl && volSignal) {
            volEl.innerText = this.formatVolume(detailedQuote.volume);
            volRatioEl.innerText = detailedQuote.volumeRatio + "x";
            
            const volRatio = parseFloat(detailedQuote.volumeRatio);
            if (volRatio > 1.5) {
                volSignal.innerText = "放量📈";
                volSignal.style.color = "#4caf50";
            } else if (volRatio < 0.7) {
                volSignal.innerText = "缩量📉";
                volSignal.style.color = "#f44336";
            } else {
                volSignal.innerText = "正常";
                volSignal.style.color = "#aaa";
            }
            
            // 52 Week Position
            const pos52wEl = document.getElementById("adv-52w-position");
            const range52wEl = document.getElementById("adv-52w-range");
            const signal52w = document.getElementById("adv-52w-signal");
            
            if (pos52wEl) pos52wEl.innerText = detailedQuote.fiftyTwoWeekPosition + "%";
            if (range52wEl) range52wEl.innerText = detailedQuote.fiftyTwoWeekRange;
            
            if (signal52w && detailedQuote.fiftyTwoWeekPosition !== "N/A") {
                const pos52w = parseFloat(detailedQuote.fiftyTwoWeekPosition);
                if (pos52w > 80) {
                    signal52w.innerText = "高位⚠️";
                    signal52w.style.color = "#ff9800";
                } else if (pos52w < 20) {
                    signal52w.innerText = "低位✅";
                    signal52w.style.color = "#4caf50";
                } else {
                    signal52w.innerText = "中间";
                    signal52w.style.color = "#aaa";
                }
            }
        } else if (!detailedQuote) {
            // 数据获取失败，显示错误信息
            if (volEl) volEl.innerText = "获取失败";
            if (volRatioEl) volRatioEl.innerText = "N/A";
            if (volSignal) volSignal.innerText = "";
            
            const pos52wEl = document.getElementById("adv-52w-position");
            const range52wEl = document.getElementById("adv-52w-range");
            const signal52w = document.getElementById("adv-52w-signal");
            if (pos52wEl) pos52wEl.innerText = "N/A";
            if (range52wEl) range52wEl.innerText = "获取失败";
            if (signal52w) signal52w.innerText = "";
            
            console.warn("⚠️ detailedQuote为空，已显示错误信息");
        }
        
        // Options Data
        const pcRatioEl = document.getElementById("adv-pc-ratio");
        const pcSignal = document.getElementById("adv-pc-signal");
        const ivEl = document.getElementById("adv-iv");
        const ivSignal = document.getElementById("adv-iv-signal");
        
        if (optionsData && pcRatioEl && ivEl) {
            pcRatioEl.innerText = optionsData.pcRatio;
            if (pcSignal) {
                pcSignal.innerText = `(${optionsData.pcRatioSentiment})`;
                pcSignal.style.color = optionsData.pcRatioSentiment === "看涨" ? "#4caf50" : 
                                       optionsData.pcRatioSentiment === "看空" ? "#f44336" : "#aaa";
            }
            
            ivEl.innerText = optionsData.impliedVolatility + "%";
            if (ivSignal) {
                ivSignal.innerText = `(${optionsData.ivLevel})`;
                ivSignal.style.color = parseFloat(optionsData.impliedVolatility) > 40 ? "#ff9800" : "#aaa";
            }
            
            // Update macro ribbon options section
            const optionsEl = document.getElementById("macro-options");
            if (optionsEl) {
                const color = optionsData.pcRatioSentiment === "看涨" ? '#4caf50' : 
                             optionsData.pcRatioSentiment === "看空" ? '#f44336' : '#aaa';
                optionsEl.innerHTML = `<span style="color:${color}">🎲 P/C ${optionsData.pcRatio}</span>`;
            }
        } else if (!optionsData) {
            if (pcRatioEl) pcRatioEl.innerText = "N/A";
            if (pcSignal) pcSignal.innerText = "";
            if (ivEl) ivEl.innerText = "N/A";
            if (ivSignal) ivSignal.innerText = "";
            console.warn("⚠️ optionsData为空");
        }
        
        // Analyst Ratings
        const analystEl = document.getElementById("adv-analyst");
        const analystCountEl = document.getElementById("adv-analyst-count");
        const targetPriceEl = document.getElementById("adv-target-price");
        const upsideEl = document.getElementById("adv-upside");
        
        if (analystRatings && analystEl) {
            analystEl.innerText = analystRatings.consensus;
            if (analystCountEl) analystCountEl.innerText = `(${analystRatings.totalAnalysts}家)`;
            if (targetPriceEl) targetPriceEl.innerText = `$${analystRatings.targetMean.toFixed(2)}`;
            
            if (upsideEl && analystRatings.upside !== "N/A") {
                upsideEl.innerText = `(${analystRatings.upside}%)`;
                upsideEl.style.color = parseFloat(analystRatings.upside) > 0 ? "#4caf50" : "#f44336";
            }
        } else if (!analystRatings) {
            if (analystEl) analystEl.innerText = "N/A";
            if (analystCountEl) analystCountEl.innerText = "";
            if (targetPriceEl) targetPriceEl.innerText = "N/A";
            if (upsideEl) upsideEl.innerText = "";
            console.warn("⚠️ analystRatings为空");
        }
        
        // Institutional Data
        const institutionEl = document.getElementById("adv-institution");
        const trendEl = document.getElementById("adv-institution-trend");
        
        if (institutionalData && institutionEl) {
            institutionEl.innerText = institutionalData.institutionOwnership;
            if (trendEl) {
                trendEl.innerText = institutionalData.institutionalTrend;
                trendEl.style.color = institutionalData.institutionalTrend.includes("增持") ? "#4caf50" : 
                                      institutionalData.institutionalTrend.includes("减持") ? "#f44336" : "#aaa";
            }
        } else if (!institutionalData) {
            if (institutionEl) institutionEl.innerText = "N/A";
            if (trendEl) trendEl.innerText = "";
            console.warn("⚠️ institutionalData为空");
        }
        
        // Market Sentiment
        const sentimentScoreEl = document.getElementById("adv-sentiment-score");
        const levelEl = document.getElementById("adv-sentiment-level");
        
        if (sentiment && sentimentScoreEl) {
            sentimentScoreEl.innerText = sentiment.score + "/100";
            if (levelEl) {
                levelEl.innerText = `(${sentiment.level})`;
                const score = parseFloat(sentiment.score);
                levelEl.style.color = score > 70 ? "#ff9800" : score < 30 ? "#4caf50" : "#aaa";
            }
            
            // Update macro ribbon sentiment section
            const sentimentEl = document.getElementById("macro-sentiment");
            if (sentimentEl) {
                let icon = '😐';
                let color = '#aaa';
                if (sentiment.level.includes("极度乐观")) { icon = '🔥'; color = '#ff9800'; }
                else if (sentiment.level.includes("乐观")) { icon = '😊'; color = '#4caf50'; }
                else if (sentiment.level.includes("极度悲观")) { icon = '❄️'; color = '#4fc3f7'; }
                else if (sentiment.level.includes("悲观")) { icon = '😔'; color = '#64b5f6'; }
                sentimentEl.innerHTML = `<span style="color:${color}">${icon} ${sentiment.score}/100</span>`;
            }
        } else if (!sentiment) {
            if (sentimentScoreEl) sentimentScoreEl.innerText = "N/A";
            if (levelEl) levelEl.innerText = "";
            console.warn("⚠️ sentiment为空");
        }
        
        console.log("✅ UI更新完成");
    }

    startMonitoring() {
        this.checkInterval = setInterval(() => {
            this.updateData();
        }, 800); // Faster polling for pro feel
        
        // 周期性更新高级数据 (每60秒)
        this.advancedDataInterval = setInterval(() => {
            this.updateAdvancedDataPeriodically();
        }, 60000); // 每分钟更新一次
        
        // 首次立即更新高级数据
        setTimeout(() => this.updateAdvancedDataPeriodically(), 3000);
    }

    async updateAdvancedDataPeriodically() {
        const symbol = this.state.symbol;
        if (!symbol || symbol === "DETECTED" || symbol === "扫描中...") {
            console.log("⏳ 等待symbol识别...", symbol);
            // 显示在UI上
            const loadingEl = document.getElementById("advanced-loading");
            if (loadingEl) {
                loadingEl.style.display = "block";
                loadingEl.innerHTML = `⏳ 等待股票识别...<br/><span style="font-size:9px;">(当前: ${symbol})</span>`;
            }
            return;
        }
        
        console.log("🔄 开始更新高级数据:", symbol);
        
        // 显示加载中
        const loadingEl = document.getElementById("advanced-loading");
        if (loadingEl) {
            loadingEl.style.display = "block";
            loadingEl.innerHTML = `⏳ 正在加载 ${symbol} 数据...<br/><span style="font-size:9px;">(预计3-5秒)</span>`;
        }
        
        try {
            // 获取所有高级数据（独立处理，失败不影响其他）
            let detailedQuote = null;
            let optionsData = null;
            let analystRatings = null;
            let institutionalData = null;
            let sentiment = null;
            
            const errors = [];
            
            try {
                console.log("📊 正在获取详细报价...");
                detailedQuote = await this.fetchDetailedQuote(symbol);
                console.log("📊 详细报价:", detailedQuote ? "✅ 成功" : "⚠️ 返回null");
                if (detailedQuote) {
                    console.log("   - 成交量:", detailedQuote.volume);
                    console.log("   - 量比:", detailedQuote.volumeRatio);
                    console.log("   - 52周位置:", detailedQuote.fiftyTwoWeekPosition);
                }
            } catch (e) {
                console.error("❌ 详细报价失败:", e);
                errors.push(`成交量: ${e.message}`);
            }
            
            try {
                console.log("🎲 正在获取期权数据...");
                optionsData = await this.fetchOptionsData(symbol);
                console.log("🎲 期权数据:", optionsData ? "✅ 成功" : "⚠️ 返回null");
                if (optionsData) {
                    console.log("   - P/C比率:", optionsData.pcRatio);
                    console.log("   - 隐含波动率:", optionsData.impliedVolatility);
                }
            } catch (e) {
                console.error("❌ 期权数据失败:", e);
                errors.push(`期权: ${e.message}`);
            }
            
            try {
                console.log("👔 正在获取分析师评级...");
                analystRatings = await this.fetchAnalystRatings(symbol);
                console.log("👔 分析师评级:", analystRatings ? "✅ 成功" : "⚠️ 返回null");
                if (analystRatings) {
                    console.log("   - 共识:", analystRatings.consensus);
                    console.log("   - 目标价:", analystRatings.targetMean);
                }
            } catch (e) {
                console.error("❌ 分析师评级失败:", e);
                errors.push(`分析师: ${e.message}`);
            }
            
            try {
                console.log("🏦 正在获取机构持股...");
                institutionalData = await this.fetchInstitutionalData(symbol);
                console.log("🏦 机构持股:", institutionalData ? "✅ 成功" : "⚠️ 返回null");
                if (institutionalData) {
                    console.log("   - 持股比例:", institutionalData.institutionOwnership);
                    console.log("   - 趋势:", institutionalData.institutionalTrend);
                }
            } catch (e) {
                console.error("❌ 机构持股失败:", e);
                errors.push(`机构: ${e.message}`);
            }
            
            try {
                console.log("😊 正在计算市场情绪...");
                sentiment = await this.calculateMarketSentiment(symbol, detailedQuote);
                console.log("😊 市场情绪:", sentiment ? "✅ 成功" : "⚠️ 返回null");
                if (sentiment) {
                    console.log("   - 分值:", sentiment.score);
                    console.log("   - 等级:", sentiment.level);
                }
            } catch (e) {
                console.error("❌ 市场情绪失败:", e);
                errors.push(`情绪: ${e.message}`);
            }
            
            // 显示错误信息在加载提示中
            if (errors.length > 0 && loadingEl) {
                const errorMsg = errors.slice(0, 3).join("<br/>");
                loadingEl.innerHTML = `⚠️ 部分数据获取失败<br/><span style="font-size:8px; color:#f44336;">${errorMsg}</span>`;
                setTimeout(() => {
                    if (loadingEl) loadingEl.style.display = "none";
                }, 5000);
            }
            
            // 更新UI（即使部分数据为null也更新）
            this.updateMacroRibbon();
            this.updateAdvancedData(detailedQuote, optionsData, analystRatings, institutionalData, sentiment);
            
            console.log("✅ 高级数据UI已更新:", symbol);
        } catch (error) {
            console.error("❌ 高级数据更新失败:", error);
            const loadingEl = document.getElementById("advanced-loading");
            if (loadingEl) {
                loadingEl.style.display = "block";
                loadingEl.innerHTML = `❌ 加载失败<br/><span style="font-size:9px; color:#f44336;">${error.message}</span>`;
            }
        }
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

        // Kick off remote quote refresh (non-blocking)
        const cache = this.remoteQuoteCache[symbol];
        const needsRefresh = !cache || (now - cache.ts) > 20000;
        const isNewSymbol = symbol !== this.state.symbol;
        
        if (symbol !== "DETECTED" && (needsRefresh || isNewSymbol)) {
            // 立即获取新 symbol 的日内数据
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
            
            // 立即更新高级数据（symbol切换时）
            if (symbol !== "DETECTED") {
                setTimeout(() => this.updateAdvancedDataPeriodically(), 1000);
            }
        } else {
            // 优先使用 Yahoo API 的真实日内高低点
            const remote = this.remoteQuoteCache[symbol];
            if (remote && remote.dayHigh && remote.dayLow && (now - remote.ts) < 30000) {
                // 使用远程数据的真实日内高低点
                this.state.sessionHigh = remote.dayHigh;
                this.state.sessionLow = remote.dayLow;
            } else {
                // 回退到本地观察的高低点（仅在无远程数据时）
                this.state.sessionHigh = Math.max(this.state.sessionHigh, price);
                this.state.sessionLow = Math.min(this.state.sessionLow, price);
            }
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
            
            // 计算趋势箭头 (with defensive check)
            let rsiTrend = "";
            if (typeof this.calculateIndicatorTrend === 'function') {
                rsiTrend = this.calculateIndicatorTrend('rsi', rsi);
            }
            if (rsiEl) rsiEl.innerText = `${rsi.toFixed(2)} ${rsiTrend}`;
            
            const rsiSignal = document.getElementById("assist-rsi-signal");
            if (rsiSignal) {
                if (rsi < 30) {
                    rsiSignal.innerText = "超卖";
                    rsiSignal.style.color = "#4caf50";
                    // 检查是否需要推送通知
                    this.checkTradingSignalNotification("RSI超卖", `${this.state.symbol} RSI=${rsi.toFixed(1)}, 可能反弹机会`, "low");
                } else if (rsi > 70) {
                    rsiSignal.innerText = "超买";
                    rsiSignal.style.color = "#f44336";
                    this.checkTradingSignalNotification("RSI超买", `${this.state.symbol} RSI=${rsi.toFixed(1)}, 可能回调风险`, "high");
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
            
            // 计算趋势箭头 (with defensive check)
            let macdTrend = "";
            if (typeof this.calculateIndicatorTrend === 'function') {
                macdTrend = this.calculateIndicatorTrend('macd', macd.histogram);
            }
            if (macdEl) macdEl.innerText = `${macd.histogram.toFixed(3)} ${macdTrend}`;
            
            const macdSignal = document.getElementById("assist-macd-signal");
            if (macdSignal) {
                if (macd.histogram > 0 && macd.prev < 0) {
                    macdSignal.innerText = "金叉";
                    macdSignal.style.color = "#4caf50";
                    this.checkTradingSignalNotification("MACD金叉", `${this.state.symbol} 出现金叉信号，看涨`, "low");
                } else if (macd.histogram < 0 && macd.prev > 0) {
                    macdSignal.innerText = "死叉";
                    macdSignal.style.color = "#f44336";
                    this.checkTradingSignalNotification("MACD死叉", `${this.state.symbol} 出现死叉信号，看跌`, "high");
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
                // 🚨 根据大盘环境调整止损倍数
                const spyChange = this.state.spyChange || 0;
                let atrMultiplier = 2.0;  // 默认2倍ATR
                let stopNote = "";
                
                if (spyChange <= -2) {
                    // 大盘暴跌>2%: 建议清仓观望
                    stopNote = " 🔴建议清仓";
                    stopEl.style.color = "#f44336";
                    stopEl.style.fontWeight = "bold";
                } else if (spyChange <= -1) {
                    // 大盘跌>1%: 止损扩大至3倍ATR
                    atrMultiplier = 3.0;
                    stopNote = " ⚠️(3×ATR 大盘弱)";
                    stopEl.style.color = "#ff9800";
                } else {
                    // 正常情况: 2倍ATR
                    stopNote = "";
                    stopEl.style.color = "#4caf50";
                }
                
                const stopLoss = price - (atr * atrMultiplier);
                stopEl.innerText = stopLoss.toFixed(2) + stopNote;
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

            // 3. 综合做T信号（结合位置 + RSI + 波动率 + 🚨大盘过滤）
            const rsi = this.state.history.length >= 14 ? this.calculateRSI(this.state.history, 14) : 50;
            const volEl = document.getElementById("assist-vol");
            const vol = volEl ? parseFloat(volEl.innerText) || 0 : 0;
            
            // 🚨 获取大盘环境
            const spyChange = this.state.spyChange || 0;
            
            let daytSignal = "⚖️观望";
            let daytColor = "#9e9e9e";
            
            // 判断是否有做T空间（区间至少 1.5%）
            const hasSpace = rangePercent >= 1.5;
            
            if (!hasSpace) {
                daytSignal = "🔒窄幅震荡";
                daytColor = "#555";
            } else if (positionInRange >= 75 && rsi > 60) {
                // 高位 + RSI偏高 = 卖出做T
                // 🟢 大盘涨>1%时谨慎高抛(可能错过更大涨幅)
                if (spyChange >= 1) {
                    daytSignal = "📉谨慎高抛";
                    daytColor = "#ff9800";  // 橙色警告
                } else {
                    daytSignal = "📉高抛";
                    daytColor = "#f44336";
                }
            } else if (positionInRange >= 65 && rsi > 65) {
                // 偏高 + RSI超买 = 减仓
                if (spyChange >= 1) {
                    daytSignal = "📤谨慎减仓";
                    daytColor = "#ff9800";
                } else {
                    daytSignal = "📤减仓";
                    daytColor = "#ff5722";
                }
            } else if (positionInRange <= 25 && rsi < 40) {
                // 低位 + RSI偏低 = 买入做T
                // 🔴 大盘跌>1%时禁止低吸(易接飞刀)
                if (spyChange <= -1) {
                    daytSignal = "🚫禁止低吸";
                    daytColor = "#9e9e9e";  // 灰色禁止
                } else if (spyChange <= -0.5) {
                    daytSignal = "⚠️谨慎低吸";
                    daytColor = "#ff9800";  // 橙色警告
                } else {
                    daytSignal = "📥低吸";
                    daytColor = "#4caf50";
                }
            } else if (positionInRange <= 35 && rsi < 45) {
                // 偏低 + RSI适中 = 加仓
                if (spyChange <= -1) {
                    daytSignal = "🚫禁止加仓";
                    daytColor = "#9e9e9e";
                } else if (spyChange <= -0.5) {
                    daytSignal = "⚠️谨慎加仓";
                    daytColor = "#ff9800";
                } else {
                    daytSignal = "✅加仓";
                    daytColor = "#66bb6a";
                }
            } else if (vol > 0.5 && positionInRange < 50) {
                // 波动率大 + 低位 = 收筹
                if (spyChange <= -1) {
                    daytSignal = "�禁止收筹";
                    daytColor = "#9e9e9e";
                } else if (spyChange <= -0.5) {
                    daytSignal = "⚠️谨慎收筹";
                    daytColor = "#ff9800";
                } else {
                    daytSignal = "�📥收筹";
                    daytColor = "#4caf50";
                }
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

            // 提取真实的日内高低点（开盘后到现在的区间）
            let dayHigh = meta.regularMarketDayHigh;
            let dayLow = meta.regularMarketDayLow;
            
            // 如果是盘前/盘后，使用前一交易日的高低点作为参考
            if (!dayHigh || !dayLow) {
                dayHigh = meta.previousClose || price;
                dayLow = meta.previousClose || price;
            }

            if (price != null) {
                this.remoteQuoteCache[symbol] = {
                    price: parseFloat(price),
                    session,
                    marketState: meta.marketState || session,
                    dayHigh: parseFloat(dayHigh) || price,
                    dayLow: parseFloat(dayLow) || price,
                    previousClose: parseFloat(meta.previousClose) || price,
                    ts: Date.now()
                };
                
                console.log(`📊 Remote Quote for ${symbol}: Price=${price}, DayHigh=${dayHigh}, DayLow=${dayLow}, Session=${session}`);
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
            this.updateAiPopup("Initiating AI Analysis...<br/>Fetching Comprehensive Market Data...", ctx.symbol, true);
            
            // 1. Fetch all data in parallel for maximum efficiency
            const [newsHeadlines, detailedQuote, optionsData, analystRatings, institutionalData] = await Promise.all([
                this.fetchMarketNews(ctx.symbol),
                this.fetchDetailedQuote(ctx.symbol),
                this.fetchOptionsData(ctx.symbol),
                this.fetchAnalystRatings(ctx.symbol),
                this.fetchInstitutionalData(ctx.symbol)
            ]);
            const newsText = newsHeadlines.length > 0 ? newsHeadlines.join("; ") : "暂无重磅新闻";
            const portfolioText = this.getPortfolioSummary();
            
            // 获取板块对比数据和市场情绪
            let sectorComparison = null;
            let sentiment = null;
            if (detailedQuote?.sector) {
                sectorComparison = await this.fetchSectorComparison(detailedQuote.sector);
            }
            sentiment = await this.calculateMarketSentiment(ctx.symbol, detailedQuote);
            
            // Update UI with fetched data
            this.updateMacroRibbon();
            this.updateAdvancedData(detailedQuote, optionsData, analystRatings, institutionalData, sentiment);
            
            // 提取当前标的的持仓状态
            let currentPositionStatus = "无持仓";
            if (ctx.position) {
                const { shares, avgPrice } = ctx.position;
                const currentPrice = ctx.price;
                const pnlPct = ((currentPrice - avgPrice) / avgPrice * 100).toFixed(2);
                const pnlStatus = pnlPct > 0 ? "📈浮盈" : "📉浮亏";
                currentPositionStatus = `持有 ${shares} 股，成本价 $${avgPrice}，当前 ${pnlStatus} ${Math.abs(pnlPct)}%`;
            }

            // 2. Build Enhanced Prompt (Aggressive Context Injection)
            // 构建大盘状态评估
            let marketAssessment = "大盘数据加载中...";
            let tradingRisk = "中等";
            if (this.macroCache) {
                const { spx, dow, nasdaq, vix } = this.macroCache;
                const parts = [];
                if (spx) parts.push(`标普 ${spx.fmt}`);
                if (dow) parts.push(`道琼斯 ${dow.fmt}`);
                if (nasdaq) parts.push(`纳斯达克 ${nasdaq.fmt}`);
                marketAssessment = parts.join(" | ");
                
                // 评估做T风险
                const avgChange = [spx?.changePct, dow?.changePct, nasdaq?.changePct]
                    .filter(v => v != null)
                    .reduce((sum, v) => sum + v, 0) / 3;
                
                if (avgChange < -1.5) {
                    tradingRisk = "高风险：大盘重挫，做T容易被套，建议观望或轻仓试探";
                } else if (avgChange < -0.5) {
                    tradingRisk = "中高风险：大盘承压，做T需严格止损，仓位控制在30%以内";
                } else if (avgChange > 1) {
                    tradingRisk = "低风险：大盘强势，适合做T，可适当放大仓位";
                } else {
                    tradingRisk = "中等风险：大盘横盘，适合区间高抛低吸";
                }
            }
            
            const prompt = `
                身份：华尔街资深对冲基金经理 (Macro-driven Technical Trader + 日内做T专家)。
                任务：这不仅是分析，而是针对我（用户）账户的实战操作建议。
                
                ⚠️【当前持仓状态 - 最高优先级】⚠️
                标的：${ctx.symbol}
                持仓：${currentPositionStatus}
                ${ctx.position ? `
                ⚡ 你必须针对用户的持仓状态给出具体建议：
                • 如果浮盈：考虑是否止盈、加仓、还是持有等待更高目标
                • 如果浮亏：评估是否止损、补仓摊平、还是等待反弹
                • 结合大盘环境和技术指标，给出明确的仓位管理建议` : '⚡ 用户未持仓，给出建仓时机和仓位建议'}
                
                【核心原则】
                1. **持仓管理优先**：如果有持仓，必须把持仓风险管理放在第一位！
                2. **宏观风控**：若 VIX > 25，禁止推荐激进买入。
                3. **做T风险评估（权重20%）**：必须结合大盘状态判断做T操作的可行性和风险等级。
                4. **技术指标验证（权重20%）**：结合RSI超买超卖、MACD金叉死叉、日内区间位置综合判断。
                5. **量价关系分析（权重15%）**：放量突破可信，缩量上涨警惕，量价背离是反转信号。
                6. **历史价位参考（权重10%）**：接近52周高点需谨慎，接近52周低点寻机会，Beta高需控仓。
                7. **板块强弱对比（权重8%）**：个股强于板块优先买入，弱于板块优先减仓。
                8. **期权市场信号（权重10%）**：P/C比率、隐含波动率、大额期权流入/流出指示专业资金动向。
                9. **机构与内部交易（权重8%）**：机构增减持、内部人交易揭示聪明钱行为。
                10. **分析师评级（权重5%）**：华尔街共识和目标价提供参考，但不可盲目跟从。
                11. **市场情绪指标（权重4%）**：情绪极值往往是反转信号。
                12. **交易时段风控**：盘前/盘后流动性差，点差大，建议降低仓位或观望；盘中交易风险相对可控。
                
                【大盘状态评估】（日内交易第一优先级，权重50%）⚠️ 散户必看
                三大指数表现：${marketAssessment}
                VIX恐慌指数：${this.macroCache ? this.macroCache.vix.toFixed(2) : "--"} (${this.macroCache ? this.macroCache.regime : "--"})
                做T风险评级：${tradingRisk}
                
                🚨 散户日内铁律（大盘为王）：
                • 大盘跌>1%：🔴 禁止做多！日内90%个股跟跌，抄底=接飞刀
                • 大盘跌0.5-1%：⚠️ 高度警惕，仅持股轻仓T，禁止新开仓
                • 大盘横盘±0.5%：➡️ 中性环境，适合区间高抛低吸，止损2%
                • 大盘涨0.5-1%：🟢 低风险，可做T，追涨龙头股
                • 大盘涨>1%：🟢🟢 最佳时机，放心追涨，但注意止盈
                
                ⚠️ 日内做T风险提示：
                • 开盘跳水不追多：容易被套，等反弹确认
                • 尾盘拉升不追涨：T+0无法止损，次日或跳空
                • 放量滞涨=出货：主力诱多，果断减仓
                • 逆大盘个股需谨慎：必须有独立催化剂(财报/新闻)
                
                【宏观环境】
                ${this.macroCache ? this.macroCache.summary : "Pending"}
                
                【用户持仓参考 (务必阅读)】
                ${portfolioText}

                【标的实时数据】
                Symbol: ${ctx.symbol}
                Price: ${ctx.price} (Change: ${ctx.change.toFixed(2)})
                Volatility: ${ctx.volatility}
                PnL: ${ctx.position ? ctx.pnlPercentage.toFixed(2) + "%" : "FLAT"}
                Session: ${ctx.session} ${ctx.session === 'PRE' ? '(盘前-流动性低)' : ctx.session === 'POST' ? '(盘后-流动性低)' : ctx.session === 'CLOSED' ? '(休市)' : '(盘中交易)'}
                Trigger: ${autoTriggerReason || "Manual Check"}
                
                【技术指标】(关键做T参考)
                RSI(14): ${document.getElementById("assist-rsi")?.innerText || "计算中"} ${document.getElementById("assist-rsi-signal")?.innerText ? `(${document.getElementById("assist-rsi-signal").innerText})` : ''}
                MACD: ${document.getElementById("assist-macd")?.innerText || "计算中"} ${document.getElementById("assist-macd-signal")?.innerText ? `(${document.getElementById("assist-macd-signal").innerText})` : ''}
                ATR(14): ${document.getElementById("assist-atr")?.innerText || "计算中"}
                动态止损位: $${document.getElementById("assist-stop")?.innerText || "计算中"}
                
                【日内做T分析】(核心决策依据)
                日内区间: ${document.getElementById("assist-intraday-range")?.innerText || "监控中"}
                当前位置: ${document.getElementById("assist-range-position")?.innerText || "--"} ${document.getElementById("assist-range-signal")?.innerText ? `(${document.getElementById("assist-range-signal").innerText})` : ''}
                做T建议: ${document.getElementById("assist-dayt-signal")?.innerText || "⏳监控中"}
                
                ⚡ 做T操作关键提示：
                • RSI<30且日内低位 → 强烈低吸信号
                • RSI>70且日内高位 → 强烈高抛信号
                • MACD金叉+低位 → 可建仓或加仓
                • MACD死叉+高位 → 应减仓或止盈
                • ATR过大(>3.0) → 波动剧烈，控制仓位
                
                ${detailedQuote ? `【成交量分析】(资金流向判断)
                当前成交量: ${this.formatVolume(detailedQuote.volume)}
                日均成交量: ${this.formatVolume(detailedQuote.avgVolume)}
                量比: ${detailedQuote.volumeRatio}x ${parseFloat(detailedQuote.volumeRatio) > 1.5 ? '(放量📈)' : parseFloat(detailedQuote.volumeRatio) < 0.7 ? '(缩量📉)' : '(正常)'}
                
                ⚡ 量价关系提示：
                • 放量上涨(量比>1.5且价涨) → 资金流入，趋势强劲
                • 放量下跌(量比>1.5且价跌) → 恐慌性抛售，警惕
                • 缩量上涨(量比<0.7且价涨) → 上涨乏力，可能回调
                • 缩量下跌(量比<0.7且价跌) → 下跌动能弱，可能见底
                
                【历史关键价位】(支撑阻力参考)
                52周区间: ${detailedQuote.fiftyTwoWeekRange}
                当前位置: ${detailedQuote.fiftyTwoWeekPosition}% ${parseFloat(detailedQuote.fiftyTwoWeekPosition) > 80 ? '(接近年度高位⚠️)' : parseFloat(detailedQuote.fiftyTwoWeekPosition) < 20 ? '(接近年度低位✅)' : '(中间区域)'}
                52周高点: $${detailedQuote.fiftyTwoWeekHigh.toFixed(2)} (强阻力位)
                52周低点: $${detailedQuote.fiftyTwoWeekLow.toFixed(2)} (强支撑位)
                
                ⚡ 历史价位提示：
                • 当前价接近52周高点(>90%) → 突破需放量确认，否则高位回调风险大
                • 当前价接近52周低点(<10%) → 超跌反弹机会，但需确认止跌信号
                • Beta系数: ${detailedQuote.beta.toFixed(2)} ${detailedQuote.beta > 1.2 ? '(高波动)' : detailedQuote.beta < 0.8 ? '(低波动)' : '(正常)'}
                
                【行业板块对比】(相对强弱判断)
                所属行业: ${detailedQuote.industry}
                所属板块: ${detailedQuote.sector}
                ${sectorComparison ? `板块ETF表现: ${sectorComparison.fmt}
                相对强度: ${ctx.change > 0 && sectorComparison.changePct > 0 ? '与板块同涨📈' : ctx.change < 0 && sectorComparison.changePct < 0 ? '与板块同跌📉' : ctx.change > 0 && sectorComparison.changePct < 0 ? '逆势上涨💪(强于板块)' : '逆势下跌⚠️(弱于板块)'}` : '板块数据获取中...'}
                
                ⚡ 板块轮动提示：
                • 个股强于板块 → 相对强势，可重点关注
                • 个股弱于板块 → 相对疲弱，规避或减仓
                • 板块整体走强 → 行业景气度上升，可增加配置
                • 板块整体走弱 → 行业面临压力，降低配置
                ` : ''}
                
                ${optionsData ? `【期权市场信号】(专业资金动向)
                看涨/看跌比率: ${optionsData.pcRatio} (${optionsData.pcRatioSentiment})
                隐含波动率: ${optionsData.impliedVolatility}% (${optionsData.ivLevel})
                期权流入: ${optionsData.optionFlow}
                看涨成交量: ${optionsData.callVolume} | 看跌成交量: ${optionsData.putVolume}
                最近到期: ${optionsData.expirationDate}
                
                ⚡ 期权信号解读：
                • P/C比率>1.2 → 市场偏空，看跌期权需求大，警惕下跌
                • P/C比率<0.8 → 市场偏多，看涨期权需求大，谨防过热
                • IV>40% → 市场预期大波动，可能有重大事件
                • 大额看涨流入 → 机构做多，可跟随
                • 大额看跌保护 → 机构对冲风险，需谨慎
                ` : ''}
                
                ${analystRatings ? `【分析师评级】(华尔街共识)
                总分析师数: ${analystRatings.totalAnalysts}家
                评级分布: 强烈买入${analystRatings.strongBuy} | 买入${analystRatings.buy} | 持有${analystRatings.hold} | 卖出${analystRatings.sell} | 强烈卖出${analystRatings.strongSell}
                综合评级: ${analystRatings.consensus}
                目标价区间: $${analystRatings.targetLow.toFixed(2)} - $${analystRatings.targetHigh.toFixed(2)} (均值$${analystRatings.targetMean.toFixed(2)})
                上行空间: ${analystRatings.upside}%
                
                ⚡ 分析师共识提示：
                • 强烈买入>10家 且 上行空间>20% → 华尔街看好，可重点关注
                • 评级下调趋势 或 目标价调低 → 基本面转弱，需警惕
                • 上行空间<5% → 估值合理偏贵，性价比不高
                • 上行空间>30% → 可能被低估，但需确认催化剂
                ` : ''}
                
                ${institutionalData ? `【机构与内部交易】(聪明钱动向)
                机构持股比例: ${institutionalData.institutionOwnership}
                内部人持股: ${institutionalData.insiderOwnership}
                机构动向: ${institutionalData.institutionalTrend} (平均变化${institutionalData.avgInstitutionalChange})
                内部交易: ${institutionalData.insiderSentiment}
                
                ⚡ 机构动向提示：
                • 机构连续增持(>5%) → 长线资金看好，可增加配置
                • 机构连续减持(<-5%) → 机构撤离，需谨慎
                • 内部人大额买入 → 管理层对公司有信心
                • 内部人集中卖出 → 可能知道不利消息，警惕
                ` : ''}
                
                ${sentiment ? `【市场情绪指标】(综合情绪评分)
                情绪分数: ${sentiment.score}/100 (${sentiment.level})
                情绪因子: ${sentiment.factors.join(' | ')}
                建议: ${sentiment.recommendation}
                
                ⚡ 情绪极值提示：
                • 情绪>70 → 市场过于乐观，可能见顶，控制仓位
                • 情绪<30 → 市场过于悲观，可能见底，寻找机会
                • 情绪快速反转 → 趋势可能改变，密切关注
                ` : ''}
                
                【新闻】
                ${newsText}
                
                请输出 JSON 格式（不要Markdown）：
                {
                    "sentiment": 1-10的整数(1=极度恐慌, 10=极度贪婪),
                    "action": "BUY" | "SELL" | "HOLD",
                    "confidence": 0.0-1.0 (置信度),
                    "quantity_pct": 0-100 (建议仓位比例),
                    "support": 关键支撑位数字(优先考虑52周低点和日内低点),
                    "resistance": 关键阻力位数字(优先考虑52周高点和日内高点),
                    "position_advice": "针对当前持仓的具体操作建议(如有持仓必填)，必须综合考虑：①量价分析 ②历史位置 ③板块对比 ④期权信号 ⑤机构动向 ⑥分析师评级 ⑦市场情绪，例如：'持仓浮亏8%，当前：放量下跌+接近52周低点$230+弱于板块+期权P/C比1.5看空+机构减持2%+分析师目标价$240(+4%)+情绪悲观25分，综合建议：反弹至$235减半仓，跌破$225全部止损'",
                    "analysis": "120字以内的总体分析，必须综合：大盘环境20% + 技术面20% + 量价15% + 历史位置10% + 板块8% + 期权10% + 机构8% + 分析师5% + 情绪4%，给出立体化风控决策"
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
                    { 
                        role: "system", 
                        content: `你是顶级日内交易员,专注T+0快速进出(Intraday Scalping)。

【散户日内铁律】⚠️ 生存第一
• 大盘为王: 日内波动70%受大盘影响,个股技术仅30%
• 顺势而为: 大盘跌>0.5%时谨慎做多,跌>1%禁止抄底
• 快速止损: 日内最怕抗单,跌破2%立即认赔
• 避免陷阱: 开盘跳水不追/尾盘拉升不追/放量滞涨不碰

【日内交易案例库】✅ 5个成功案例 vs ❌ 5个失败陷阱

✅ 成功案例(胜率70-85%):
1. 顺大盘做T: SPY涨+1.2%,NVDA早盘+0.8%→低吸,午后+2.1%→高抛 (胜率85%)
2. 缩量回调买: TSLA连涨3天后缩量回调-1.5%,SPY横盘→轻仓买入,次日反弹+2.3% (胜率75%)
3. 放量突破追: AAPL突破180阻力位,成交量放大150%,SPY强势→果断追涨,当日+1.8% (胜率70%)
4. 大盘强势逢低吸: SPY涨+1.5%,AMD跌-0.8%无利空→抄底,收盘反弹+1.2% (胜率80%)
5. 开盘急跌抄底: SPY平开,GOOGL开盘跳水-1.5%无利空,10分钟企稳→买入,收盘+0.9% (胜率70%)

❌ 失败陷阱(亏损概率80-95%):
1. 逆盘抢反弹: SPY跌-1.8%,NVDA跌-2.5%抄底→继续跌至-4.2%,抗单被套 (失败率95%)
2. 追高被套: TSLA涨+8%追涨,买在日内高点→回调-3%,止损出局 (失败率85%)
3. 不设止损扛单: AMD日内-2.5%不止损,心想"会反弹"→收盘-4.8%,深度被套 (失败率90%)
4. 开盘跳水追多: SPY跌-0.5%,AAPL开盘跳水-2%抄底→继续跌至-3.5%,接飞刀 (失败率85%)
5. 尾盘拉升追涨: META尾盘最后10分钟拉升+2.5%追涨→次日跳空-1.8%,T+0被套 (失败率80%)

【核心能力】
• 快速识别: 支撑/阻力位、日内高低点
• 大盘联动: 个股走势必须参考SPY实时表现
• 动量捕捉: RSI背离、MACD短期信号、快速反转
• 做T时机: 大盘稳定时低吸高抛、大盘弱势时观望

【日内决策框架】(速度优先)
1. 先看大盘: SPY/QQQ跌>0.5%→提高警惕,跌>1%→暂停操作
2. 再看个股: 逆势上涨需确认独立催化剂(新闻/财报)
3. 成交量: 放量滞涨=出货,缩量上涨=谨慎,放量突破=追
4. 止损纪律: 跌2%必走,不心存幻想(日内来得及重新进)

【输出要求】(50字简洁)
• 理由格式: 先说大盘环境+个股信号+操作建议
• 点位精确: ±0.5美元
• 止损严格: 基于ATR 2-2.5倍,但大盘弱势时扩大至3倍
• 返回纯JSON` 
                    },
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
                                    {
                                        "role": "system", 
                                        "content": "你是日内交易专家。核心原则:大盘跌>0.5%谨慎,跌>1%禁止买入。理由必须先说大盘环境再说个股信号。输出:BUY/SELL/HOLD、点位±0.5$、止损2-3%ATR(大盘弱势扩大至3倍)、理由50字。返回纯JSON。"
                                    },
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
                                contents: [{ parts: [{ text: "你是日内交易专家。大盘跌>0.5%谨慎,跌>1%禁止买入。理由先说大盘再说个股。返回纯JSON(BUY/SELL/HOLD,点位±0.5$,止损2-3%ATR,理由50字含大盘环境)。" + prompt }] }]
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
            let positionAdviceHTML = "";

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
                    
                    // 收集持仓建议（只取第一个有效的）
                    if (json.position_advice && !positionAdviceHTML) {
                        positionAdviceHTML = `
                            <div style="background:#1a237e; border:2px solid #3949ab; padding:8px; margin-bottom:12px; border-radius:4px;">
                                <div style="font-size:11px; color:#90caf9; margin-bottom:4px;">💼 持仓建议</div>
                                <div style="font-size:12px; color:#fff; line-height:1.4;">${json.position_advice}</div>
                            </div>
                        `;
                    }
                    
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

            // Persist AI verdict for watchlist alignment (15m freshness window)
            this.aiDecisionCache.set(ctx.symbol, {
                action: winner,
                sentiment: parseFloat(avgSent),
                support: avgSup,
                resistance: avgRes,
                summary: `AI ${winner} | 情绪 ${avgSent}/10 | 支撑 ${avgSup} | 阻力 ${avgRes}`,
                ts: Date.now()
            });
            // Refresh watchlist immediately so displayed suggestion matches AI output
            this.updateWatchlistData();

            analysisEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong>综合评级 ${avgSent}/10</strong>
                    <strong style="color:${actionColor}; border:1px solid ${actionColor}; padding:0 4px; border-radius:3px;">${winner}</strong>
                </div>
                ${ctx.position ? `<div style="font-size:10px; color:#90caf9; margin-top:4px;">💼 ${currentPositionStatus}</div>` : ''}
            `;
            
            // Show detailed popup with position advice at top
            const finalHTML = positionAdviceHTML + commentaryHTML;
            this.updateAiPopup(finalHTML, `${ctx.symbol} AI Analysis`, false);

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
        console.log("🌐 代理请求:", url);
        return new Promise((resolve, reject) => {
            try {
                if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                    console.error("❌ Extension Context Invalid");
                    return reject(new Error("Extension Context Invalid"));
                }

                const timeout = setTimeout(() => {
                    console.error("❌ 请求超时:", url);
                    reject(new Error("Request timeout after 30s"));
                }, 30000);

                chrome.runtime.sendMessage({ action: "FETCH_DATA", url: url }, (response) => {
                    clearTimeout(timeout);
                    
                    // Check for runtime errors (e.g. background script not found)
                    if (chrome.runtime.lastError) {
                        console.error("❌ Chrome Runtime错误:", chrome.runtime.lastError.message);
                        return reject(new Error(chrome.runtime.lastError.message));
                    }
                    
                    if (response && response.success) {
                        console.log("✅ 请求成功:", url.substring(0, 50) + "...");
                        resolve(response.data);
                    } else {
                        const msg = response ? response.error : "Unknown Background Error";
                        console.error("❌ 请求失败:", url, "错误:", msg);
                        reject(new Error(msg));
                    }
                });
            } catch(e) {
                console.error("❌ ProxyFetch异常:", e);
                reject(e instanceof Error ? e : new Error(String(e)));
            }
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

    // 获取详细市场数据（成交量、52周高低、行业板块等）
    async fetchDetailedQuote(symbol) {
        // 使用缓存避免频繁请求
        const cacheKey = `detailed_${symbol}`;
        const cached = this.detailedQuoteCache?.[cacheKey];
        if (cached && Date.now() - cached.ts < 300000) { // 5分钟缓存
            console.log("📦 使用缓存的详细报价:", symbol);
            return cached.data;
        }

        try {
            console.log("📊 开始获取详细报价 (使用chart API):", symbol);
            // 改用chart API - 获取1年数据以计算52周信息
            const rawText = await this.proxyFetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1y`);
            console.log("📊 原始响应长度:", rawText?.length || 0);
            
            const data = JSON.parse(rawText);
            const result = data.chart?.result?.[0];
            if (!result || !result.meta) {
                console.warn("📊 未找到chart数据");
                return null;
            }
            
            const meta = result.meta;
            const timestamps = result.timestamp || [];
            const indicators = result.indicators?.quote?.[0];
            const volumes = indicators?.volume || [];
            const highs = indicators?.high || [];
            const lows = indicators?.low || [];
            
            // 计算平均成交量 (最近10天)
            const recentVolumes = volumes.filter(v => v != null).slice(-10);
            const avgVolume = recentVolumes.length > 0 
                ? recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length 
                : 0;
            
            // 计算52周高低点 (从历史数据中)
            const validHighs = highs.filter(h => h != null);
            const validLows = lows.filter(l => l != null);
            const fiftyTwoWeekHigh = meta.fiftyTwoWeekHigh || (validHighs.length > 0 ? Math.max(...validHighs) : 0);
            const fiftyTwoWeekLow = meta.fiftyTwoWeekLow || (validLows.length > 0 ? Math.min(...validLows) : 0);
            
            const currentPrice = meta.regularMarketPrice || meta.previousClose || 0;
            
            console.log("📊 提取的数据:", {
                volume: meta.regularMarketVolume,
                avgVolume,
                fiftyTwoWeekHigh,
                fiftyTwoWeekLow,
                currentPrice
            });

            const quoteData = {
                // 成交量数据
                volume: meta.regularMarketVolume || 0,
                avgVolume: avgVolume || 0,
                volumeRatio: meta.regularMarketVolume && avgVolume 
                    ? (meta.regularMarketVolume / avgVolume).toFixed(2) 
                    : "1.00",
                
                // 52周高低点
                fiftyTwoWeekHigh: fiftyTwoWeekHigh || 0,
                fiftyTwoWeekLow: fiftyTwoWeekLow || 0,
                fiftyTwoWeekRange: fiftyTwoWeekHigh && fiftyTwoWeekLow
                    ? `$${fiftyTwoWeekLow.toFixed(2)} - $${fiftyTwoWeekHigh.toFixed(2)}`
                    : "N/A",
                
                // 当前价格在52周区间的位置
                fiftyTwoWeekPosition: currentPrice && fiftyTwoWeekHigh && fiftyTwoWeekLow && (fiftyTwoWeekHigh > fiftyTwoWeekLow)
                    ? (((currentPrice - fiftyTwoWeekLow) / (fiftyTwoWeekHigh - fiftyTwoWeekLow)) * 100).toFixed(1)
                    : "50",
                
                // 行业板块 (chart API不提供，使用默认)
                sector: "N/A",
                industry: "N/A",
                
                // 市值 (chart API不提供)
                marketCap: 0,
                marketCapFmt: "N/A",
                
                // PE 估值 (chart API不提供)
                trailingPE: 0,
                forwardPE: 0,
                
                // Beta（相对大盘波动性，chart API不提供）
                beta: 1.0
            };

            // 缓存结果
            if (!this.detailedQuoteCache) this.detailedQuoteCache = {};
            this.detailedQuoteCache[cacheKey] = { data: quoteData, ts: Date.now() };

            return quoteData;
        } catch (e) {
            console.warn(`Failed to fetch detailed quote for ${symbol}`, e);
            return null;
        }
    }

    // 格式化市值显示
    formatMarketCap(cap) {
        if (!cap) return "N/A";
        if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
        if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
        if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`;
        return `$${cap.toFixed(0)}`;
    }

    // 格式化成交量显示
    formatVolume(vol) {
        if (!vol) return "N/A";
        if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
        if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
        if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
        return vol.toString();
    }

    // 获取板块ETF数据用于对比
    async fetchSectorComparison(sector) {
        // 板块ETF映射
        const sectorETFs = {
            "Technology": "XLK",
            "Financial Services": "XLF",
            "Healthcare": "XLV",
            "Consumer Cyclical": "XLY",
            "Consumer Defensive": "XLP",
            "Energy": "XLE",
            "Industrials": "XLI",
            "Materials": "XLB",
            "Real Estate": "XLRE",
            "Utilities": "XLU",
            "Communication Services": "XLC"
        };

        const etf = sectorETFs[sector];
        if (!etf) return null;

        return await this.fetchTickerData(etf);
    }

    // ========== Priority 3: 高级数据获取 ==========

    // 1. 期权市场数据（看涨看跌比率、隐含波动率）
    async fetchOptionsData(symbol) {
        const cacheKey = `options_${symbol}`;
        const cached = this.optionsCache?.[cacheKey];
        if (cached && Date.now() - cached.ts < 600000) { // 10分钟缓存
            return cached.data;
        }

        try {
            // 注意：Yahoo期权API需要认证，暂时返回占位数据
            console.log("🎲 期权数据API需要认证，返回默认值");
            
            // 返回默认数据避免UI显示错误
            const result = {
                pcRatio: "N/A",
                pcRatioSentiment: "数据不可用",
                impliedVolatility: "N/A",
                ivLevel: "需要更高权限",
                optionFlow: "N/A",
                expirationDate: "N/A",
                callVolume: "N/A",
                putVolume: "N/A"
            };

            if (!this.optionsCache) this.optionsCache = {};
            this.optionsCache[cacheKey] = { data: result, ts: Date.now() };

            return result;
        } catch (e) {
            console.warn(`Failed to fetch options data for ${symbol}`, e);
            return null;
        }
    }

    // 2. 分析师评级和目标价（从Yahoo Finance网页爬取）
    async fetchAnalystRatings(symbol) {
        const cacheKey = `analyst_${symbol}`;
        const cached = this.analystCache?.[cacheKey];
        if (cached && Date.now() - cached.ts < 86400000) { // 24小时缓存
            return cached.data;
        }

        try {
            console.log("👔 爬取Yahoo Finance分析师评级:", symbol);
            
            let recommendations = null;
            let priceTargets = { targetLow: 0, targetHigh: 0, targetMean: 0 };

            // helper: 解析一次HTML
            const parseOnce = (html, source) => {
                console.log(`👔 HTML预览(${source}):`, html.substring(0, 200));
                const rec = this.parseAnalystRecommendations(html);
                const pt = this.parsePriceTargets(html);
                if (rec) console.log(`👔 ✅ 成功解析推荐评级(${source}):`, rec);
                if (pt?.targetMean > 0) console.log(`👔 ✅ 成功解析目标价(${source}):`, pt);
                return { rec, pt };
            };
            
            // 方法1: analysis 页面 + p 参数
            try {
                const analysisUrl = `https://finance.yahoo.com/quote/${symbol}/analysis?p=${symbol}`;
                console.log("👔 请求页面:", analysisUrl);
                const html = await this.proxyFetch(analysisUrl);
                const { rec, pt } = parseOnce(html, "analysis");
                recommendations = rec;
                priceTargets = pt;
            } catch (e) {
                console.warn("👔 ❌ 爬取失败:", e.message);
            }

            // 方法2: quote 主页面 兜底（有时分析页被跳转到 Symbol Lookup）
            if (!recommendations || (!priceTargets || priceTargets.targetMean === 0)) {
                try {
                    const quoteUrl = `https://finance.yahoo.com/quote/${symbol}?p=${symbol}`;
                    console.log("👔 兜底请求页面:", quoteUrl);
                    const html2 = await this.proxyFetch(quoteUrl);
                    const { rec, pt } = parseOnce(html2, "quote");
                    if (!recommendations) recommendations = rec;
                    if (!priceTargets || priceTargets.targetMean === 0) priceTargets = pt;
                } catch (e) {
                    console.warn("👔 兜底请求失败:", e.message);
                }
            }
            
            // 构造结果
            const result = {
                strongBuy: recommendations?.strongBuy || 0,
                buy: recommendations?.buy || 0,
                hold: recommendations?.hold || 0,
                sell: recommendations?.sell || 0,
                strongSell: recommendations?.strongSell || 0,
                totalAnalysts: 0,
                targetLow: priceTargets.targetLow,
                targetHigh: priceTargets.targetHigh,
                targetMean: priceTargets.targetMean,
                targetMedian: 0,
                currentPrice: this.state.price || 0,
                upside: "N/A",
                consensus: "数据不可用"
            };
            
            // 计算总分析师数
            if (recommendations) {
                result.totalAnalysts = result.strongBuy + result.buy + result.hold + result.sell + result.strongSell;
            }
            
            // 计算上行空间
            if (result.targetMean && result.currentPrice) {
                result.upside = (((result.targetMean - result.currentPrice) / result.currentPrice) * 100).toFixed(1);
            }

            // 计算共识
            if (recommendations) {
                const bullish = (result.strongBuy * 2 + result.buy);
                const bearish = (result.strongSell * 2 + result.sell);
                if (bullish > bearish * 1.5) result.consensus = "强烈买入";
                else if (bullish > bearish) result.consensus = "买入";
                else if (bearish > bullish * 1.5) result.consensus = "卖出";
                else if (bearish > bullish) result.consensus = "减持";
                else result.consensus = "持有";
            } else if (result.upside !== "N/A") {
                const upsideNum = parseFloat(result.upside);
                if (upsideNum > 20) result.consensus = "买入";
                else if (upsideNum < -10) result.consensus = "卖出";
                else result.consensus = "持有";
            }

            // Only cache if we actually got some data
            if (recommendations || result.targetMean > 0) {
                if (!this.analystCache) this.analystCache = {};
                this.analystCache[cacheKey] = { data: result, ts: Date.now() };
                console.log("👔 最终分析师数据 (已缓存):", result);
            } else {
                console.warn("👔 未获取到有效数据，不缓存结果");
                console.log("👔 最终分析师数据 (未缓存):", result);
            }

            return result;
        } catch (e) {
            console.error("👔 分析师评级获取失败:", e);
            return this.getDefaultAnalystData();
        }
    }

    // 解析分析师推荐评级（HTML爬虫 + DOM解析）
    parseAnalystRecommendations(html) {
        try {
            // 调试信息：检查HTML标题确认页面正确
            const titleMatch = html.match(/<title>([^<]*)<\/title>/);
            if (titleMatch) {
                console.log("👔 页面标题:", titleMatch[1]);
                if (/Symbol Lookup/i.test(titleMatch[1])) {
                    console.warn("👔 页面是 Symbol Lookup，可能被跳转或符号无效");
                    return null;
                }
            } else {
                console.warn("👔 未找到页面标题，可能是无效HTML");
            }

            // 策略1: 直接提取 recommendationTrend 数组
            const trendMatch = html.match(/"recommendationTrend"\s*:\s*\{\s*"trend"\s*:\s*(\[[^\]]+\])/);
            if (trendMatch) {
                try {
                    const trendArr = JSON.parse(trendMatch[1]);
                    const trend = Array.isArray(trendArr) ? trendArr[0] : null;
                    if (trend) {
                        return {
                            strongBuy: Number(trend.strongBuy) || 0,
                            buy: Number(trend.buy) || 0,
                            hold: Number(trend.hold) || 0,
                            sell: Number(trend.sell) || 0,
                            strongSell: Number(trend.strongSell) || 0
                        };
                    }
                } catch (e) {
                    console.warn("策略1 JSON解析失败:", e);
                }
            }

            // 策略1.1: 从 QuoteSummaryStore JSON 片段提取
            const qssMatch = html.match(/"QuoteSummaryStore"\s*:\s*(\{.+?\})\s*,\s*"StreamDataStore"/s);
            if (qssMatch) {
                try {
                    const qssObj = JSON.parse(`{${qssMatch[1]}}`);
                    const trend = qssObj?.recommendationTrend?.trend?.[0];
                    if (trend) {
                        return {
                            strongBuy: Number(trend.strongBuy) || 0,
                            buy: Number(trend.buy) || 0,
                            hold: Number(trend.hold) || 0,
                            sell: Number(trend.sell) || 0,
                            strongSell: Number(trend.strongSell) || 0
                        };
                    }
                } catch (e) {
                    console.warn("策略1.1 QuoteSummaryStore解析失败:", e);
                }
            }
            
            // 策略2: DOM解析 (更稳健)
            // Yahoo Analysis页面通常由表格组成
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            // 查找评级表格
            const tables = doc.querySelectorAll("table");
            for (const table of tables) {
                const text = table.innerText || "";
                if (text.includes("Strong Buy") && text.includes("Strong Sell")) {
                    // 假设这是一个评级表格，尝试提取数字
                    // 现在的Yahoo页面结构经常变化，这里尝试简单的文本提取
                    // 行通常是: Rating | Current | 1 Month Ago ...
                    const rows = table.querySelectorAll("tr");
                    let result = { strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 };
                    
                    rows.forEach(row => {
                        const rowText = row.innerText;
                        const cells = row.querySelectorAll("td");
                        if (cells.length > 1) {
                            const val = parseInt(cells[1].innerText.replace(/[^0-9]/g, "")) || 0;
                            if (rowText.includes("Strong Buy")) result.strongBuy = val;
                            else if (rowText.includes("Strong Sell")) result.strongSell = val;
                            else if (rowText.includes("Underperform")) result.sell = val; // Yahoo有时叫Underperform
                            else if (rowText.includes("Sell")) result.sell = val;
                            else if (rowText.includes("Hold")) result.hold = val;
                            else if (rowText.includes("Buy")) result.buy = val;
                        }
                    });
                    
                    // 验证是否获取到了数据
                    const total = result.strongBuy + result.buy + result.hold + result.sell + result.strongSell;
                    if (total > 0) return result;
                }
            }

            console.warn("👔 未能解析出分析师评级数据");
            return null;
        } catch (e) {
            console.warn("解析推荐评级异常:", e);
            return null;
        }
    }

    // 解析目标价（HTML爬虫 + DOM解析）
    parsePriceTargets(html) {
        try {
            // 策略1: 直接提取 financialData 片段
            const financialMatch = html.match(/"financialData"\s*:\s*(\{.+?\})\s*,\s*"quoteType"/s);
            if (financialMatch) {
                try {
                    const financial = JSON.parse(`{${financialMatch[1]}}`);
                    const targetMean = financial?.targetMeanPrice?.raw;
                    const targetLow = financial?.targetLowPrice?.raw;
                    const targetHigh = financial?.targetHighPrice?.raw;
                    if (targetMean || targetLow || targetHigh) {
                        return {
                            targetLow: targetLow || 0,
                            targetHigh: targetHigh || 0,
                            targetMean: targetMean || 0
                        };
                    }
                } catch (e) {}
            }

            // 策略1.1: 直接提取 targetMeanPrice 片段
            const targetMatch = html.match(/"targetMeanPrice"\s*:\s*(\{[^}]+\})/);
            if (targetMatch) {
                try {
                    const obj = JSON.parse(targetMatch[1]);
                    if (obj.raw) {
                        return { targetLow: 0, targetHigh: 0, targetMean: obj.raw };
                    }
                } catch (e) {}
            }

            // 策略2: DOM解析
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            
            // 查找包含 "Average Target Price" 或类似文本的元素
            // Yahoo页面有时显示为 "Average" 和价格
            const spans = doc.querySelectorAll("span, div");
            for (const span of spans) {
                if (span.textContent.includes("Average Target Price")) {
                    // 寻找附近的数字
                    // 通常结构是 <span>Label</span> <span>Value</span>
                    // 或者是 父级div包含两者
                    const parent = span.parentElement;
                    if (parent) {
                        const prices = parent.innerText.match(/\d+\.\d{2}/g);
                        if (prices && prices.length > 0) {
                            return { targetMean: parseFloat(prices[0]), targetLow: 0, targetHigh: 0 };
                        }
                    }
                }
            }

            return { targetLow: 0, targetHigh: 0, targetMean: 0 };
        } catch (e) {
            console.warn("解析目标价异常:", e);
            return { targetLow: 0, targetHigh: 0, targetMean: 0 };
        }
    }

    // 3. 机构持股数据（从Yahoo Finance网页爬取）
    async fetchInstitutionalData(symbol) {
        const cacheKey = `institutional_${symbol}`;
        const cached = this.institutionalCache?.[cacheKey];
        if (cached && Date.now() - cached.ts < 86400000) { // 24小时缓存
            return cached.data;
        }

        try {
            console.log("🏦 爬取Yahoo Finance机构持股:", symbol);
            
            const holdersUrl = `https://finance.yahoo.com/quote/${symbol}/holders`;
            console.log("🏦 请求页面:", holdersUrl);
            const html = await this.proxyFetch(holdersUrl);
            
            // 从HTML中提取机构持股数据
            const ownershipData = this.parseInstitutionalOwnership(html);
            
            if (ownershipData && ownershipData.institutionOwnership !== "N/A") {
                console.log("🏦 ✅ 成功解析机构持股:", ownershipData);
            } else {
                console.warn("🏦 ❌ 未找到机构持股数据");
            }

            const result = ownershipData || this.getDefaultInstitutionalData();
            
            if (!this.institutionalCache) this.institutionalCache = {};
            this.institutionalCache[cacheKey] = { data: result, ts: Date.now() };

            return result;
        } catch (e) {
            console.error("🏦 机构持股获取失败:", e);
            return this.getDefaultInstitutionalData();
        }
    }

    // 解析机构持股数据（HTML爬虫 + DOM解析）
    parseInstitutionalOwnership(html) {
        try {
            // 调试信息
            const titleMatch = html.match(/<title>([^<]*)<\/title>/);
            if (titleMatch) console.log("🏦 页面标题:", titleMatch[1]);
            
            // 策略1: 宽松JSON提取 (majorHoldersBreakdown)
            const breakdownMatch = html.match(/"majorHoldersBreakdown"\s*:\s*(\{(?:[^{}]|{[^{}]*})*\})/);
            let institutionPercent = "N/A";
            let insiderPercent = "N/A";
            
            if (breakdownMatch) {
                try {
                    const data = JSON.parse(breakdownMatch[1]);
                    institutionPercent = data.institutionsPercentHeld?.fmt || "N/A";
                    insiderPercent = data.insidersPercentHeld?.fmt || "N/A";
                } catch(e) {}
            }
            
            // 策略2: JSON提取 (topHolders)
            let topHolders = [];
            // 尝试查找 institutionOwnership (可能不在同一个JSON块中)
            const ownershipMatch = html.match(/"institutionOwnership"\s*:\s*(\{(?:[^{}]|{[^{}]*})*\})/);
            if (ownershipMatch) {
               try {
                   const data = JSON.parse(ownershipMatch[1]);
                   const list = data.ownershipList || [];
                   topHolders = list.slice(0, 5).map(inst => ({
                        name: inst.organization || "Unknown",
                        shares: this.formatVolume(inst.position?.raw || 0),
                        change: inst.pctChange?.raw || 0
                    }));
               } catch(e) {}
            }
            
            // 策略3: DOM解析 (Backup)
            if (institutionPercent === "N/A") {
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                
                // 查找包含 "% Held by Institutions" 的文本
                // 结构通常是: <span>X.XX%</span> <span>% Held by Institutions</span>
                const allDivs = doc.querySelectorAll("div, span, td");
                for (const el of allDivs) {
                    if (el.innerText && el.innerText.includes("% Held by Institutions")) {
                        // 尝试找前一个兄弟节点或父节点的第一个子节点
                        // 这是一个启发式搜索
                        const parent = el.parentElement;
                        if (parent) {
                            const match = parent.innerText.match(/(\d+\.\d+)%/);
                            if (match) {
                                institutionPercent = match[1] + "%";
                                break;
                            }
                        }
                    }
                }
                
                // 查找Insiders
                if (insiderPercent === "N/A") {
                    for (const el of allDivs) {
                        if (el.innerText && el.innerText.includes("% Held by Insiders")) {
                            const parent = el.parentElement;
                            if (parent) {
                                const match = parent.innerText.match(/(\d+\.\d+)%/);
                                if (match) {
                                    insiderPercent = match[1] + "%";
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // DOM解析 Top Holders 表格
                if (topHolders.length === 0) {
                     const tables = doc.querySelectorAll("table");
                     for (const table of tables) {
                         const headerText = table.querySelector("thead")?.innerText || table.innerText;
                         if (headerText.includes("Top Institutional Holders")) {
                             const rows = table.querySelectorAll("tbody tr");
                             let count = 0;
                             rows.forEach(row => {
                                 if (count >= 5) return;
                                 const cells = row.querySelectorAll("td");
                                 if (cells.length >= 4) {
                                     // Name | Shares | Date | % Out | Value
                                     // 格式可能会变，取第一列和最后一列或中间列
                                     const name = cells[0].innerText;
                                     const shares = cells[1].innerText; 
                                     // 变化率通常不显示在Top Holders表中，设为0
                                     topHolders.push({ name, shares, change: 0 });
                                     count++;
                                 }
                             });
                         }
                     }
                }
            }

            // 计算平均变化
            const avgChange = topHolders.length > 0
                ? (topHolders.reduce((sum, h) => sum + (h.change || 0), 0) / topHolders.length).toFixed(2)
                : 0;
            
            return {
                institutionOwnership: institutionPercent,
                insiderOwnership: insiderPercent,
                institutionalTrend: avgChange > 2 ? "增持📈" : avgChange < -2 ? "减持📉" : "稳定",
                avgInstitutionalChange: avgChange + "%",
                topHolders: topHolders,
                recentInsiderTransactions: [],
                insiderSentiment: topHolders.length > 0 ? "已获取机构数据" : "数据不可用"
            };
        } catch (e) {
            console.warn("解析机构持股异常:", e);
            return null;
        }
    }

    // 辅助函数：返回默认分析师数据
    getDefaultAnalystData() {
        return {
            strongBuy: 0,
            buy: 0,
            hold: 0,
            sell: 0,
            strongSell: 0,
            totalAnalysts: 0,
            targetLow: 0,
            targetHigh: 0,
            targetMean: 0,
            targetMedian: 0,
            currentPrice: 0,
            upside: "N/A",
            consensus: "数据不可用"
        };
    }

    // 辅助函数：返回默认机构持股数据
    getDefaultInstitutionalData() {
        return {
            institutionOwnership: "N/A",
            insiderOwnership: "N/A",
            institutionalTrend: "数据不可用",
            avgInstitutionalChange: "N/A",
            topHolders: [],
            recentInsiderTransactions: [],
            insiderSentiment: "数据不可用"
        };
    }

    // 4. 市场情绪指标（简化版 - 基于技术指标综合）
    async calculateMarketSentiment(symbol, detailedQuote) {
        try {
            // 综合多个维度计算情绪分数（0-100）
            let sentimentScore = 50; // 中性起点
            const factors = [];

            // 1. RSI因子（20分）
            const rsiText = document.getElementById("assist-rsi")?.innerText || "";
            const rsiMatch = rsiText.match(/(\d+\.?\d*)/);
            if (rsiMatch) {
                const rsi = parseFloat(rsiMatch[1]);
                if (rsi > 70) { sentimentScore -= 10; factors.push("RSI超买-10"); }
                else if (rsi < 30) { sentimentScore += 10; factors.push("RSI超卖+10"); }
                else { sentimentScore += (50 - rsi) / 5; factors.push(`RSI中性${((50 - rsi) / 5).toFixed(1)}`); }
            }

            // 2. MACD因子（15分）
            const macdSignal = document.getElementById("assist-macd-signal")?.innerText || "";
            if (macdSignal.includes("金叉")) { sentimentScore += 10; factors.push("MACD金叉+10"); }
            else if (macdSignal.includes("死叉")) { sentimentScore -= 10; factors.push("MACD死叉-10"); }
            else if (macdSignal.includes("多头")) { sentimentScore += 5; factors.push("MACD多头+5"); }
            else if (macdSignal.includes("空头")) { sentimentScore -= 5; factors.push("MACD空头-5"); }

            // 3. 量价因子（15分）
            if (detailedQuote && this.state?.history?.length >= 2) {
                const volRatio = parseFloat(detailedQuote.volumeRatio || "0");
                const priceChange = (this.state.lastPrice || 0) - (this.state.history[this.state.history.length - 2] || 0);
                
                if (volRatio > 1.5 && priceChange > 0) { sentimentScore += 10; factors.push("放量上涨+10"); }
                else if (volRatio > 1.5 && priceChange < 0) { sentimentScore -= 10; factors.push("放量下跌-10"); }
                else if (volRatio < 0.7 && priceChange > 0) { sentimentScore -= 5; factors.push("缩量上涨-5"); }
            }

            // 4. 52周位置因子（10分）
            if (detailedQuote && detailedQuote.fiftyTwoWeekPosition && detailedQuote.fiftyTwoWeekPosition !== "N/A") {
                const pos = parseFloat(detailedQuote.fiftyTwoWeekPosition);
                if (!Number.isNaN(pos)) {
                    if (pos > 80) { sentimentScore -= 8; factors.push("年度高位-8"); }
                    else if (pos < 20) { sentimentScore += 8; factors.push("年度低位+8"); }
                }
            }

            // 5. 板块强弱因子（10分）
            const rangeSignal = document.getElementById("assist-range-signal")?.innerText || "";
            if (rangeSignal.includes("低位")) { sentimentScore += 8; factors.push("日内低位+8"); }
            else if (rangeSignal.includes("高位")) { sentimentScore -= 8; factors.push("日内高位-8"); }

            // 限制范围 0-100
            sentimentScore = Math.max(0, Math.min(100, sentimentScore));

            // 分级
            let level = "中性";
            if (sentimentScore >= 70) level = "极度乐观🔥";
            else if (sentimentScore >= 60) level = "乐观📈";
            else if (sentimentScore <= 30) level = "极度悲观❄️";
            else if (sentimentScore <= 40) level = "悲观📉";

            return {
                score: sentimentScore.toFixed(0),
                level,
                factors: factors.slice(0, 5), // 最多显示5个因子
                recommendation: sentimentScore > 60 ? "情绪偏热，注意回调风险" : 
                               sentimentScore < 40 ? "情绪偏冷，可能存在反弹机会" : 
                               "情绪中性，观察市场方向"
            };
        } catch (e) {
            console.warn(`Failed to calculate market sentiment for ${symbol}`, e);
            return {
                score: 50,
                level: "中性",
                factors: ["情绪计算缺少行情数据，使用默认值"],
                recommendation: "行情数据不足，建议刷新或稍后再试"
            };
        }
    }

    // ========== End Priority 3 ==========

    async fetchMacroData() {
        if (this.macroCache && (Date.now() - this.macroCache.ts < 300000)) return; 
        
        try {
            // 指数优先取真实指数 (^GSPC/^DJI/^IXIC)，失败时降级ETF代理
            let [spx, dow, nasdaq] = await Promise.all([
                this.fetchTickerData("^GSPC"),
                this.fetchTickerData("^DJI"),
                this.fetchTickerData("^IXIC")
            ]);
            if (!spx) spx = await this.fetchTickerData("SPY");
            if (!dow) dow = await this.fetchTickerData("DIA");
            if (!nasdaq) nasdaq = await this.fetchTickerData("QQQ");

            // 行业/小盘指标
            const [xlk, xlf, iwm] = await Promise.all([
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
            
            // 🚨 计算并设置SPY涨跌幅 (用于大盘过滤)
            if (spx && spx.changePct !== undefined) {
                this.state.spyChange = spx.changePct;
            } else {
                this.state.spyChange = 0; // 无数据时默认0
            }
            
            const summary = `S&P500:${spx?spx.fmt:"--"} | Dow:${dow?dow.fmt:"--"} | Nasdaq:${nasdaq?nasdaq.fmt:"--"} | VIX:${vixVal.toFixed(1)}(${regime}) | 10Y:${tnx?tnx.price.toFixed(2)+"%":"--"}`;

            this.macroCache = { 
                summary,
                vix: vixVal,
                regime,
                spx,
                dow,
                nasdaq,
                xlk,
                ts: Date.now() 
            };
            
            const ribbon = document.getElementById("macro-ribbon");
            if (ribbon) {
                let color = '#4caf50'; 
                if (vixVal > 20) color = '#ff9800'; 
                if (vixVal > 30) color = '#ff5252'; 
                
                ribbon.innerHTML = `
                    <span style="font-weight:bold;color:${color}">VIX: ${vixVal.toFixed(2)} (${regime})</span>
                    <span style="margin-left:10px;font-size:0.9em;color:#aaa">S&P ${spx?spx.fmt:"--"} | Dow ${dow?dow.fmt:"--"} | Nasdaq ${nasdaq?nasdaq.fmt:"--"}</span>
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
                        
                        // 确定当前最佳价格（优先使用盘后/盘前价格）
                        let currentPrice = meta.regularMarketPrice;
                        if (meta.postMarketPrice) currentPrice = meta.postMarketPrice;
                        else if (meta.preMarketPrice) currentPrice = meta.preMarketPrice;
                        
                        return { 
                            symbol: sym, 
                            regularMarketPrice: currentPrice,
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
                
                // --- Watchlist signals ---
                // Prefer the latest AI verdict for this symbol, fall back to做T规则
                let action = "观望";
                let actionColor = "#555";
                let actionReason = "涨跌幅在正常波动范围内";
                let volatilityAlert = ""; // 波动率横幅警告
                let volatilityLevel = "正常"; // 正常/剧烈/极端
                let decisionSource = "本地"; // AI 或 本地做T

                // 计算ATR波动率 - 优先使用Watchlist历史数据
                let atrPercent = 0;
                const watchlistData = this.watchlistHistory.get(sym);
                if (watchlistData && watchlistData.history && watchlistData.history.length >= 14) {
                    const atr = this.calculateATR(watchlistData.history, 14);
                    atrPercent = (atr / price) * 100;
                    if (atrPercent > 3.0) {
                        volatilityLevel = "极端";
                        volatilityAlert = `\u26A0\uFE0F 波动极端(ATR ${atrPercent.toFixed(1)}%)`;
                    } else if (atrPercent > 1.5) {
                        volatilityLevel = "剧烈";
                        volatilityAlert = `\u{1F4CA} 波动剧烈(ATR ${atrPercent.toFixed(1)}%)`;
                    }
                } else if (sym === this.state.symbol && this.state.history && this.state.history.length >= 14) {
                    const atr = this.calculateATR(this.state.history, 14);
                    atrPercent = (atr / price) * 100;
                    if (atrPercent > 3.0) {
                        volatilityLevel = "极端";
                        volatilityAlert = `\u26A0\uFE0F 波动极端(ATR ${atrPercent.toFixed(1)}%)`;
                    } else if (atrPercent > 1.5) {
                        volatilityLevel = "剧烈";
                        volatilityAlert = `\u{1F4CA} 波动剧烈(ATR ${atrPercent.toFixed(1)}%)`;
                    }
                }

                // 如果有新鲜的AI决策，则直接复用，确保Watchlist与AI一致
                // 🚨 但AI决策也需要应用大盘过滤!
                const aiDecision = this.aiDecisionCache.get(sym);
                const aiFresh = aiDecision && (Date.now() - aiDecision.ts < 15 * 60 * 1000);
                if (aiFresh) {
                    const aiAct = (aiDecision.action || "HOLD").toUpperCase();
                    const spyChange = this.state.spyChange || 0;
                    decisionSource = "AI";
                    
                    // 🔴 大盘过滤: AI买入建议也需要检查大盘环境
                    if (aiAct === "BUY") {
                        if (spyChange <= -1) {
                            // 大盘跌>1%: AI建议买入,但大盘过滤改为观望
                            action = "\u{1F6AB}观望"; // 🚫
                            actionColor = "#9e9e9e";
                            actionReason = `AI建议买入,但🔴大盘暴跌${spyChange.toFixed(2)}%,禁止抄底!`;
                        } else if (spyChange <= -0.5) {
                            // 大盘弱势: 谨慎
                            action = "\u26A0\uFE0F谨慎"; // ⚠️
                            actionColor = "#ff9800";
                            actionReason = `AI建议买入,但⚠️大盘弱势${spyChange.toFixed(2)}%,抄底风险高`;
                        } else {
                            action = "\u{1F9E0}买入"; // 🧠
                            actionColor = "#4caf50";
                            const sent = aiDecision.sentiment ? `情绪 ${aiDecision.sentiment}/10` : "AI verdict";
                            actionReason = aiDecision.summary || sent;
                            if (spyChange >= 1) {
                                actionReason += `\n\u{1F7E2} 大盘强势${spyChange.toFixed(2)}%`;
                            }
                        }
                    } else if (aiAct === "SELL") {
                        action = "\u{1F9E0}卖出";
                        actionColor = "#f44336";
                        const sent = aiDecision.sentiment ? `情绪 ${aiDecision.sentiment}/10` : "AI verdict";
                        actionReason = aiDecision.summary || sent;
                        if (spyChange <= -1) {
                            actionReason += `\n\u{1F534} 大盘弱势${spyChange.toFixed(2)}%，卖出更安全`;
                        }
                    } else {
                        action = "\u{1F9E0}观望";
                        actionColor = "#9e9e9e";
                        const sent = aiDecision.sentiment ? `情绪 ${aiDecision.sentiment}/10` : "AI verdict";
                        actionReason = aiDecision.summary || sent;
                    }

                    if (volatilityAlert) actionReason += `\n${volatilityAlert}`;
                } else {
                    // 🚨 散户铁律: 大盘优先过滤 (大盘为王!)
                    const spyChange = this.state.spyChange || 0;
                    const marketStatus = spyChange >= 1 ? "强势" : spyChange <= -1 ? "弱势" : "中性";
                    
                    // 结合大盘+涨跌幅+波动率给出做T信号
                    if (changeP >= 2.5) { 
                        action = "\u{1F4C9}卖出"; // 📉
                        actionColor = "#f44336"; // Red
                        actionReason = `日内涨幅${changeP.toFixed(2)}%，高位卖出做T，等待回调再接`;
                        if (spyChange <= -1) {
                            actionReason += `\n\u{1F534} 大盘弱势${spyChange.toFixed(2)}%，卖出更安全`;
                        }
                        if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                            actionReason += `\n${volatilityAlert} - 向上波动加速，卖出获利窗口`;
                        }
                    } else if (changeP >= 1.0) {
                        action = "\u{1F4E4}减仓"; // 📤
                        actionColor = "#ff9800"; // Orange
                        actionReason = `日内涨幅${changeP.toFixed(2)}%，部分获利了结，保留底仓`;
                        if (spyChange <= -1) {
                            actionReason += `\n\u26A0\uFE0F 大盘弱势${spyChange.toFixed(2)}%，不宜恋战`;
                        }
                        if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                            actionReason += `\n${volatilityAlert} - 波动放大，建议部分锁利`;
                        }
                    } else if (changeP <= -3.0) {
                        // 🔴 大盘跌>1%时禁止抄底
                        if (spyChange <= -1) {
                            action = "\u{1F6AB}观望"; // 🚫
                            actionColor = "#9e9e9e"; // Gray
                            actionReason = `\u{1F534}\u26A0\uFE0F 大盘暴跌${spyChange.toFixed(2)}%，个股跌${Math.abs(changeP).toFixed(2)}%，禁止抄底! 90%概率继续跌`;
                            if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                                actionReason += `\n${volatilityAlert} - 极度危险，等大盘企稳`;
                            }
                        } else {
                            action = "\u{1F4E5}收筹"; // 📥
                            actionColor = "#4caf50"; // Green
                            actionReason = `日内跌幅${Math.abs(changeP).toFixed(2)}%，低位收筹码，分批建仓`;
                            if (spyChange >= 1) {
                                actionReason += `\n\u{1F7E2} 大盘强势${spyChange.toFixed(2)}%，抄底相对安全`;
                            } else {
                                actionReason += `\n\u26A0\uFE0F 大盘${marketStatus}，谨慎建仓`;
                            }
                            if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                                actionReason += `\n${volatilityAlert} - 向下波动加剧，分批抄底`;
                            }
                        }
                    } else if (changeP <= -1.5) {
                        // 🔴 大盘跌>1%时禁止买入
                        if (spyChange <= -1) {
                            action = "\u{1F6AB}观望"; // 🚫
                            actionColor = "#9e9e9e";
                            actionReason = `\u{1F534}\u26A0\uFE0F 大盘下跌${spyChange.toFixed(2)}%，个股跌${Math.abs(changeP).toFixed(2)}%，禁止抄底! 大盘为王`;
                        } else if (spyChange <= -0.5) {
                            action = "\u26A0\uFE0F谨慎"; // ⚠️
                            actionColor = "#ff9800";
                            actionReason = `大盘弱势${spyChange.toFixed(2)}%，个股跌${Math.abs(changeP).toFixed(2)}%，抄底风险高`;
                        } else {
                            action = "\u2705买入"; // ✅
                            actionColor = "#66bb6a"; // Light Green
                            actionReason = `日内跌幅${Math.abs(changeP).toFixed(2)}%，回调到位，适合低吸做T`;
                            if (spyChange >= 1) {
                                actionReason += `\n\u{1F7E2} 大盘强势${spyChange.toFixed(2)}%，低吸更安全`;
                            }
                            if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                                actionReason += `\n${volatilityAlert} - 下跌波动放大，低吸做T窗口`;
                            }
                        }
                    } else if (changeP > -0.5 && changeP < 0.5) {
                        action = "\u{1F504}观察"; // 🔄
                        actionColor = "#9e9e9e"; // Gray
                        actionReason = `价格窄幅震荡，等待明确方向 (大盘${marketStatus})`;
                        if (volatilityLevel === "剧烈" || volatilityLevel === "极端") {
                            actionReason += `\n${volatilityAlert} - 警惕即将突破`;
                        }
                        decisionSource = "本地";
                    }
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
                // 🎯 添加大盘趋势图标
                const spyChange = this.state.spyChange || 0;
                let marketIcon = "➡️";  // 中性
                let marketColor = "#9e9e9e";
                if (spyChange >= 1) {
                    marketIcon = "🟢";  // 强势
                    marketColor = "#4caf50";
                } else if (spyChange <= -1) {
                    marketIcon = "🔴";  // 弱势
                    marketColor = "#f44336";
                } else if (spyChange >= 0.5) {
                    marketIcon = "📈";  // 偏强
                    marketColor = "#66bb6a";
                } else if (spyChange <= -0.5) {
                    marketIcon = "📉";  // 偏弱
                    marketColor = "#ff9800";
                }
                
                miniHTML += `
                    <div class="mini-wl-row">
                        <span class="mini-wl-symbol" title="${sym}&#10;大盘: ${spyChange >= 0 ? '+' : ''}${spyChange.toFixed(2)}% ${marketIcon}">${sym} <span style="font-size:10px;">${marketIcon}</span></span>
                        <span class="mini-wl-price">${price.toFixed(2)}</span>
                        <span class="mini-wl-action" 
                            style="color:${actionColor}; border:1px solid rgba(255,255,255,0.08); background:rgba(255,255,255,0.03); box-shadow:0 0 6px ${actionColor}33; border-radius:5px; padding:0 6px; cursor:help; display:inline-flex; align-items:center; gap:6px;" 
                            title="${actionReason}">
                            <span style="font-weight:600;">${action}</span>
                            <span style="font-size:9px; color:#cfd8dc; background:#1c1c1c; border:1px solid #3a3a3a; padding:0 4px; border-radius:3px; letter-spacing:0.5px;">${decisionSource}</span>
                        </span>
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
            grokKey: document.getElementById("set-grok-key").value.trim(),
            finnhubKey: document.getElementById("set-finnhub-key").value.trim()
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

    // === 性能优化：Watchlist历史数据追踪 ===
    startWatchlistHistoryTracking() {
        // 每60秒更新一次Watchlist所有symbol的历史数据
        this.watchlistUpdateTimer = setInterval(async () => {
            const symbols = this.watchlist || [];
            if (symbols.length === 0) return;

            console.log(`📊 Updating watchlist history for ${symbols.length} symbols`);
            
            for (const symbol of symbols) {
                try {
                    // 获取当前价格
                    const quote = await this.fetchYahooQuote(symbol);
                    if (!quote || !quote.regularMarketPrice) continue;

                    const price = quote.regularMarketPrice;
                    
                    // 初始化或获取历史数据
                    if (!this.watchlistHistory.has(symbol)) {
                        this.watchlistHistory.set(symbol, {
                            history: [],
                            lastUpdate: Date.now()
                        });
                    }

                    const data = this.watchlistHistory.get(symbol);
                    data.history.push(price);
                    
                    // 保持最近14个数据点(足够计算ATR)
                    if (data.history.length > 14) {
                        data.history.shift();
                    }
                    
                    data.lastUpdate = Date.now();
                    
                } catch (e) {
                    console.error(`Failed to update history for ${symbol}:`, e);
                }
            }
        }, 60000); // 每60秒更新一次
    }

    // 智能调整更新频率
    adjustUpdateInterval() {
        const changeP = Math.abs(((this.state.price - this.state.lastPrice) / this.state.lastPrice) * 100);
        const atr = this.state.history.length >= 14 ? this.calculateATR(this.state.history, 14) : 0;
        const atrPercent = this.state.price > 0 ? (atr / this.state.price) * 100 : 0;

        let newInterval = 20000; // 默认20秒

        if (this.settings.updateMode === "fast") {
            newInterval = 10000; // 强制10秒
        } else if (this.settings.updateMode === "slow") {
            newInterval = 30000; // 强制30秒
        } else if (this.settings.updateMode === "auto") {
            // 自动模式：根据波动率动态调整
            if (atrPercent > 3.0 || changeP > 2.0) {
                // 剧烈波动：10秒快速模式
                newInterval = 10000;
            } else if (changeP < 0.5 && atrPercent < 1.0) {
                // 横盘整理：30秒节能模式
                newInterval = 30000;
            } else {
                // 正常波动：20秒标准模式
                newInterval = 20000;
            }
        }

        // 只在需要时更新interval
        if (newInterval !== this.state.updateInterval) {
            console.log(`⚡ Update interval adjusted: ${this.state.updateInterval/1000}s → ${newInterval/1000}s (ATR: ${atrPercent.toFixed(2)}%)`);
            this.state.updateInterval = newInterval;
            
            // 重启主循环定时器（这里需要在updateData中调用）
        }

        return newInterval;
    }

    // 计算技术指标趋势箭头
    calculateIndicatorTrend(indicator, currentValue) {
        if (!this.indicatorHistory[indicator]) {
            this.indicatorHistory[indicator] = [];
        }

        const history = this.indicatorHistory[indicator];
        history.push(currentValue);

        // 保持最近5个数据点
        if (history.length > 5) {
            history.shift();
        }

        // 至少需要3个点才能判断趋势
        if (history.length < 3) {
            return ""; // 无趋势
        }

        // 计算斜率（简化版：比较最近3个点的平均变化）
        const recent3 = history.slice(-3);
        const slope = (recent3[2] - recent3[0]) / 2;

        const threshold = indicator === 'rsi' ? 2 : 0.002; // RSI阈值2, MACD阈值0.002

        if (slope > threshold) {
            return "\u2197\uFE0F"; // ↗️ 上升
        } else if (slope < -threshold) {
            return "\u2198\uFE0F"; // ↘️ 下降
        } else {
            return "\u27A1\uFE0F"; // ➡️ 横盘
        }
    }

    // 做T信号智能推送
    checkTradingSignalNotification(title, message, priority = "medium") {
        // 检查用户是否启用通知
        if (!this.settings.notificationsEnabled) return;

        // 防止重复通知（5分钟冷却）
        const key = `${title}-${this.state.symbol}`;
        const lastTime = this.lastNotifications.get(key);
        const now = Date.now();

        if (lastTime && (now - lastTime) < this.notificationCooldown) {
            return; // 冷却期内，跳过
        }

        // 只推送重要信号
        if (priority === "low") {
            // 低优先级：涨跌幅≥2%或ATR>3%时才推送
            const changeP = this.state.lastPrice > 0 ? 
                Math.abs((this.state.price - this.state.lastPrice) / this.state.lastPrice * 100) : 0;
            const atr = this.state.history.length >= 14 ? this.calculateATR(this.state.history, 14) : 0;
            const atrPercent = this.state.price > 0 ? (atr / this.state.price) * 100 : 0;

            if (changeP < 2.0 && atrPercent < 3.0) {
                return; // 波动不够大，不推送
            }
        }

        // 发送Chrome通知
        if (chrome && chrome.notifications) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icon128.png',
                title: `📊 ${title}`,
                message: message,
                priority: priority === "high" ? 2 : 1,
                requireInteraction: priority === "high" // 高优先级需要用户手动关闭
            });

            // 记录通知时间
            this.lastNotifications.set(key, now);

            // 播放提示音（简单的beep）
            if (priority === "high") {
                this.playNotificationSound();
            }
        }
    }

    // 播放通知音效
    playNotificationSound() {
        try {
            // 使用Web Audio API生成简单的提示音
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);

            oscillator.frequency.value = priority === "high" ? 800 : 600; // 高音或低音
            oscillator.type = 'sine';

            gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        } catch (e) {
            console.log("Audio notification not supported");
        }
    }
}

// Start
const startAssistant = async () => {
    if (!document.querySelector('.ibkr-assistant-panel')) {
        const app = new TradingAssistant();
        window.ibkrAssist = app; // 🔍 暴露到全局供调试使用
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
