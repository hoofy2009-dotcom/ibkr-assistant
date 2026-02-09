const AI_CONFIG = {
    // 警告：请勿将此文件分享给他人，填写自己的受限测试密钥
    API_KEY: "__REPLACE_WITH_DEEPSEEK_KEY__",
    API_URL: "https://api.deepseek.com/chat/completions", // DeepSeek standard endpoint
    MODEL: "deepseek-chat",

    // Gemini (replace with your own restricted API key; do NOT commit real keys)
    GEMINI_KEY: "__REPLACE_WITH_YOUR_KEY__",
    // GEMINI_URL: "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent", // Legacy
    GEMINI_URL: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent", // Faster & Standard

    // Other provider endpoints (keys仅本地存储)
    OPENAI_URL: "https://api.openai.com/v1/chat/completions",
    CLAUDE_URL: "https://api.anthropic.com/v1/messages",
    TONGYI_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    DOUBAO_URL: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    GROK_URL: "https://api.x.ai/v1/chat/completions",

    // Default model hints (可按需调整)
    CHATGPT_MODEL: "gpt-4o-mini",
    CLAUDE_MODEL: "claude-3-5-sonnet-20241022",
    TONGYI_MODEL: "qwen-plus",
    DOUBAO_MODEL: "doubao-seed-1-8-251228", // 用户当前可用模型，若切换自建 endpoint 用 ep-xxxxx
    GROK_MODEL: "grok-2-latest"
};