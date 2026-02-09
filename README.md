# IBKR Trading Assistant Extension

这是一个简单的 Chrome/Edge 浏览器扩展，用于在 Interactive Brokers (IBKR) 网页版上方显示实时交易策略助手。

## 功能

*   在 IBKR 网站右上方注入一个浮动面板。
*   自动识别网页标题中的股票代码和价格。
*   根据简单的动量策略（当前价格 vs 短期均值）给出买卖建议。

## 安装步骤

1.  打开 Chrome 或 Edge 浏览器。
2.  进入 **扩展程序管理页面** (`chrome://extensions` 或 `edge://extensions`)。
3.  打开右上角的 **"开发者模式" (Developer mode)** 开关。
4.  点击左上角的 **"加载已解压的扩展程序" (Load unpacked)**。
5.  选择本项目文件夹 `d:\project\ibkr-assistant`。
6.  刷新 IBKR 网页 (`https://www.interactivebrokers.com.au/portal/`)，即可看到右上方出现的交易助手面板。

## 注意事项

*   本插件仅为演示框架，策略逻辑非常简单（基于页面打开后的价格波动），**请勿直接用于真实资金交易决策**。
*   IBKR 网页结构经常更新，如果价格抓取失效，可能需要更新 `content.js` 中的选择器逻辑。
*   切勿将真实 API Key（DeepSeek / Gemini 等）写入版本库。`config.js` 中的键位已清空为占位符，请使用本地未纳入版本控制的方式保存密钥。

## Repository Remote
- Primary remote: https://github.com/hoofy2009-dotcom/ibkr-assistant.git
	- When asked to “推送 github”, use this remote (branch: main).
