# IBKR Trading Assistant - 双智能顾问系统

一个强大的 Chrome/Edge 浏览器扩展，为 Interactive Brokers (IBKR) 网页版提供**双重智能交易助手**。

## 🎯 双剑合璧

本插件同时提供两个互补的智能助手，满足不同交易需求：

### 🏃 **闪电侠** (快速日内交易专家)
- ⚡ 10-30秒智能刷新(根据波动率自动调整)
- 📊 Watchlist多股票实时追踪(14点历史)
- 🎯 做T策略信号(基于ATR波动率)
- 🔔 即时声音通知(触发信号立即提醒)
- 📈 技术指标趋势箭头(↗️↘️➡️)

### 🧠 **智囊团** (深度分析战略家)
- 📰 Finnhub实时新闻+AI情绪分析(😊😐😢)
- 📅 财报倒计时+历史表现(🔥今日/⚠️3天预警)
- 🏢 同行业对比(P/E, ROE vs 行业均值)
- 📝 交易日志+业绩统计(胜率、盈亏)
- 🤖 多维度AI综合分析(整合技术+新闻+财报)

**💡 使用建议**: 开盘前用智囊团制定策略 → 开盘后用闪电侠执行操作

---

## 功能特性

**共同功能**:
*   实时价格监控(支持盘前盘后)
*   技术指标分析(RSI, MACD, ATR)
*   动态止损计算(基于ATR)
*   宏观指标监控(SPY, VIX)
*   AI智能分析(多模型支持)

**🏃 闪电侠独有**:
*   智能刷新频率(10s/20s/30s自适应)
*   Watchlist历史追踪(14个价格点)
*   做T策略信号(低吸高抛提醒)
*   双音调声音通知(800Hz/600Hz)
*   技术指标趋势箭头(一目了然)

**🧠 智囊团独有**:
*   Finnhub实时新闻(比Yahoo RSS更快)
*   AI新闻情绪分析(批量分析正负面)
*   财报倒计时(今日/3天内预警)
*   同行业估值对比(vs行业均值)
*   历史财报表现(4季度EPS惊喜率)
*   交易日志系统(记录决策+业绩统计)

📖 **详细功能说明**: 查看 [V2_README.md](./V2_README.md)

## 安装步骤

### 方式一: 从 GitHub 下载
1. 克隆或下载本项目: 
   ```bash
   git clone https://github.com/hoofy2009-dotcom/ibkr-assistant.git
   ```
2. 打开 Chrome 或 Edge 浏览器
3. 进入 **扩展程序管理页面** (`chrome://extensions` 或 `edge://extensions`)
4. 打开右上角的 **"开发者模式" (Developer mode)** 开关
5. 点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**
6. 选择项目文件夹 `ibkr-assistant-main`
7. 刷新 IBKR 网页 (`https://www.interactivebrokers.com.au/portal/`)

### 方式二: 配置 Finnhub API (智囊团功能)
1. 访问 [Finnhub.io](https://finnhub.io) 注册免费账户
2. 获取 API Key (免费 tier: 60 calls/分钟)
3. 在 IBKR 页面右侧智囊团面板点击 **"⚙️ 设置"**
4. 填入 Finnhub API Key 并保存

**注意**: 闪电侠无需 API Key 即可使用，智囊团需要 Finnhub API 才能启用新闻和财报功能。

## 注意事项

*   **风险提示**: 本插件提供的策略建议仅供参考，**请勿直接用于真实资金交易决策**。交易有风险，投资需谨慎。
*   **数据来源**: 价格数据来自 Yahoo Finance，新闻和财报来自 Finnhub API，可能存在延迟或错误。
*   **API 限制**: Finnhub 免费 tier 为 60 calls/分钟，正常使用绰绰有余。
*   **隐私保护**: 所有数据存储在浏览器本地，不会上传到任何服务器。
*   **页面兼容**: IBKR 网页结构可能更新，如果价格抓取失效，需要更新选择器逻辑。
*   **API Keys**: 切勿将真实 API Key 提交到版本库。使用本地配置或环境变量保存。

## 使用场景

| 交易类型 | 推荐助手 | 核心优势 |
|---------|---------|---------|
| 日内做T | 🏃 闪电侠 | 秒级刷新 + 波动率信号 + 即时通知 |
| 短线波段 | 🏃 闪电侠 | Watchlist追踪 + 趋势箭头 |
| 持仓决策 | 🧠 智囊团 | 新闻情绪 + 财报分析 + AI建议 |
| 财报前后 | 🧠 智囊团 | 倒计时 + 历史表现 + 风险评估 |
| 行业研究 | 🧠 智囊团 | 同行业对比 + 多维度数据 |

## 技术栈

- **前端**: Vanilla JavaScript (无框架依赖)
- **API**: Yahoo Finance, Finnhub, DeepSeek AI
- **存储**: Chrome Storage API (本地存储)
- **通知**: Chrome Notifications API + Web Audio API
- **架构**: Content Script + Background Service Worker

## Repository Remote
- Primary remote: https://github.com/hoofy2009-dotcom/ibkr-assistant.git
	- When asked to “推送 github”, use this remote (branch: main).
