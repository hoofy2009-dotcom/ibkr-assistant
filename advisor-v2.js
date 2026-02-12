// IBKR Trading Assistant V2 - Advanced Professional Edition
// 独立于 V1，提供更专业的交易分析功能

console.log("🚀 IBKR Assistant V2: Script loaded!");

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
        
        this.apiKeys = {};
        this.settings = {
            newsApiKey: "",
            finnhubApiKey: ""
        };
        
        this.init();
    }

    async init() {
        console.log("📊 IBKR Assistant V2 Initializing...");
        await this.loadSettings();
        this.createPanel();
        this.startMonitoring();
        this.loadTradeJournal();
        // 【新增】恢复折叠状态
        setTimeout(() => this.restoreCollapsedStates(), 500);
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
                <span class="ibkr-v2-title">🚀 智能顾问 V2 (Pro)</span>
                <div>
                    <button class="ibkr-v2-minimize" title="最小化">_</button>
                    <button class="ibkr-v2-close" title="关闭">✕</button>
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
                <button id="v2-settings" class="v2-btn-settings">⚙️ V2 设置</button>
            </div>

            <!-- 设置模态框 -->
            <div id="v2-settings-modal" class="v2-modal" style="display:none;">
                <div class="v2-modal-content">
                    <div class="v2-modal-header">
                        <span>V2 设置</span>
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
            this.showToast("✅ V2 设置已保存", "success");
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
        
        // 构建增强提示词 - V2 深度分析版本
        const prompt = `
            作为**资深量化分析师 + 基本面研究员**，请对 ${this.state.symbol} 进行深度分析：
            
            【技术面】（量化信号）
            - RSI(14): ${rsi.toFixed(2)} ${rsi < 30 ? '(超卖区)' : rsi > 70 ? '(超买区)' : '(中性)'}
            - MACD: ${macd.histogram.toFixed(3)} ${macd.histogram > 0 ? '(多头趋势)' : '(空头趋势)'}
            - ATR(14): ${atr.toFixed(2)} (波动率指标)
            - 当前价: $${this.state.price.toFixed(2)}
            - 建议止损: $${(this.state.price - atr * 2).toFixed(2)} (基于 2×ATR)
            
            【基本面】（新闻情报）
            最近7天新闻：${newsText}
            
            【催化剂】（财报预期）
            ${earningsText}
            
            【分析要求】
            1. **技术+基本面结合**：不要只看技术指标，必须考虑新闻情绪和财报催化剂
            2. **明确操作建议**：BUY（买入）/ SELL（卖出）/ HOLD（观望）
            3. **风险量化**：1-10分（1=极低风险, 10=极高风险）
            4. **止损/目标位**：基于 ATR 和新闻情绪综合判断
            5. **简洁有力**：150字以内，突出核心逻辑
            
            **核心差异点**：
            - 如果新闻偏空但技术指标超卖 → 可能是"利空出尽"反弹机会
            - 如果财报即将公布且预期良好 → 增加持有信心
            - 如果技术指标超买且新闻炒作过度 → 警惕回调风险
            
            返回JSON格式（不要Markdown代码块）：
            {
                "action": "BUY|SELL|HOLD",
                "confidence": 0.0-1.0,
                "stopLoss": 数字,
                "target": 数字,
                "risk": 1-10,
                "reason": "综合技术面+基本面的核心理由",
                "newsImpact": "positive|negative|neutral",
                "earningsRisk": "high|medium|low"
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
                        { role: "system", content: "你是专业量化分析师，返回有效JSON。" },
                        { role: "user", content: prompt }
                    ],
                    temperature: 0.4,
                    max_tokens: 300
                })
            });

            const data = await response.json();
            let result = data.choices[0].message.content;
            result = result.replace(/```json/g, "").replace(/```/g, "").trim();
            const analysis = JSON.parse(result);

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

            // 显示结果（增强版 - 显示基本面影响）
            box.innerHTML = `
                <div class="v2-analysis-result">
                    <div class="v2-action" style="color: ${analysis.action === 'BUY' ? '#4caf50' : analysis.action === 'SELL' ? '#f44336' : '#aaa'}; font-size: 16px; font-weight: bold; margin-bottom: 8px;">
                        ${analysis.action} (置信度: ${(analysis.confidence * 100).toFixed(0)}%)
                    </div>
                    
                    <div class="v2-levels" style="display: flex; gap: 15px; margin-bottom: 8px; font-size: 11px;">
                        <span>止损: <b style="color: #f44336;">$${analysis.stopLoss}</b></span>
                        <span>目标: <b style="color: #4caf50;">$${analysis.target}</b></span>
                        <span>风险: <b>${analysis.risk}/10</b></span>
                    </div>
                    
                    <div class="v2-fundamentals" style="display: flex; gap: 10px; margin-bottom: 10px; font-size: 10px; padding: 5px; background: rgba(255,255,255,0.05); border-radius: 3px;">
                        <span style="color: ${newsColor[analysis.newsImpact] || '#999'};">
                            ${newsEmoji[analysis.newsImpact] || '➡️'} 新闻: ${analysis.newsImpact || 'neutral'}
                        </span>
                        <span style="color: ${analysis.earningsRisk === 'high' ? '#f44336' : analysis.earningsRisk === 'low' ? '#4caf50' : '#ffa726'};">
                            ${earningsEmoji[analysis.earningsRisk] || '⚡'} 财报风险: ${analysis.earningsRisk || 'medium'}
                        </span>
                    </div>
                    
                    <div class="v2-reason" style="background: rgba(255,255,255,0.03); padding: 8px; border-radius: 4px; font-size: 11px; line-height: 1.4; color: #ddd; margin-bottom: 8px;">
                        ${analysis.reason}
                    </div>
                    
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
        const total = this.state.trades.length;
        const closed = this.state.trades.filter(t => t.status === "CLOSED");
        const wins = closed.filter(t => t.pnl && t.pnl > 0).length;
        const winRate = closed.length > 0 ? (wins / closed.length * 100) : 0;
        const totalPnl = closed.reduce((sum, t) => sum + (t.pnl || 0), 0);

        document.getElementById("v2-total-trades").innerText = total;
        document.getElementById("v2-win-rate").innerText = winRate.toFixed(1) + "%";
        document.getElementById("v2-total-pnl").innerText = "$" + totalPnl.toFixed(2);
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
