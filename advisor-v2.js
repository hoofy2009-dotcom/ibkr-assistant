// IBKR Trading Assistant V2 - Advanced Professional Edition
// 独立于 V1，提供更专业的交易分析功能

console.log("🚀 IBKR Assistant V2: Script loaded!");

class TradingAdvisorV2 {
    constructor() {
        this.panel = null;
        this.state = {
            symbol: "",
            price: 0,
            history: [], // 价格历史（最多 100 条）
            volume: [],
            trades: [], // 交易日志
            lastUrl: ""
        };
        
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
                <button class="ibkr-v2-close">✕</button>
            </div>
            
            <div class="ibkr-v2-content">
                <!-- 实时新闻 -->
                <div class="v2-section">
                    <div class="v2-section-title">📰 实时新闻 (Finnhub)</div>
                    <div id="v2-news" class="v2-news-list">配置 API Key 以启用...</div>
                </div>

                <!-- 财报日历 -->
                <div class="v2-section">
                    <div class="v2-section-title">📅 财报日历</div>
                    <div id="v2-earnings" class="v2-earnings-box">加载中...</div>
                </div>

                <!-- AI 分析 V2 -->
                <div class="v2-section">
                    <div class="v2-section-title">🤖 AI 深度分析</div>
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
        this.attachEventListeners();
    }

    attachEventListeners() {
        document.querySelector(".ibkr-v2-close").onclick = () => this.panel.remove();
        document.getElementById("v2-analyze").onclick = () => this.runAdvancedAnalysis();
        document.getElementById("v2-settings").onclick = () => this.toggleSettings();
        document.getElementById("v2-save-settings").onclick = () => this.saveSettings();
        document.querySelector(".v2-modal-close").onclick = () => this.toggleSettings();
        document.getElementById("v2-view-journal").onclick = () => this.showJournalModal();
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
                const newsHtml = data.slice(0, 5).map(item => `
                    <div class="v2-news-item">
                        <div class="v2-news-title">${item.headline}</div>
                        <div class="v2-news-meta">${new Date(item.datetime * 1000).toLocaleDateString()} | ${item.source}</div>
                    </div>
                `).join("");
                document.getElementById("v2-news").innerHTML = newsHtml;
            } else {
                document.getElementById("v2-news").innerHTML = "暂无新闻";
            }
        } catch (e) {
            console.error("Finnhub news error:", e);
            document.getElementById("v2-news").innerHTML = "新闻加载失败";
        }
    }

    // === 财报日历 (Finnhub) ===
    async fetchEarnings(symbol) {
        const apiKey = this.settings.finnhubApiKey;
        if (!apiKey) {
            document.getElementById("v2-earnings").innerHTML = "请配置 Finnhub API Key";
            return;
        }

        try {
            const url = `https://finnhub.io/api/v1/calendar/earnings?symbol=${symbol}&token=${apiKey}`;
            const response = await fetch(url);
            const data = await response.json();
            
            if (data && data.earningsCalendar && data.earningsCalendar.length > 0) {
                const earnings = data.earningsCalendar[0];
                const html = `
                    <div class="v2-earnings-item">
                        <div>📅 日期: <b>${earnings.date || 'TBA'}</b></div>
                        <div>💰 EPS 预期: <b>${earnings.epsEstimate || 'N/A'}</b></div>
                        <div>📊 营收预期: <b>${earnings.revenueEstimate || 'N/A'}</b></div>
                    </div>
                `;
                document.getElementById("v2-earnings").innerHTML = html;
            } else {
                document.getElementById("v2-earnings").innerHTML = "暂无财报数据";
            }
        } catch (e) {
            console.error("Finnhub earnings error:", e);
            document.getElementById("v2-earnings").innerHTML = "财报数据加载失败";
        }
    }

    // === AI 深度分析 ===
    async runAdvancedAnalysis() {
        const btn = document.getElementById("v2-analyze");
        const box = document.getElementById("v2-analysis");
        
        btn.disabled = true;
        btn.innerText = "分析中...";
        box.innerText = "正在整合技术指标、新闻、财报进行深度分析...";

        // 收集技术指标数据
        const rsi = parseFloat(document.getElementById("v2-rsi").innerText) || 50;
        const macd = parseFloat(document.getElementById("v2-macd").innerText) || 0;
        const atr = parseFloat(document.getElementById("v2-atr").innerText) || 0;
        
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
            newsText = "暂无最新新闻";
        }

        // 收集财报数据
        const earningsBox = document.getElementById("v2-earnings");
        const earningsText = earningsBox.innerText || "暂无财报信息";
        
        // 构建增强提示词 - V2 深度分析版本
        const prompt = `
            作为**资深量化分析师 + 基本面研究员**，请对 ${this.state.symbol} 进行深度分析：
            
            【技术面】（量化信号）
            - RSI(14): ${rsi.toFixed(2)} ${rsi < 30 ? '(超卖区)' : rsi > 70 ? '(超买区)' : '(中性)'}
            - MACD: ${macd.toFixed(3)} ${macd > 0 ? '(多头趋势)' : '(空头趋势)'}
            - ATR(14): ${atr.toFixed(2)} (波动率指标)
            - 当前价: $${this.state.price}
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
        new TradingAdvisorV2();
    }
};

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', startV2Assistant);
} else {
    startV2Assistant();
}
