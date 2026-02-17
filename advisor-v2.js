// IBKR Trading Assistant - 智囊团 (深度分析战略家)
// 与闪电侠并行运行，提供多维度交易分析功能

console.log("🧠 智囊团: Script loaded!");

class TradingAdvisorV2 {
    constructor() {
        this.panel = null;
        this.minimizedBtn = null;
        this.newsScrollInterval = null; // 新闻自动滚动定时器
        this.state = {
            symbol: "",
            price: 0,
            history: [], // 价格历史（最多 100 条）
            volume: [],
            trades: [], // 交易日志
            lastUrl: ""
        };
        
        this.newsData = []; // 原始新闻数据
        this.translatedNews = null; // 缓存的翻译结果
        this.macroCache = null; // 大盘指数缓存
        
        this.apiKeys = {};
        this.settings = {
            newsApiKey: "",
            finnhubApiKey: ""
        };
        
        this.init();
    }

    async init() {
        console.log("🧠 智囊团 Initializing...");
        await this.loadSettings();
        this.createPanel();
        this.startMonitoring();
        this.loadTradeJournal();
        // 【新增】恢复折叠状态
        setTimeout(() => this.restoreCollapsedStates(), 500);
        
        // 【新增】获取大盘指数数据
        this.fetchMacroData();
        setInterval(() => this.fetchMacroData(), 60000); // 每分钟更新
    }

    async loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["assist_v2_settings", "assist_v2_keys", "assist_v2_trades"], (result) => {
                this.settings = result.assist_v2_settings || this.settings;
                this.apiKeys = result.assist_v2_keys || {};
                this.state.trades = result.assist_v2_trades || [];
                resolve();
            });
        });
    }

    createPanel() {
        this.panel = document.createElement("div");
        this.panel.className = "ibkr-assistant-v2-panel";
        this.panel.innerHTML = `
            <div class="ibkr-v2-header">
                <span class="ibkr-v2-title">🧠 智囊团</span>
                <div>
                    <button class="ibkr-v2-minimize" title="最小化">_</button>
                    <button class="ibkr-v2-close" title="关闭">✕</button>
                </div>
            </div>
            
            <!-- 大盘指数 -->
            <div class="v2-macro-ribbon" id="v2-macro-ribbon">
                <div class="v2-macro-item">
                    <span class="v2-macro-label">道琼斯</span>
                    <span class="v2-macro-value" id="v2-dji-value">加载中...</span>
                </div>
                <div class="v2-macro-item">
                    <span class="v2-macro-label">纳斯达克</span>
                    <span class="v2-macro-value" id="v2-nasdaq-value">加载中...</span>
                </div>
                <div class="v2-macro-item">
                    <span class="v2-macro-label">标普500</span>
                    <span class="v2-macro-value" id="v2-spy-value">加载中...</span>
                </div>
            </div>
            
            <div class="ibkr-v2-content">
                <!-- 实时新闻 -->
                <div class="v2-section">
                    <div class="v2-section-title">
                        📰 实时新闻 (Finnhub)
                        <button class="v2-collapse-btn" data-section="news">▼</button>
                    </div>
                    <div id="v2-news-section" class="v2-collapsible-section">
                        <div id="v2-news" class="v2-news-list-compact">配置 API Key 以启用...</div>
                    </div>
                </div>

                <!-- 财报日历 -->
                <div class="v2-section">
                    <div class="v2-section-title">
                        📅 财报信息
                        <button class="v2-collapse-btn" data-section="earnings">▼</button>
                    </div>
                    <div id="v2-earnings-section" class="v2-collapsible-section">
                        <div id="v2-earnings" class="v2-earnings-box">加载中...</div>
                    </div>
                </div>

                <!-- AI 分析 V2 -->
                <div class="v2-section">
                    <div class="v2-section-title">
                        🤖 AI 深度分析
                        <button class="v2-collapse-btn" data-section="analysis">▼</button>
                    </div>
                    <div id="v2-analysis-section" class="v2-collapsible-section">
                        <button id="v2-analyze" class="v2-btn-analyze">开始分析</button>
                        <div id="v2-analysis" class="v2-analysis-box">等待分析...</div>
                </div>

                <!-- 交易日志 -->
                <div class="v2-section">
                    <div class="v2-section-title">📊 交易日志 & 业绩</div>
                    <div id="v2-journal" class="v2-journal-box">
                        <div class="v2-stats">
                            <span>总交易: <b id="v2-total-trades">0</b></span>
                            <span>胜率: <b id="v2-win-rate">--%</b></span>
                            <span>总盈亏: <b id="v2-total-pnl">$0</b></span>
                        </div>
                        <button id="v2-view-journal" class="v2-btn-sm">查看详情</button>
                    </div>
                </div>

                <!-- 设置按钮 -->
                <button id="v2-settings" class="v2-btn-settings">⚙️ 设置</button>
            </div>

            <!-- 设置模态框 -->
            <div id="v2-settings-modal" class="v2-modal" style="display:none;">
                <div class="v2-modal-content">
                    <div class="v2-modal-header">
                        <span>智囊团设置</span>
                        <button class="v2-modal-close">✕</button>
                    </div>
                    <div class="v2-modal-body">
                        <div class="v2-setting-item">
                            <label>Finnhub API Key (新闻+财报)</label>
                            <input type="password" id="v2-finnhub-key" placeholder="免费获取: finnhub.io">
                        </div>
                        <div class="v2-setting-item">
                            <label>NewsAPI Key (备用新闻源)</label>
                            <input type="password" id="v2-newsapi-key" placeholder="免费获取: newsapi.org">
                        </div>
                        <div class="v2-setting-hint">
                            提示：Finnhub 提供免费 tier (60 calls/min)<br>
                            NewsAPI 提供免费 tier (100 calls/day)
                        </div>
                        <button id="v2-save-settings" class="v2-btn-save">保存</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(this.panel);
        
        // 创建最小化按钮
        this.minimizedBtn = document.createElement("div");
        this.minimizedBtn.className = "ibkr-v2-minimized-btn";
        this.minimizedBtn.innerHTML = "🚀";
        this.minimizedBtn.style.display = "none";
        this.minimizedBtn.title = "展开智能顾问 V2";
        this.minimizedBtn.onclick = () => this.toggleMinimize();
        document.body.appendChild(this.minimizedBtn);
        
        this.attachEventListeners();
    }

    attachEventListeners() {
        document.querySelector(".ibkr-v2-close").onclick = () => this.closePanel();
        document.querySelector(".ibkr-v2-minimize").onclick = () => this.toggleMinimize();
        document.getElementById("v2-analyze").onclick = () => this.runAdvancedAnalysis();
        document.getElementById("v2-settings").onclick = () => this.toggleSettings();
        document.getElementById("v2-save-settings").onclick = () => this.saveSettings();
        document.querySelector(".v2-modal-close").onclick = () => this.toggleSettings();
        document.getElementById("v2-view-journal").onclick = () => this.showJournalModal();
        
        // 【新增】绑定折叠按钮事件
        document.querySelectorAll('.v2-collapse-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const section = btn.getAttribute('data-section');
                this.toggleSection(section, btn);
            };
        });
        
        // 添加拖动功能
        this.makePanelDraggable();
    }

    // 【新增】折叠/展开功能
    toggleSection(section, btn) {
        const sectionEl = document.getElementById(`v2-${section}-section`);
        if (!sectionEl || !btn) return;
        
        if (sectionEl.style.display === 'none') {
            sectionEl.style.display = 'block';
            btn.textContent = '▼';
        } else {
            sectionEl.style.display = 'none';
            btn.textContent = '▶';
        }
        
        // 保存折叠状态
        const key = `v2_collapsed_${section}`;
        const collapsed = sectionEl.style.display === 'none';
        chrome.storage.local.set({ [key]: collapsed });
    }

    // 【新增】恢复折叠状态
    restoreCollapsedStates() {
        ['news', 'earnings', 'analysis'].forEach(section => {
            chrome.storage.local.get([`v2_collapsed_${section}`], (result) => {
                if (result[`v2_collapsed_${section}`]) {
                    const sectionEl = document.getElementById(`v2-${section}-section`);
                    const btn = document.querySelector(`.v2-collapse-btn[data-section="${section}"]`);
                    if (sectionEl && btn) {
                        sectionEl.style.display = 'none';
                        btn.textContent = '▶';
                    }
                }
            });
        });
    }

    makePanelDraggable() {
        const header = this.panel.querySelector(".ibkr-v2-header");
        let isDragging = false;
        let currentX;
        let currentY;
        let initialX;
        let initialY;
        let xOffset = 0;
        let yOffset = 0;

        // 从 storage 加载保存的位置
        chrome.storage.local.get(["assist_v2_panel_position"], (result) => {
            if (result.assist_v2_panel_position) {
                const { x, y } = result.assist_v2_panel_position;
                this.panel.style.left = x + "px";
                this.panel.style.top = y + "px";
                this.panel.style.right = "auto"; // 禁用默认的 right 定位
                xOffset = x;
                yOffset = y;
            }
        });

        header.style.cursor = "move";
        header.style.userSelect = "none";

        header.addEventListener("mousedown", (e) => {
            // 不拖动按钮点击
            if (e.target.classList.contains("ibkr-v2-close")) return;
            
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
        });

        document.addEventListener("mousemove", (e) => {
            if (isDragging) {
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;

                // 限制在视口内
                const maxX = window.innerWidth - this.panel.offsetWidth;
                const maxY = window.innerHeight - this.panel.offsetHeight;
                currentX = Math.max(0, Math.min(currentX, maxX));
                currentY = Math.max(0, Math.min(currentY, maxY));

                xOffset = currentX;
                yOffset = currentY;

                this.panel.style.left = currentX + "px";
                this.panel.style.top = currentY + "px";
                this.panel.style.right = "auto"; // 禁用默认的 right 定位
            }
        });

        document.addEventListener("mouseup", () => {
            if (isDragging) {
                isDragging = false;
                // 保存位置
                chrome.storage.local.set({
                    assist_v2_panel_position: { x: xOffset, y: yOffset }
                });
            }
        });
    }

    toggleMinimize() {
        if (this.panel.style.display === "none") {
            // 展开
            this.panel.style.display = "flex";
            this.minimizedBtn.style.display = "none";
        } else {
            // 最小化
            this.panel.style.display = "none";
            this.minimizedBtn.style.display = "flex";
        }
    }

    closePanel() {
        if (this.panel) this.panel.remove();
        if (this.minimizedBtn) this.minimizedBtn.remove();
    }

    toggleSettings() {
        const modal = document.getElementById("v2-settings-modal");
        if (modal.style.display === "none") {
            modal.style.display = "flex";
            document.getElementById("v2-finnhub-key").value = this.settings.finnhubApiKey || "";
            document.getElementById("v2-newsapi-key").value = this.settings.newsApiKey || "";
        } else {
            modal.style.display = "none";
        }
    }

    saveSettings() {
        this.settings.finnhubApiKey = document.getElementById("v2-finnhub-key").value.trim();
        this.settings.newsApiKey = document.getElementById("v2-newsapi-key").value.trim();
        
        chrome.storage.local.set({ 
            assist_v2_settings: this.settings,
            assist_v2_keys: this.apiKeys 
        }, () => {
            this.toggleSettings();
            this.showToast("✅ 设置已保存", "success");
            // 重新加载新闻和财报
            if (this.state.symbol) {
                this.fetchNews(this.state.symbol);
                this.fetchEarnings(this.state.symbol);
            }
        });
    }

    startMonitoring() {
        setInterval(() => {
            this.updateData();
        }, 1000);
    }

    updateData() {
        // 检测 URL 变化
        const currentUrl = window.location.href;
        if (this.state.lastUrl !== currentUrl) {
            this.state.lastUrl = currentUrl;
            this.state.symbol = "";
            this.state.history = [];
        }

        // 检测股票代码和价格（复用 V1 的检测逻辑）
        const title = document.title;
        let symbol = "";
        let price = 0;

        // 从标题或页面提取
        const headerElements = document.querySelectorAll("h1, h2, h3");
        for (let el of headerElements) {
            const text = el.innerText?.trim() || "";
            const match = text.match(/\b([A-Z]{1,5})\b/);
            if (match && !["USD", "EUR", "INC", "CORP"].includes(match[1])) {
                symbol = match[1];
                break;
            }
        }

        // 检测价格
        const elements = document.querySelectorAll("div, span, h1, h2, h3, strong, b");
        const candidates = [];
        elements.forEach(el => {
            if (el.children.length > 1) return;
            const text = el.innerText ? el.innerText.trim().replace(/,/g, "") : "";
            if (/^\d+\.\d{2}$/.test(text)) {
                const val = parseFloat(text);
                if (val > 0) {
                    const style = window.getComputedStyle(el);
                    const fontSize = parseFloat(style.fontSize);
                    if (fontSize > 16) {
                        candidates.push({ price: val, size: fontSize });
                    }
                }
            }
        });

        candidates.sort((a, b) => b.size - a.size);
        if (candidates.length > 0) {
            price = candidates[0].price;
        }

        if (!symbol) symbol = "DETECTED";
        if (price === 0) return;

        // 更新状态
        if (symbol !== this.state.symbol) {
            console.log(`V2: Symbol changed to ${symbol}`);
            this.state.symbol = symbol;
            this.state.history = [];
            // 加载新闻和财报
            if (symbol !== "DETECTED") {
                this.fetchNews(symbol);
                this.fetchEarnings(symbol);
            }
        }

        this.state.price = price;
        this.state.history.push(price);
        if (this.state.history.length > 100) this.state.history.shift();

        this.updateUI();
    }

    updateUI() {
        // 只更新交易统计
        this.updateJournalStats();
    }

    // === 技术指标计算 ===
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

    calculateMACD(prices) {
        if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0, prev: 0 };
        
        const ema12 = this.calculateEMA(prices, 12);
        const ema26 = this.calculateEMA(prices, 26);
        const macdLine = ema12 - ema26;
        
        // 简化版：不计算signal line，直接用 MACD 值
        return {
            macd: macdLine,
            signal: 0,
            histogram: macdLine,
            prev: prices.length > 27 ? this.calculateEMA(prices.slice(0, -1), 12) - this.calculateEMA(prices.slice(0, -1), 26) : 0
        };
    }

    calculateEMA(prices, period) {
        const k = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * k) + (ema * (1 - k));
        }
        return ema;
    }

    calculateATR(prices, period = 14) {
        if (prices.length < period + 1) return 0;
        
        let tr = 0;
        for (let i = prices.length - period; i < prices.length; i++) {
            const high = Math.max(prices[i], prices[i - 1]);
            const low = Math.min(prices[i], prices[i - 1]);
            tr += (high - low);
        }
        
        return tr / period;
    }

    // === 新闻获取 (Finnhub) ===
    async fetchNews(symbol) {
        const apiKey = this.settings.finnhubApiKey;
        if (!apiKey) {
            document.getElementById("v2-news").innerHTML = "请在设置中配置 Finnhub API Key";
            return;
        }

        try {
            const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const to = new Date().toISOString().split('T')[0];
            const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${apiKey}`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data && data.length > 0) {
                // 保存原始新闻数据
                this.newsData = data.slice(0, 5);
                // 【修复】等待异步情绪分析完成
                await this.analyzeNewsSentiment();
                this.renderNews(false); // 初始显示中文翻译
            } else {
                document.getElementById("v2-news").innerHTML = "暂无新闻";
            }
        } catch (e) {
            console.error("Finnhub news error:", e);
            document.getElementById("v2-news").innerHTML = "新闻加载失败";
        }
    }

    // 渲染新闻（支持中英文切换 + 自动滚动 + 点击跳转）
    async renderNews(showOriginal = false) {
        if (!this.newsData || this.newsData.length === 0) {
            document.getElementById("v2-news").innerHTML = "暂无新闻";
            return;
        }

        const newsContainer = document.getElementById("v2-news");
        const titleEl = document.querySelector('.v2-section-title:has(+ #v2-news-section)');
        
        // 停止旧的自动滚动
        if (this.newsScrollInterval) {
            clearInterval(this.newsScrollInterval);
            this.newsScrollInterval = null;
        }
        
        // 【新增】情绪统计移到标题区（分行显示）
        const sentimentCounts = {
            positive: (this.newsSentiments || []).filter(s => s === 'positive').length,
            neutral: (this.newsSentiments || []).filter(s => s === 'neutral').length,
            negative: (this.newsSentiments || []).filter(s => s === 'negative').length
        };
        const sentimentInfo = `<div style="font-size:10px;color:#999;margin-top:3px;">最近7天: ${sentimentCounts.positive}😊 ${sentimentCounts.neutral}😐 ${sentimentCounts.negative}😢</div>`;
        
        if (showOriginal) {
            // 更新标题区按钮
            if (titleEl) {
                const collapseBtn = titleEl.querySelector('.v2-collapse-btn');
                const collapseBtnHtml = collapseBtn ? collapseBtn.outerHTML : '';
                titleEl.innerHTML = `
                    <div style="flex:1;">
                        📰 实时新闻 (Finnhub)
                        <button class="v2-btn-toggle-small" id="v2-news-lang-btn">🌐 中文</button>
                        ${sentimentInfo}
                    </div>
                    ${collapseBtnHtml}
                `;
                // 【修复】重新绑定折叠按钮事件
                const newCollapseBtn = titleEl.querySelector('.v2-collapse-btn');
                if (newCollapseBtn) {
                    newCollapseBtn.onclick = (e) => {
                        e.stopPropagation();
                        const section = newCollapseBtn.getAttribute('data-section');
                        this.toggleSection(section, newCollapseBtn);
                    };
                }
                // 绑定语言切换按钮事件
                const btn = document.getElementById('v2-news-lang-btn');
                if (btn) btn.onclick = () => this.renderNews(false);
            }
            
            // 显示原文 + 点击跳转
            const newsHtml = this.newsData.map(item => `
                <div class="v2-news-item v2-news-clickable" data-url="${item.url || '#'}">
                    <div class="v2-news-title">${item.headline}</div>
                    <div class="v2-news-meta">${new Date(item.datetime * 1000).toLocaleDateString()} | ${item.source}</div>
                </div>
            `).join("");
            newsContainer.innerHTML = newsHtml;
            
            // 绑定点击跳转事件
            this.bindNewsClickEvents();
            // 启动自动滚动
            this.startNewsAutoScroll();
        } else {
            // 更新标题区按钮（翻译前）
            if (titleEl) {
                const collapseBtn = titleEl.querySelector('.v2-collapse-btn');
                const collapseBtnHtml = collapseBtn ? collapseBtn.outerHTML : '';
                titleEl.innerHTML = `
                    <div style="flex:1;">
                        📰 实时新闻 (Finnhub)
                        <button class="v2-btn-toggle-small" id="v2-news-lang-btn">🔤 原文</button>
                        ${sentimentInfo}
                    </div>
                    ${collapseBtnHtml}
                `;
                // 【修复】重新绑定折叠按钮事件
                const newCollapseBtn = titleEl.querySelector('.v2-collapse-btn');
                if (newCollapseBtn) {
                    newCollapseBtn.onclick = (e) => {
                        e.stopPropagation();
                        const section = newCollapseBtn.getAttribute('data-section');
                        this.toggleSection(section, newCollapseBtn);
                    };
                }
                // 绑定语言切换按钮事件
                const btn = document.getElementById('v2-news-lang-btn');
                if (btn) btn.onclick = () => this.renderNews(true);
            }
            
            // 显示加载状态
            newsContainer.innerHTML = `<div style="text-align:center; color:#aaa; padding:20px;">翻译中...</div>`;
            
            // 异步翻译
            const translated = await this.translateNews();
            
            // 【新增】情绪emoji映射
            const sentimentEmojis = {
                'positive': '😊',
                'neutral': '😐',
                'negative': '😢'
            };
            
            const newsHtml = this.newsData.map((item, index) => {
                const sentiment = this.newsSentiments && this.newsSentiments[index] ? this.newsSentiments[index] : 'neutral';
                const emoji = sentimentEmojis[sentiment];
                return `
                    <div class="v2-news-item v2-news-clickable" data-url="${item.url || '#'}">
                        <div class="v2-news-title">${emoji} ${translated[index] || item.headline}</div>
                        <div class="v2-news-meta">${new Date(item.datetime * 1000).toLocaleDateString()} | ${item.source}</div>
                    </div>
                `;
            }).join("");
            
            newsContainer.innerHTML = newsHtml;
            
            // 绑定点击跳转事件
            this.bindNewsClickEvents();
            // 启动自动滚动
            this.startNewsAutoScroll();
        }
    }

    // 新闻点击跳转事件
    bindNewsClickEvents() {
        const newsItems = document.querySelectorAll(".v2-news-clickable");
        newsItems.forEach(item => {
            item.addEventListener("click", (e) => {
                const url = item.getAttribute("data-url");
                if (url && url !== '#') {
                    window.open(url, '_blank');
                }
            });
            // 鼠标悬停时显示手型指针
            item.style.cursor = "pointer";
        });
    }

    // 新闻自动滚动（从下往上）
    startNewsAutoScroll() {
        const newsContainer = document.getElementById("v2-news");
        if (!newsContainer) return;

        let isPaused = false;
        
        // 鼠标悬停时暂停滚动
        newsContainer.addEventListener("mouseenter", () => {
            isPaused = true;
        });
        
        newsContainer.addEventListener("mouseleave", () => {
            isPaused = false;
        });

        // 每50ms滚动1px，流畅平滑
        this.newsScrollInterval = setInterval(() => {
            if (isPaused) return;
            
            // 从下往上滚动
            newsContainer.scrollTop += 1;
            
            // 滚动到底部时重置到顶部
            if (newsContainer.scrollTop >= newsContainer.scrollHeight - newsContainer.clientHeight) {
                newsContainer.scrollTop = 0;
            }
        }, 50); // 50ms = 每秒滚动20px
    }

    // 【新增】新闻情绪分析
    async analyzeNewsSentiment() {
        if (!this.newsData || this.newsData.length === 0) {
            this.newsSentiments = [];
            return;
        }

        try {
            const v1Keys = await this.getV1ApiKeys();
            const apiKey = v1Keys.deepseekKey;
            
            if (!apiKey) {
                console.warn("No DeepSeek API Key for sentiment analysis");
                this.newsSentiments = this.newsData.map(() => 'neutral');
                return;
            }

            const headlines = this.newsData.map(item => item.headline);
            const prompt = `判断以下新闻标题的情绪(positive/neutral/negative)。
只返回5个单词，用空格分隔，顺序对应标题顺序。

标题列表：
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

情绪结果(只返回5个单词,例如: positive neutral negative positive neutral):`;

            const response = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: "你是情绪分析专家。只返回positive/neutral/negative三个单词之一，不要任何额外内容。" },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 50
                })
            });

            const data = await response.json();
            const result = data.choices[0].message.content.trim().toLowerCase();
            const sentiments = result.split(/\s+/).slice(0, this.newsData.length);
            
            // 保存情绪结果
            this.newsSentiments = sentiments.map(s => {
                if (s.includes('positive')) return 'positive';
                if (s.includes('negative')) return 'negative';
                return 'neutral';
            });

        } catch (e) {
            console.error("Sentiment analysis error:", e);
            this.newsSentiments = this.newsData.map(() => 'neutral');
        }
    }

    // 使用 AI 翻译新闻标题
    async translateNews() {
        // 检查是否有缓存的翻译
        if (this.translatedNews && this.translatedNews.symbol === this.state.symbol) {
            return this.translatedNews.titles;
        }

        const headlines = this.newsData.map(item => item.headline);
        const translated = [];

        try {
            // 获取 V1 的 DeepSeek API Key
            const v1Keys = await this.getV1ApiKeys();
            const apiKey = v1Keys.deepseekKey;
            
            if (!apiKey) {
                console.warn("No DeepSeek API Key, returning original headlines");
                return headlines;
            }

            // 批量翻译（一次性翻译所有标题）
            const prompt = `请将以下英文新闻标题翻译成中文。保持简洁专业，不要添加额外内容。
每行一个标题的翻译结果，用换行符分隔。

标题列表：
${headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

翻译结果（每行一个，不要序号）：`;

            const response = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { role: "system", content: "你是专业翻译，将英文新闻标题简洁准确地翻译成中文。" },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.3,
                    max_tokens: 500
                })
            });

            const data = await response.json();
            const result = data.choices[0].message.content.trim();
            
            // 解析翻译结果
            const lines = result.split('\n').filter(line => line.trim());
            for (let i = 0; i < headlines.length; i++) {
                translated.push(lines[i] || headlines[i]);
            }

            // 缓存翻译结果
            this.translatedNews = {
                symbol: this.state.symbol,
                titles: translated
            };

        } catch (e) {
            console.error("Translation error:", e);
            return headlines; // 翻译失败则返回原文
        }

        return translated;
    }

    // === 财报日历 (Finnhub) ===
    async fetchEarnings(symbol) {
        const apiKey = this.settings.finnhubApiKey;
        if (!apiKey) {
            document.getElementById("v2-earnings").innerHTML = "请配置 Finnhub API Key";
            return;
        }

        const box = document.getElementById("v2-earnings");
        box.innerHTML = "加载财报数据中...";

        try {
            // 并行获取多个数据源
            const [calendarData, metricsData, financialsData, peersData] = await Promise.all([
                // 1. 财报日历
                fetch(`https://finnhub.io/api/v1/calendar/earnings?symbol=${symbol}&token=${apiKey}`).then(r => r.json()),
                // 2. 关键财务指标
                fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${apiKey}`).then(r => r.json()),
                // 3. 财务报表 (最近季度)
                fetch(`https://finnhub.io/api/v1/stock/financials-reported?symbol=${symbol}&token=${apiKey}`).then(r => r.json()),
                // 4. 同行业公司列表
                fetch(`https://finnhub.io/api/v1/stock/peers?symbol=${symbol}&token=${apiKey}`).then(r => r.json()).catch(() => [])
            ]);

            let html = '<div class="v2-earnings-enhanced">';

            // === 1. 财报日历 ===
            if (calendarData && calendarData.earningsCalendar && calendarData.earningsCalendar.length > 0) {
                const earnings = calendarData.earningsCalendar[0];
                const epsActual = earnings.epsActual;
                const epsEstimate = earnings.epsEstimate;
                const surprise = epsActual && epsEstimate ? ((epsActual - epsEstimate) / Math.abs(epsEstimate) * 100).toFixed(1) : null;
                
                // 【新增】财报倒计时
                const earningsDate = new Date(earnings.date);
                const today = new Date();
                const daysUntil = Math.ceil((earningsDate - today) / (1000 * 60 * 60 * 24));
                let countdownHtml = '';
                if (earnings.date && !epsActual) { // 只在未公布时显示倒计时
                    if (daysUntil === 0) {
                        countdownHtml = `<div style="grid-column:1/-1;text-align:center;background:#ff9800;color:#fff;padding:8px;border-radius:5px;font-weight:bold;">🔥 今日财报 🔥</div>`;
                    } else if (daysUntil > 0 && daysUntil <= 3) {
                        countdownHtml = `<div style="grid-column:1/-1;text-align:center;background:#f44336;color:#fff;padding:6px;border-radius:5px;">⚠️ 距离财报 <b>${daysUntil}天</b> ⚠️</div>`;
                    } else if (daysUntil > 3 && daysUntil <= 30) {
                        countdownHtml = `<div style="grid-column:1/-1;color:#666;text-align:center;">📅 距离财报 ${daysUntil}天</div>`;
                    }
                }
                
                // 【新增】历史财报表现 - 提取过去4个季度的惊喜率
                const historicalEarnings = calendarData.earningsCalendar
                    .filter(e => e.epsActual && e.epsEstimate)
                    .slice(0, 4)
                    .reverse(); // 从旧到新排列
                
                let historyHtml = '';
                if (historicalEarnings.length > 0) {
                    const historyItems = historicalEarnings.map((e, idx) => {
                        const surprise = ((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate) * 100).toFixed(1);
                        const color = surprise > 0 ? '#4caf50' : '#f44336';
                        const quarter = `Q${historicalEarnings.length - idx}`;
                        return `<span style="color:${color};font-weight:bold;">${quarter}: ${surprise > 0 ? '+' : ''}${surprise}%</span>`;
                    }).join(' | ');
                    
                    historyHtml = `
                        <div style="grid-column:1/-1;font-size:11px;padding:8px;background:#f5f5f5;border-radius:5px;margin-top:5px;">
                            <b style="color:#333;">📈 历史财报表现:</b> ${historyItems}
                        </div>
                    `;
                }
                
                html += `
                    <div class="v2-earnings-section">
                        <div class="v2-section-title">📅 财报日历</div>
                        <div class="v2-earnings-grid">
                            ${countdownHtml}
                            <div>日期: <b>${earnings.date || 'TBA'}</b></div>
                            <div>EPS预期: <b>$${earnings.epsEstimate || 'N/A'}</b></div>
                            ${epsActual ? `<div>EPS实际: <b style="color:${surprise > 0 ? '#4caf50' : '#f44336'}">$${epsActual}</b></div>` : ''}
                            ${surprise ? `<div>EPS惊喜: <b style="color:${surprise > 0 ? '#4caf50' : '#f44336'}">${surprise > 0 ? '+' : ''}${surprise}%</b></div>` : ''}
                            <div>营收预期: <b>${earnings.revenueEstimate ? '$' + (earnings.revenueEstimate / 1e9).toFixed(2) + 'B' : 'N/A'}</b></div>
                            ${historyHtml}
                        </div>
                    </div>
                `;
            } else {
                html += `<div class="v2-earnings-section"><div class="v2-section-title">📅 财报日历</div><div>暂无即将公布的财报</div></div>`;
            }

            // === 2. 关键财务指标 ===
            if (metricsData && metricsData.metric) {
                const m = metricsData.metric;
                const series = metricsData.series;
                
                html += `
                    <div class="v2-earnings-section">
                        <div class="v2-section-title">💰 关键财务指标</div>
                        <div class="v2-earnings-grid">
                            ${m.peNormalizedAnnual ? `<div>P/E: <b>${m.peNormalizedAnnual.toFixed(2)}</b> <span style="font-size:10px;color:#999">${this.interpretPE(m.peNormalizedAnnual)}</span></div>` : ''}
                            ${m.pbAnnual ? `<div>P/B: <b>${m.pbAnnual.toFixed(2)}</b> <span style="font-size:10px;color:#999">${this.interpretPB(m.pbAnnual)}</span></div>` : ''}
                            ${m.roaeTTM ? `<div>ROE: <b>${(m.roaeTTM * 100).toFixed(1)}%</b> <span style="font-size:10px;color:#999">${this.interpretROE(m.roaeTTM * 100)}</span></div>` : ''}
                            ${m.roaTTM ? `<div>ROA: <b>${(m.roaTTM * 100).toFixed(1)}%</b> <span style="font-size:10px;color:#999">${this.interpretROA(m.roaTTM * 100)}</span></div>` : ''}
                            ${m.currentRatioAnnual ? `<div>流动比率: <b>${m.currentRatioAnnual.toFixed(2)}</b> <span style="font-size:10px;color:#999">${this.interpretCurrentRatio(m.currentRatioAnnual)}</span></div>` : ''}
                            ${m.totalDebt_totalEquityAnnual ? `<div>资产负债率: <b>${m.totalDebt_totalEquityAnnual.toFixed(2)}</b> <span style="font-size:10px;color:#999">${this.interpretDebtRatio(m.totalDebt_totalEquityAnnual)}</span></div>` : ''}
                            ${m.grossMarginAnnual ? `<div>毛利率: <b>${m.grossMarginAnnual.toFixed(1)}%</b> <span style="font-size:10px;color:#999">${this.interpretGrossMargin(m.grossMarginAnnual)}</span></div>` : ''}
                            ${m.operatingMarginAnnual ? `<div>营业利润率: <b>${m.operatingMarginAnnual.toFixed(1)}%</b> <span style="font-size:10px;color:#999">${this.interpretOperatingMargin(m.operatingMarginAnnual)}</span></div>` : ''}
                        </div>
                    </div>
                `;

                // 财务健康度评分
                const healthScore = this.calculateFinancialHealth(m);
                html += `
                    <div class="v2-earnings-section">
                        <div class="v2-section-title">🏥 财务健康度</div>
                        <div class="v2-health-score">
                            <div class="v2-health-bar">
                                <div class="v2-health-fill" style="width:${healthScore.score * 10}%; background:${this.getHealthColor(healthScore.score)}"></div>
                            </div>
                            <div style="margin-top:5px;"><b>${healthScore.score}/10</b> - ${healthScore.label}</div>
                            <div style="font-size:11px;color:#999;margin-top:3px;">${healthScore.reason}</div>
                        </div>
                    </div>
                `;

                // 【新增】同行业对比
                if (peersData && peersData.length > 0) {
                    // 获取同行业指标 (最多前5个同行)
                    const peerSymbols = peersData.slice(0, 5).filter(p => p !== symbol);
                    const peerMetricsPromises = peerSymbols.map(peer =>
                        fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${peer}&metric=all&token=${apiKey}`)
                            .then(r => r.json())
                            .catch(() => null)
                    );

                    const peerMetrics = await Promise.all(peerMetricsPromises);
                    const validPeers = peerMetrics.filter(pm => pm && pm.metric);

                    if (validPeers.length > 0) {
                        // 计算行业平均
                        const peerPEs = validPeers.map(pm => pm.metric.peNormalizedAnnual).filter(v => v && v > 0);
                        const peerROEs = validPeers.map(pm => pm.metric.roaeTTM).filter(v => v);

                        const avgPE = peerPEs.length > 0 ? peerPEs.reduce((a, b) => a + b) / peerPEs.length : null;
                        const avgROE = peerROEs.length > 0 ? (peerROEs.reduce((a, b) => a + b) / peerROEs.length * 100) : null;

                        const myPE = m.peNormalizedAnnual;
                        const myROE = m.roaeTTM ? m.roaeTTM * 100 : null;

                        html += `
                            <div class="v2-earnings-section">
                                <div class="v2-section-title">🏢 同行业对比</div>
                                <div class="v2-earnings-grid">
                                    ${myPE && avgPE ? `
                                        <div>
                                            P/E: <b>${myPE.toFixed(2)}</b>
                                            <br><span style="font-size:10px;color:#999">
                                                行业均值: ${avgPE.toFixed(2)} 
                                                <span style="color:${myPE > avgPE ? '#f44336' : '#4caf50'}">
                                                    ${myPE > avgPE ? '偏高' : '偏低'} ${Math.abs(((myPE - avgPE) / avgPE * 100)).toFixed(1)}%
                                                </span>
                                            </span>
                                        </div>
                                    ` : ''}
                                    ${myROE && avgROE ? `
                                        <div>
                                            ROE: <b>${myROE.toFixed(1)}%</b>
                                            <br><span style="font-size:10px;color:#999">
                                                行业均值: ${avgROE.toFixed(1)}% 
                                                <span style="color:${myROE > avgROE ? '#4caf50' : '#f44336'}">
                                                    ${myROE > avgROE ? '优于' : '弱于'} 行业 ${Math.abs(myROE - avgROE).toFixed(1)}%
                                                </span>
                                            </span>
                                        </div>
                                    ` : ''}
                                    <div style="grid-column:1/-1;font-size:10px;color:#999;margin-top:5px;">
                                        对比同行: ${peerSymbols.slice(0, 3).join(', ')}${peerSymbols.length > 3 ? ' 等' : ''}
                                    </div>
                                </div>
                            </div>
                        `;
                    }
                }
            } else {
                html += `<div class="v2-earnings-section"><div class="v2-section-title">💰 财务指标</div><div>数据加载失败或不可用</div></div>`;
            }

            html += '</div>';
            box.innerHTML = html;

        } catch (e) {
            console.error("Finnhub earnings error:", e);
            box.innerHTML = `<div style="color:#f44336;">财报数据加载失败: ${e.message}</div>`;
        }
    }

    // === 财务指标解读函数 ===
    interpretPE(pe) {
        if (pe < 15) return "估值偏低";
        if (pe < 25) return "合理估值";
        if (pe < 40) return "估值偏高";
        return "高估值风险";
    }

    interpretPB(pb) {
        if (pb < 1) return "破净值";
        if (pb < 3) return "合理";
        return "溢价较高";
    }

    interpretROE(roe) {
        if (roe > 20) return "优秀";
        if (roe > 15) return "良好";
        if (roe > 10) return "一般";
        return "偏弱";
    }

    interpretROA(roa) {
        if (roa > 10) return "优秀";
        if (roa > 5) return "良好";
        return "一般";
    }

    interpretCurrentRatio(ratio) {
        if (ratio > 2) return "流动性充足";
        if (ratio > 1) return "流动性健康";
        return "流动性风险";
    }

    interpretDebtRatio(ratio) {
        if (ratio < 0.5) return "负债低";
        if (ratio < 1) return "负债合理";
        if (ratio < 2) return "负债偏高";
        return "高杠杆风险";
    }

    interpretGrossMargin(margin) {
        if (margin > 50) return "高毛利";
        if (margin > 30) return "健康";
        return "偏低";
    }

    interpretOperatingMargin(margin) {
        if (margin > 20) return "盈利能力强";
        if (margin > 10) return "盈利健康";
        return "盈利承压";
    }

    // 计算财务健康度综合评分 (0-10分)
    calculateFinancialHealth(metrics) {
        let score = 0;
        let factors = [];

        // ROE (权重25%)
        if (metrics.roaeTTM) {
            const roe = metrics.roaeTTM * 100;
            if (roe > 20) { score += 2.5; factors.push("ROE优秀"); }
            else if (roe > 15) { score += 2; factors.push("ROE良好"); }
            else if (roe > 10) { score += 1.5; }
            else { factors.push("ROE偏弱"); }
        }

        // 流动比率 (权重20%)
        if (metrics.currentRatioAnnual) {
            if (metrics.currentRatioAnnual > 2) { score += 2; factors.push("流动性充足"); }
            else if (metrics.currentRatioAnnual > 1) { score += 1.5; factors.push("流动性健康"); }
            else { factors.push("流动性风险"); }
        }

        // 资产负债率 (权重20%)
        if (metrics.totalDebt_totalEquityAnnual) {
            if (metrics.totalDebt_totalEquityAnnual < 0.5) { score += 2; factors.push("低负债"); }
            else if (metrics.totalDebt_totalEquityAnnual < 1) { score += 1.5; }
            else if (metrics.totalDebt_totalEquityAnnual < 2) { score += 1; }
            else { factors.push("高杠杆"); }
        }

        // 毛利率 (权重15%)
        if (metrics.grossMarginAnnual) {
            if (metrics.grossMarginAnnual > 50) { score += 1.5; factors.push("高毛利"); }
            else if (metrics.grossMarginAnnual > 30) { score += 1; }
        }

        // 营业利润率 (权重20%)
        if (metrics.operatingMarginAnnual) {
            if (metrics.operatingMarginAnnual > 20) { score += 2; factors.push("盈利能力强"); }
            else if (metrics.operatingMarginAnnual > 10) { score += 1.5; }
            else { factors.push("盈利承压"); }
        }

        // 评级标签
        let label = "";
        let reason = "";
        if (score >= 8) {
            label = "财务健康 💪";
            reason = factors.slice(0, 2).join(", ") + " - 基本面扎实";
        } else if (score >= 6) {
            label = "财务良好 👍";
            reason = factors.slice(0, 2).join(", ");
        } else if (score >= 4) {
            label = "财务一般 ⚠️";
            reason = "存在" + factors.filter(f => f.includes("风险") || f.includes("承压") || f.includes("偏弱")).join(", ");
        } else {
            label = "财务风险 ⚠️";
            reason = "多项指标偏弱，谨慎投资";
        }

        return { score: Math.min(score, 10), label, reason };
    }

    getHealthColor(score) {
        if (score >= 8) return "#4caf50"; // Green
        if (score >= 6) return "#8bc34a"; // Light Green
        if (score >= 4) return "#ff9800"; // Orange
        return "#f44336"; // Red
    }

    // === AI 深度分析 ===
    async runAdvancedAnalysis() {
        const btn = document.getElementById("v2-analyze");
        const box = document.getElementById("v2-analysis");
        
        btn.disabled = true;
        btn.innerText = "分析中...";
        box.innerText = "正在整合技术指标、新闻、财报进行深度分析...";

        // 检查数据是否足够
        if (!this.state.symbol || this.state.symbol === "DETECTED") {
            box.innerText = "⚠️ 未检测到有效股票代码，请刷新页面";
            btn.disabled = false;
            btn.innerText = "开始分析";
            return;
        }

        if (this.state.history.length < 14) {
            box.innerText = `⏳ 数据积累中... (${this.state.history.length}/14)，请稍候`;
            btn.disabled = false;
            btn.innerText = "开始分析";
            return;
        }

        // 收集技术指标数据
        const rsi = this.calculateRSI(this.state.history, 14);
        const macd = this.calculateMACD(this.state.history);
        const atr = this.calculateATR(this.state.history, 14);
        
        console.log(`V2 Analysis: Symbol=${this.state.symbol}, Price=${this.state.price}, RSI=${rsi.toFixed(2)}, MACD=${macd.histogram.toFixed(3)}, ATR=${atr.toFixed(2)}`);
        
        // 收集新闻数据
        const newsBox = document.getElementById("v2-news");
        const newsItems = newsBox.querySelectorAll(".v2-news-item");
        let newsText = "";
        if (newsItems.length > 0) {
            const headlines = Array.from(newsItems).slice(0, 5).map(item => {
                const title = item.querySelector(".v2-news-title")?.innerText || "";
                return title;
            });
            newsText = headlines.join("; ");
        } else {
            newsText = "暂无最新新闻（可能需要配置 Finnhub API Key）";
        }

        // 收集财报数据
        const earningsBox = document.getElementById("v2-earnings");
        const earningsText = earningsBox.innerText || "暂无财报信息";
        
        // 【新增】收集大盘指数数据
        let marketContext = "大盘数据加载中...";
        if (this.macroCache) {
            const { dji, nasdaq, spy } = this.macroCache;
            const parts = [];
            if (dji) parts.push(`道琼斯${dji.fmt}`);
            if (nasdaq) parts.push(`纳斯达克${nasdaq.fmt}`);
            if (spy) parts.push(`标普500 ${spy.fmt}`);
            marketContext = parts.join(" | ");
        }
        
        // 构建增强提示词 - 散户生存优先版本
        const prompt = `
            作为**专业投资顾问**，请为散户投资者分析 ${this.state.symbol}：
            
            【核心原则】散户必须顺势而为，大盘方向 > 个股信号！
            
            【大盘趋势】(最高优先级 - 权重50%) ⚠️ 散户第一要务
            今日美股三大指数: ${marketContext}
            ${this.macroCache && this.macroCache.spy && this.macroCache.spy.changePct < -1 ? '🚨 大盘下跌>1%，系统性风险！个股操作极度危险，强烈建议观望' : ''}
            ${this.macroCache && this.macroCache.spy && this.macroCache.spy.changePct < -2 ? '🔴 大盘暴跌>2%，恐慌性抛售！散户此时买入=接飞刀，禁止操作' : ''}
            ${this.macroCache && this.macroCache.spy && this.macroCache.spy.changePct > 1 ? '🟢 大盘强势上涨，市场情绪乐观，可考虑追涨强势股' : ''}
            ${this.macroCache && this.macroCache.spy && Math.abs(this.macroCache.spy.changePct) < 0.5 ? '➡️ 大盘震荡，等待方向明确，控制仓位' : ''}
            
            ⚠️ **散户铁律**: 大盘跌>1%时，90%个股跟跌，此时不做多！
            
            【个股技术】(次要参考 - 权重30%)
            - RSI(14): ${rsi.toFixed(2)} ${rsi < 30 ? '(超卖但需确认底部)' : rsi > 70 ? '(超买警惕出货)' : '(中性)'}
            - MACD: ${macd.histogram.toFixed(3)} ${macd.histogram > 0 ? '(多头但看大盘脸色)' : '(空头趋势明确)'}
            - ATR(14): ${atr.toFixed(2)} (波动率 ${(atr/this.state.price*100).toFixed(1)}%)
            - 当前价: $${this.state.price.toFixed(2)}
            - 止损位: $${(this.state.price - atr * 2).toFixed(2)}
            
            【新闻&财报】(辅助判断 - 权重20%)
            新闻: ${newsText}
            财报: ${earningsText}
            
            【散户分析框架】(生存第一，盈利第二)
            1. **大盘为王**: 大盘跌>1%→HOLD/SELL, 大盘涨>1%→可考虑BUY
            2. **主力行为**: 放量滞涨=出货, 缩量上涨=谨慎, 放量上涨=追涨
            3. **逆势股警惕**: 大盘跌个股涨→可能诱多或板块轮动，看清逻辑
            4. **风险优先**: 不确定时选HOLD，宁可错过不可做错
            5. **止损纪律**: 跌破止损位必须走，不要心存幻想
            
            【散户成功案例】(顺势而为的智慧)
            ✅ 案例1: **顺大盘做多** - 大盘涨>1.5% + 个股突破阻力 + 成交量放大 → BUY(胜率80%)
               示例: 2023年6月SPY涨2%时买入NVDA突破$400,3天涨至$440(+10%)
               核心: 大盘给力时，龙头股爆发力最强
            
            ✅ 案例2: **大盘横盘抄底** - 大盘震荡±0.5% + 个股RSI<25 + 无负面新闻 → 小仓位BUY(胜率70%)
               示例: SPY平盘时TSLA超卖至RSI=22,反弹+15%
               核心: 大盘稳定时，超卖股有反弹空间
            
            ✅ 案例3: **逆势股看逻辑** - 大盘跌但个股涨 + 重大利好(财报/新品) → 谨慎BUY(胜率60%)
               示例: 2023年大盘跌1%但META因AI利好逆势涨5%
               核心: 必须有清晰的独立催化剂，不能是诱多
            
            ✅ 案例4: **放量突破追涨** - 大盘涨 + 个股放量突破 + 板块轮动 → BUY(胜率75%)
               示例: 半导体板块轮动时NVDA放量突破，5天+20%
               核心: 量价配合+板块共振，成功率最高
            
            ✅ 案例5: **财报前观望** - 大盘不确定 + 财报前3天 → HOLD(避免损失胜率85%)
               示例: 无数次财报暴跌，提前观望避免-20%亏损
               核心: 不确定时不操作，就是最好的操作
            
            【散户失败陷阱】(血的教训)
            ❌ 陷阱1: **逆大盘抄底** - 大盘暴跌>2%时看个股RSI超卖就买入 → 继续跌20-40%
               案例: 2022年美联储加息期间，多次"抄底"变"接飞刀"
               规避: 🚨 大盘跌>1.5%时，禁止任何买入操作！等大盘企稳
            
            ❌ 陷阱2: **追高接盘** - 个股已涨20%+但因FOMO追涨 → 高位站岗
               案例: 2021年追高ARKK创新股，随后回撤-60%
               规避: 涨幅>15%后追涨需确认大盘配合+成交量健康
            
            ❌ 陷阱3: **死扛不止损** - 跌破止损位不砍仓，幻想"长期持有" → 亏损扩大
               案例: 中概股2021年，不止损从-10%扛到-70%
               规避: ⛔ 跌破止损位立即清仓，保住本金才能翻身
            
            ❌ 陷阱4: **放量滞涨不出** - 个股连续放量但涨幅微小(主力出货) → 随后暴跌
               案例: 某科技股放量3天只涨2%，次周暴跌15%
               规避: 放量滞涨=出货信号，果断减仓
            
            ❌ 陷阱5: **无脑信新闻** - 只看利好新闻买入，忽视大盘和技术 → 利好兑现即下跌
               案例: "某公司获大单"新闻发布当天追涨，3天跌回原点
               规避: 新闻只是参考，必须结合大盘趋势+技术位置
            
            返回JSON格式（不要Markdown代码块）：
            {
                "action": "BUY|SELL|HOLD",
                "confidence": 0.0-1.0,
                "stopLoss": 数字,
                "target": 数字,
                "risk": 1-10,
                "reason": "核心理由(简要概括80字内,必须先说大盘环境)",
                "newsImpact": "positive|negative|neutral",
                "earningsRisk": "high|medium|low",
                "marketTrend": "bullish|bearish|neutral (大盘趋势判断)",
                "volumeSignal": "accumulation|distribution|neutral (主力资金流向:吸筹/出货/中性)",
                "detailedReasoning": {
                    "market": "大盘环境分析(SPY/QQQ趋势,50字内) - 最重要",
                    "technical": "个股技术分析(RSI/MACD,40字内)",
                    "volume": "成交量分析(放量/缩量/主力行为,40字内)"
                },
                "riskFactors": ["风险点1(大盘风险优先)", "风险点2", "风险点3"],
                "retailAdvice": "给散户的建议(大盘不好时建议观望,40字内)",
                "bullCase": "看涨情景(需要大盘配合,40字内)",
                "bearCase": "看跌情景(散户最需防范,40字内)",
                "matchedPattern": "匹配的散户案例编号或'无明显匹配'"
            }
        `;

        try {
            // 调用 DeepSeek（复用 V1 的 API keys）
            const v1Keys = await this.getV1ApiKeys();
            if (!v1Keys.deepseekKey) {
                box.innerText = "请先在 V1 设置中配置 DeepSeek API Key";
                btn.disabled = false;
                btn.innerText = "开始分析";
                return;
            }

            const response = await fetch("https://api.deepseek.com/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${v1Keys.deepseekKey}`
                },
                body: JSON.stringify({
                    model: "deepseek-chat",
                    messages: [
                        { 
                            role: "system", 
                            content: `你是华尔街顶级对冲基金的首席投资官(CIO),拥有15年实战经验。

【核心能力】
• 技术分析: 精通动量指标(RSI/MACD)、波动率(ATR)、趋势判断
• 基本面分析: 财报解读、估值模型(P/E/PEG)、行业对比、盈利能力(ROE/ROA)
• 情绪分析: 新闻情报解读、市场情绪、催化剂识别
• 风险管理: VaR模型、压力测试、动态止损、仓位优化

【分析框架】(必须遵循)
1. 多空双向思考: 同时列出看涨理由+看跌理由,然后权衡概率
2. 概率思维: 不要绝对化,用"65%概率上涨"而非"必涨"
3. 风险优先: 先评估"能亏多少",再考虑"能赚多少"
4. 数据驱动: 每个结论必须有数据支撑,避免主观臆断

【评估维度权重】
• 技术面(40%): RSI超买超卖、MACD金叉死叉、ATR波动率
• 基本面(35%): P/E估值水平、ROE盈利能力、财报预期
• 情绪面(25%): 新闻正负面、市场热度、催化剂

【输出标准】
• 置信度诚实: 0.5-0.7为常态,>0.8需极强信号(技术+基本面+情绪三重确认)
• 风险评分保守: 5-6为中等风险,7-8为中高风险,9-10为极端风险
• 理由详实: 150字内,突出核心逻辑+数据证据(技术+基本面+情绪三维度)
• 返回纯JSON(无markdown标记)` 
                        },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.4,
                    max_tokens: 400
                })
            });

            const data = await response.json();
            let result = data.choices[0].message.content;
            result = result.replace(/```json/g, "").replace(/```/g, "").trim();
            const analysis = JSON.parse(result);

            // === 散户优先的置信度校准 (大盘为王) ===
            let calibrationNote = "";
            
            // 🚨 1. 大盘环境校准 (最高优先级 - 散户第一要务)
            if (this.macroCache && this.macroCache.spy) {
                const spyChange = this.macroCache.spy.changePct;
                
                // 大盘暴跌>2%: 个股BUY操作风险极高
                if (spyChange < -2 && analysis.action === 'BUY') {
                    analysis.confidence = Math.min(analysis.confidence, 0.4); // 强制降至40%以下
                    analysis.risk = Math.max(analysis.risk, 9); // 风险提升至9
                    calibrationNote += " [🔴大盘暴跌>2%,极度危险]";
                }
                // 大盘下跌1-2%: 买入需谨慎
                else if (spyChange < -1 && analysis.action === 'BUY') {
                    analysis.confidence *= 0.7; // 置信度打7折
                    analysis.risk += 2; // 风险+2分
                    calibrationNote += " [⚠️大盘下跌>1%,买入风险高]";
                }
                // 大盘下跌0.5-1%: 轻微降信
                else if (spyChange < -0.5 && analysis.action === 'BUY') {
                    analysis.confidence *= 0.85;
                    analysis.risk += 1;
                    calibrationNote += " [大盘承压]";
                }
                // 大盘大涨>1.5%: 卖出操作需谨慎(可能错过更大涨幅)
                else if (spyChange > 1.5 && analysis.action === 'SELL') {
                    analysis.confidence *= 0.8;
                    calibrationNote += " [大盘强势,卖出或过早]";
                }
            }
            
            // 2. 高风险环境降低置信度
            if (analysis.confidence > 0.8 && analysis.risk >= 7) {
                analysis.confidence = Math.min(analysis.confidence, 0.75);
                calibrationNote += " [高风险降信]";
            }
            
            // 3. 数据不足降低置信度
            if (newsText.includes("暂无") || earningsText.includes("暂无")) {
                analysis.confidence *= 0.85;
                calibrationNote += " [数据不足]";
            }
            
            // 4. 极端波动率警告
            const volatilityRatio = (atr / this.state.price) * 100;
            if (volatilityRatio > 5) {
                analysis.risk = Math.max(analysis.risk, 8);
                calibrationNote += " [极端波动]";
            }
            
            // 5. 技术指标冲突降低置信度
            const rsiOverbought = rsi > 70;
            const rsiOversold = rsi < 30;
            const macdBullish = macd.histogram > 0;
            
            if ((rsiOverbought && macdBullish && analysis.action === 'SELL') ||
                (rsiOversold && !macdBullish && analysis.action === 'BUY')) {
                analysis.confidence *= 0.9;
                calibrationNote += " [信号冲突]";
            }
            
            // 6. 限制置信度范围 (0.3-0.9)
            analysis.confidence = Math.max(0.3, Math.min(0.9, analysis.confidence));
            
            // 7. 限制风险范围 (1-10)
            analysis.risk = Math.max(1, Math.min(10, analysis.risk));
            
            // 8. 添加校准说明到理由
            if (calibrationNote) {
                analysis.reason += calibrationNote;
            }

            // 新闻情绪图标
            const newsEmoji = {
                'positive': '📈',
                'negative': '📉',
                'neutral': '➡️'
            };
            const newsColor = {
                'positive': '#4caf50',
                'negative': '#f44336',
                'neutral': '#999'
            };

            // 财报风险图标
            const earningsEmoji = {
                'high': '⚠️',
                'medium': '⚡',
                'low': '✅'
            };

            // 显示结果（散户优先版 - 大盘+主力行为）
            const marketTrendEmoji = {
                'bullish': '🟢📈',
                'bearish': '🔴📉',
                'neutral': '➡️'
            };
            const marketTrendColor = {
                'bullish': '#4caf50',
                'bearish': '#f44336',
                'neutral': '#999'
            };
            
            const volumeEmoji = {
                'accumulation': '💰🟢', // 主力吸筹
                'distribution': '⚠️🔴', // 主力出货
                'neutral': '➡️'
            };
            
            box.innerHTML = `
                <div class="v2-analysis-result">
                    ${analysis.marketTrend && analysis.marketTrend !== 'neutral' ? `
                    <div style="background: ${marketTrendColor[analysis.marketTrend]}15; padding: 6px; border-radius: 4px; margin-bottom: 8px; border-left: 3px solid ${marketTrendColor[analysis.marketTrend]};">
                        <span style="font-size: 11px; font-weight: bold; color: ${marketTrendColor[analysis.marketTrend]};">
                            ${marketTrendEmoji[analysis.marketTrend]} 大盘${analysis.marketTrend === 'bullish' ? '强势' : '弱势'}
                        </span>
                    </div>
                    ` : ''}
                    
                    <div class="v2-action" style="color: ${analysis.action === 'BUY' ? '#4caf50' : analysis.action === 'SELL' ? '#f44336' : '#aaa'}; font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                        ${analysis.action} (置信度: ${(analysis.confidence * 100).toFixed(0)}%)
                        ${analysis.matchedPattern && analysis.matchedPattern !== '无明显匹配' ? `<span style="font-size: 10px; color: #00bcd4; margin-left: 5px;">📚 ${analysis.matchedPattern}</span>` : ''}
                    </div>
                    
                    <div class="v2-levels" style="display: flex; gap: 15px; margin-bottom: 8px; font-size: 11px;">
                        <span>止损: <b style="color: #f44336;">$${analysis.stopLoss}</b></span>
                        <span>目标: <b style="color: #4caf50;">$${analysis.target}</b></span>
                        <span>风险: <b>${analysis.risk}/10</b></span>
                    </div>
                    
                    <div class="v2-fundamentals" style="display: flex; gap: 10px; margin-bottom: 10px; font-size: 10px; padding: 5px; background: rgba(255,255,255,0.05); border-radius: 3px; flex-wrap: wrap;">
                        <span style="color: ${newsColor[analysis.newsImpact] || '#999'};">
                            ${newsEmoji[analysis.newsImpact] || '➡️'} 新闻: ${analysis.newsImpact || 'neutral'}
                        </span>
                        <span style="color: ${analysis.earningsRisk === 'high' ? '#f44336' : analysis.earningsRisk === 'low' ? '#4caf50' : '#ffa726'};">
                            ${earningsEmoji[analysis.earningsRisk] || '⚡'} 财报: ${analysis.earningsRisk || 'medium'}
                        </span>
                        ${analysis.volumeSignal ? `
                        <span style="color: ${analysis.volumeSignal === 'accumulation' ? '#4caf50' : analysis.volumeSignal === 'distribution' ? '#f44336' : '#999'};">
                            ${volumeEmoji[analysis.volumeSignal] || '➡️'} ${analysis.volumeSignal === 'accumulation' ? '主力吸筹' : analysis.volumeSignal === 'distribution' ? '主力出货' : '资金中性'}
                        </span>
                        ` : ''}
                    </div>
                    
                    ${analysis.retailAdvice ? `
                    <div style="background: rgba(255,152,0,0.1); padding: 6px; border-radius: 4px; margin-bottom: 8px; border-left: 3px solid #ff9800;">
                        <span style="font-size: 10px; color: #ffb74d;"><b>💡 散户建议: </b>${analysis.retailAdvice}</span>
                    </div>
                    ` : ''}
                    
                    <div class="v2-reason" style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; font-size: 11px; line-height: 1.4; color: #ddd; margin-bottom: 8px;">
                        <b>核心理由：</b>${analysis.reason}
                    </div>
                    
                    ${analysis.detailedReasoning ? `
                    <details style="font-size: 10px; margin-bottom: 8px; cursor: pointer;">
                        <summary style="color: #00bcd4; font-weight: bold; padding: 4px 0;">📊 三维度详细分析</summary>
                        <div style="padding: 6px; background: rgba(0,188,212,0.05); border-radius: 3px; margin-top: 4px;">
                            ${analysis.detailedReasoning.market ? `<div style="margin-bottom: 4px;"><b style="color: #00bcd4;">🌍 大盘：</b>${analysis.detailedReasoning.market}</div>` : ''}
                            ${analysis.detailedReasoning.technical ? `<div style="margin-bottom: 4px;"><b style="color: #ff9800;">� 技术：</b>${analysis.detailedReasoning.technical}</div>` : ''}
                            ${analysis.detailedReasoning.volume ? `<div><b style="color: #9c27b0;">� 成交量：</b>${analysis.detailedReasoning.volume}</div>` : ''}
                        </div>
                    </details>
                    ` : ''}
                    
                    ${analysis.riskFactors && analysis.riskFactors.length > 0 ? `
                    <details style="font-size: 10px; margin-bottom: 8px; cursor: pointer;">
                        <summary style="color: #f44336; font-weight: bold; padding: 4px 0;">⚠️ 关键风险点 (${analysis.riskFactors.length})</summary>
                        <ul style="padding-left: 18px; margin: 6px 0; background: rgba(244,67,54,0.05); border-radius: 3px; padding: 6px 18px;">
                            ${analysis.riskFactors.map(risk => `<li style="margin: 3px 0; color: #ffab91;">${risk}</li>`).join('')}
                        </ul>
                    </details>
                    ` : ''}
                    
                    ${analysis.bullCase && analysis.bearCase ? `
                    <details style="font-size: 10px; margin-bottom: 8px; cursor: pointer;">
                        <summary style="color: #9c27b0; font-weight: bold; padding: 4px 0;">🔀 多空情景推演</summary>
                        <div style="padding: 6px; background: rgba(156,39,176,0.05); border-radius: 3px; margin-top: 4px;">
                            <div style="margin-bottom: 4px;"><b style="color: #4caf50;">🐂 看涨情景：</b>${analysis.bullCase}</div>
                            <div><b style="color: #f44336;">🐻 看跌情景：</b>${analysis.bearCase}</div>
                        </div>
                    </details>
                    ` : ''}
                    
                    <button id="v2-log-trade" class="v2-btn-sm" style="width: 100%; background: #007acc; color: white; border: none; padding: 6px; border-radius: 3px; cursor: pointer; font-size: 11px;">
                        📝 记录到交易日志
                    </button>
                </div>
            `;

            // 添加记录按钮事件
            document.getElementById("v2-log-trade").onclick = () => {
                this.logTrade(analysis);
            };

        } catch (e) {
            console.error("V2 Analysis error:", e);
            box.innerText = "分析失败: " + e.message;
        }

        btn.disabled = false;
        btn.innerText = "重新分析";
    }

    async getV1ApiKeys() {
        return new Promise((resolve) => {
            chrome.storage.local.get(["assist_keys"], (result) => {
                resolve(result.assist_keys || {});
            });
        });
    }

    // === 交易日志 ===
    logTrade(analysis) {
        const trade = {
            timestamp: Date.now(),
            symbol: this.state.symbol,
            entryPrice: this.state.price,
            action: analysis.action,
            stopLoss: analysis.stopLoss,
            target: analysis.target,
            risk: analysis.risk,
            reason: analysis.reason,
            rsi: parseFloat(document.getElementById("v2-rsi").innerText) || 0,
            macd: parseFloat(document.getElementById("v2-macd").innerText) || 0,
            status: "OPEN", // OPEN, CLOSED
            exitPrice: null,
            pnl: null
        };

        this.state.trades.push(trade);
        this.saveTradeJournal();
        this.showToast("✅ 已记录到交易日志", "success");
        this.updateJournalStats();
    }

    loadTradeJournal() {
        chrome.storage.local.get(["assist_v2_trades"], (result) => {
            this.state.trades = result.assist_v2_trades || [];
            this.updateJournalStats();
        });
    }

    saveTradeJournal() {
        chrome.storage.local.set({ assist_v2_trades: this.state.trades });
    }

    updateJournalStats() {
        // 若DOM尚未渲染完毕，直接跳过，避免null.innerText报错
        if (!document.getElementById("v2-journal")) return;
        if (!this.state.trades) return;

        const total = this.state.trades.length;
        const closed = this.state.trades.filter(t => t.status === "CLOSED");
        const wins = closed.filter(t => t.pnl && t.pnl > 0).length;
        const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;
        const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);

        const elTotal = document.getElementById("v2-total-trades");
        const elWinRate = document.getElementById("v2-win-rate");
        const elPnl = document.getElementById("v2-total-pnl");

        if (elTotal) elTotal.innerText = total;
        if (elWinRate) elWinRate.innerText = winRate.toFixed(1) + "%";
        if (elPnl) elPnl.innerText = "$" + totalPnl.toFixed(2);
    }

    showJournalModal() {
        // TODO: 显示完整交易日志的模态框
        alert("交易日志详情功能开发中...\n\n当前统计:\n" + 
              `总交易: ${this.state.trades.length}\n` +
              `待平仓: ${this.state.trades.filter(t => t.status === 'OPEN').length}`);
    }

    showToast(msg, type = "info") {
        const colors = { info: "#90caf9", success: "#66bb6a", error: "#ef5350" };
        let container = document.getElementById("v2-toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "v2-toast-container";
            container.style.cssText = "position:fixed;bottom:80px;right:20px;z-index:99999;";
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.innerText = msg;
        toast.style.cssText = `background:#1e1e1e;border:1px solid ${colors[type]};color:${colors[type]};padding:8px 10px;border-radius:4px;font-size:12px;margin-top:6px;`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = "0";
            toast.style.transition = "opacity 0.3s";
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    // 【新增】代理 Fetch 方法（通过 background.js 绕过 CORS）
    async proxyFetch(url) {
        return new Promise((resolve, reject) => {
            try {
                if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
                    return reject(new Error("Extension Context Invalid"));
                }

                chrome.runtime.sendMessage({ action: "FETCH_DATA", url: url }, (response) => {
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
            } catch(e) { 
                reject(e instanceof Error ? e : new Error(String(e))); 
            }
        });
    }

    // 【新增】获取单个股票/指数数据
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
                    fmt: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`,
                    color: changePct >= 0 ? "#4caf50" : "#ff5252"
                };
            }
            return null;
        } catch (e) {
            console.warn(`Failed to fetch ${symbol}`, e);
            return null;
        }
    }

    // 【新增】获取大盘指数数据
    async fetchMacroData() {
        // 避免频繁请求，5分钟缓存
        if (this.macroCache && (Date.now() - this.macroCache.ts < 300000)) return;
        
        try {
            const [dji, nasdaq, spy] = await Promise.all([
                this.fetchTickerData("^DJI"),   // 道琼斯工业平均指数
                this.fetchTickerData("^IXIC"),  // 纳斯达克综合指数
                this.fetchTickerData("SPY")     // 标普500 ETF
            ]);

            this.macroCache = { 
                dji,
                nasdaq,
                spy,
                ts: Date.now() 
            };
            
            // 更新 UI
            const djiEl = document.getElementById("v2-dji-value");
            const nasdaqEl = document.getElementById("v2-nasdaq-value");
            const spyEl = document.getElementById("v2-spy-value");
            
            if (djiEl && dji) {
                djiEl.innerHTML = `<span style="color:${dji.color}">${dji.fmt}</span>`;
                djiEl.title = `当前: ${dji.price.toFixed(2)}`;
            }
            
            if (nasdaqEl && nasdaq) {
                nasdaqEl.innerHTML = `<span style="color:${nasdaq.color}">${nasdaq.fmt}</span>`;
                nasdaqEl.title = `当前: ${nasdaq.price.toFixed(2)}`;
            }
            
            if (spyEl && spy) {
                spyEl.innerHTML = `<span style="color:${spy.color}">${spy.fmt}</span>`;
                spyEl.title = `当前: ${spy.price.toFixed(2)}`;
            }
            
        } catch(e) {
            console.log("V2 Macro Fetch Err", e);
            const ribbon = document.getElementById("v2-macro-ribbon");
            if(ribbon) {
                ribbon.innerHTML = `<div style='color:orange;font-size:10px;padding:4px;'>大盘数据加载失败: ${e.message}</div>`;
            }
        }
    }
}

// 启动 V2
const startV2Assistant = () => {
    if (!document.querySelector('.ibkr-assistant-v2-panel')) {
        console.log("✅ Starting IBKR Assistant V2...");
        const v2Instance = new TradingAdvisorV2();
        // 设置全局引用，方便按钮调用
        window.v2Assistant = v2Instance;
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startV2Assistant);
} else {
    startV2Assistant();
}
