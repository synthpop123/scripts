/**
 * LLM Models Monitor for Cloudflare Workers
 * 
 * 1. 修改 PROVIDERS 配置；
 * 2. 按需修改 CONFIG 配置；
 * 3. 按需添加提供商 API Key 至环境变量；
 * 4. 添加 Telegram 通知环境变量：
 *    - TELEGRAM_BOT_TOKEN
 *    - TELEGRAM_CHAT_ID
 * 5. 添加 KV 绑定，名称随意，命名空间为 MODEL_MONITOR；
 * 6. 部署到 Cloudflare Workers；
 * 7. 配置 CRON 定时任务（可选）；
 * 8. 访问 xxx.workers.dev/monitor 手动触发监控；
 * 9. 访问 xxx.workers.dev/status 查看当前状态；
 * 10. 访问 xxx.workers.dev/clear 清除所有缓存；
 * 11. 访问 xxx.workers.dev/health 健康检查。
 */

// ======================== 配置管理 ========================

/**
 * 提供商配置
 * @typedef {Object} Provider
 * @property {string} id - 提供商唯一标识
 * @property {string} name - 提供商名称
 * @property {string} endpoint - API端点
 * @property {Object} headers - 请求头配置
 * @property {Function} [parseResponse] - 自定义响应解析函数
 */

const PROVIDERS = [
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/models',
    headers: {
      'Authorization': 'Bearer {{OPENAI_API_KEY}}'
    }
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    endpoint: 'https://api.anthropic.com/v1/models?limit=100',
    headers: {
      'x-api-key': '{{ANTHROPIC_API_KEY}}',
      'anthropic-version': '2023-06-01'
    }
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/models',
    headers: {
      'Authorization': 'Bearer {{DEEPSEEK_API_KEY}}'
    }
  },
  {
    id: 'nebius',
    name: 'Nebius',
    endpoint: 'https://api.studio.nebius.com/v1/models',
    headers: {
      'Authorization': 'Bearer {{NEBIUS_API_KEY}}'
    }
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    endpoint: 'https://api.cerebras.ai/v1/models',
    headers: {
      'Authorization': 'Bearer {{CEREBRAS_API_KEY}}'
    }
  },
  {
    id: 'novita',
    name: 'Novita',
    endpoint: 'https://api.novita.ai/openai/v1/models',
    headers: {
      'Authorization': 'Bearer {{NOVITA_API_KEY}}'
    }
  },
  {
    id: 'mistral',
    name: 'Mistral',
    endpoint: 'https://api.mistral.ai/v1/models',
    headers: {
      'Authorization': 'Bearer {{MISTRAL_API_KEY}}'
    }
  },
  {
    id: 'xai',
    name: 'xAI',
    endpoint: 'https://api.x.ai/v1/models',
    headers: {
      'Authorization': 'Bearer {{XAI_API_KEY}}'
    }
  },
  {
    id: 'groq',
    name: 'Groq',
    endpoint: 'https://api.groq.com/openai/v1/models',
    headers: {
      'Authorization': 'Bearer {{GROQ_API_KEY}}'
    }
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    endpoint: 'https://api.siliconflow.cn/v1/models',
    headers: {
      'Authorization': 'Bearer {{SILICONFLOW_API_KEY}}'
    }
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/models',
    headers: {
      'Authorization': 'Bearer {{OPENROUTER_API_KEY}}'
    }
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    endpoint: 'https://ai-gateway.vercel.sh/v1/models',
    headers: {
      'Authorization': 'Bearer {{VERCEL_API_KEY}}'
    }
  },
  {
    id: 'akash',
    name: 'Akash',
    endpoint: 'https://chatapi.akash.network/api/v1/models',
    headers: {
      'Authorization': 'Bearer {{AKASH_API_KEY}}'
    }
  },
  {
    id: 'v0',
    name: 'v0',
    endpoint: 'https://api.v0.dev/v1/models',
    headers: {
      'Authorization': 'Bearer {{V0_API_KEY}}'
    }
  },
  {
    id: 'bigmodel',
    name: '智谱',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/models',
    headers: {
      'Authorization': 'Bearer {{BIGMODEL_API_KEY}}'
    }
  },
  {
    id: 'gemini',
    name: 'Gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    headers: {
      'Authorization': 'Bearer {{GEMINI_API_KEY}}'
    }
  }
];

// 配置常量
const CONFIG = {
  REQUEST_TIMEOUT: 10000, // 10秒超时
  BATCH_SIZE: 5, // 并发请求批次大小
  BATCH_DELAY: 1000, // 批次间延迟
  MAX_RETRIES: 0, // 最大重试次数
  RETRY_DELAY: 2000, // 重试延迟
};

// ======================== 工具类 ========================

class Logger {
  static log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    console.log(JSON.stringify({
      timestamp,
      level,
      message,
      ...data
    }));
  }

  static info(message, data) {
    this.log('INFO', message, data);
  }

  static error(message, data) {
    this.log('ERROR', message, data);
  }

  static debug(message, data) {
    this.log('DEBUG', message, data);
  }
}

class EnvironmentHelper {
  /**
   * 替换模板字符串中的环境变量
   */
  static replaceEnvVars(template, env) {
    if (typeof template !== 'string') return template;
    
    return template.replace(/\{\{([^}]+)\}\}/g, (match, envKey) => {
      const value = env[envKey];
      if (!value) {
        Logger.debug(`Environment variable ${envKey} not found`);
      }
      return value || match;
    });
  }

  /**
   * 检查提供商是否已配置
   */
  static isProviderConfigured(provider, env) {
    const requiredEnvVars = this.extractEnvVars(provider.headers);
    return requiredEnvVars.every(key => !!env[key]);
  }

  /**
   * 提取需要的环境变量名
   */
  static extractEnvVars(headers) {
    const vars = [];
    for (const value of Object.values(headers)) {
      if (typeof value === 'string') {
        const matches = value.matchAll(/\{\{([^}]+)\}\}/g);
        for (const match of matches) {
          vars.push(match[1]);
        }
      }
    }
    return vars;
  }
}

// ======================== 核心业务逻辑 ========================

class ModelFetcher {
  constructor(provider, env) {
    this.provider = provider;
    this.env = env;
  }

  /**
   * 获取模型列表，支持重试
   */
  async fetch(retries = CONFIG.MAX_RETRIES) {
    try {
      const headers = this.prepareHeaders();
      const response = await this.makeRequest(headers);
      
      if (!response.ok) {
        throw new Error(await this.formatError(response));
      }
      
      const data = await response.json();
      const models = this.parseModels(data);
      
      return {
        success: true,
        provider: this.provider.id,
        models,
        count: models.length,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      if (retries > 0) {
        Logger.info(`Retrying ${this.provider.name}`, { retriesLeft: retries - 1 });
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
        return this.fetch(retries - 1);
      }
      
      return {
        success: false,
        provider: this.provider.id,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 准备请求头
   */
  prepareHeaders() {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; LLMModelMonitor/1.0)',
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    for (const [key, value] of Object.entries(this.provider.headers)) {
      headers[key] = EnvironmentHelper.replaceEnvVars(value, this.env);
    }

    return headers;
  }

  /**
   * 发起HTTP请求
   */
  async makeRequest(headers) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);

    try {
      const response = await fetch(this.provider.endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 格式化错误信息
   */
  async formatError(response) {
    let errorDetails = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorDetails += ` - ${errorBody.substring(0, 200)}`;
      }
    } catch (e) {
      // 忽略错误体读取失败
    }
    return errorDetails;
  }

  /**
   * 解析模型数据
   */
  parseModels(data) {
    // 默认解析逻辑
    let models = [];
    
    if (data.data && Array.isArray(data.data)) {
      // OpenAI格式
      models = data.data.map(m => ({
        id: m.id,
        name: m.id,
        created: m.created,
        owned_by: m.owned_by
      }));
    } else if (data.models && Array.isArray(data.models)) {
      // Anthropic格式
      models = data.models.map(m => ({
        id: m.model_id || m.id,
        name: m.display_name || m.name || m.model_id || m.id,
        created: m.created_at || m.created,
        owned_by: this.provider.name
      }));
    } else if (Array.isArray(data)) {
      // 直接数组格式
      models = data.map(m => ({
        id: m.id || m.model_id || m.name,
        name: m.name || m.model_name || m.id,
        created: m.created || m.created_at,
        owned_by: m.owned_by || this.provider.name
      }));
    }

    return models;
  }
}

class ModelComparator {
  /**
   * 比较新旧模型列表差异
   */
  static compare(oldData, newData) {
    if (!oldData || !oldData.models) {
      return {
        added: newData.models || [],
        removed: [],
        isFirstTime: true
      };
    }
    
    const oldIds = new Set(oldData.models.map(m => m.id));
    const newIds = new Set(newData.models.map(m => m.id));
    
    const added = newData.models.filter(m => !oldIds.has(m.id));
    const removed = oldData.models.filter(m => !newIds.has(m.id));
    
    return {
      added,
      removed,
      isFirstTime: false,
      hasChanges: added.length > 0 || removed.length > 0
    };
  }
}

class NotificationService {
  constructor(env) {
    this.env = env;
    this.botToken = env.TELEGRAM_BOT_TOKEN;
    this.chatId = env.TELEGRAM_CHAT_ID;
  }

  /**
   * 发送Telegram通知
   */
  async send(message) {
    if (!this.isConfigured()) {
      Logger.info('Telegram not configured, skipping notification');
      return;
    }

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API error: ${response.status}`);
      }
    } catch (error) {
      Logger.error('Failed to send Telegram notification', { error: error.message });
    }
  }

  /**
   * 检查是否已配置
   */
  isConfigured() {
    return !!(this.botToken && this.chatId);
  }

  /**
   * 格式化模型变更通知
   */
  formatChangeNotification(provider, changes, newData) {
    const emoji = changes.isFirstTime ? '🆕' : '🔔';
    let message = `${emoji} <b>模型提供商: ${provider.name}</b>\n\n`;
    
    if (changes.isFirstTime) {
      message += `✅ <b>首次监控</b>\n`;
      message += `📊 当前模型数: ${newData.count}\n`;
    } else {
      if (changes.added.length > 0) {
        message += `<b>➕ 新增模型 (${changes.added.length}):</b>\n`;
        changes.added.forEach(model => {
          message += `  • ${model.name || model.id}\n`;
        });
        message += '\n';
      }
      
      if (changes.removed.length > 0) {
        message += `<b>➖ 移除模型 (${changes.removed.length}):</b>\n`;
        changes.removed.forEach(model => {
          message += `  • ${model.name || model.id}\n`;
        });
        message += '\n';
      }
      
      message += `📊 当前模型总数: ${newData.count}\n`;
    }
    
    message += `\n⏰ 更新时间: ${this.formatTime()}`;
    
    return message;
  }

  /**
   * 格式化错误通知
   */
  formatErrorNotification(provider, errorData) {
    let message = `❌ <b>监控失败: ${provider.name}</b>\n\n`;
    message += `⚠️ <b>错误:</b>\n<code>${errorData.error}</code>\n\n`;
    
    const requiredVars = EnvironmentHelper.extractEnvVars(provider.headers);
    if (requiredVars.length > 0) {
      message += `🔑 <b>需要配置:</b>\n`;
      requiredVars.forEach(v => {
        message += `  • ${v}\n`;
      });
    }
    
    message += `\n⏰ 时间: ${this.formatTime()}`;
    
    return message;
  }

  /**
   * 格式化时间
   */
  formatTime() {
    return new Date().toLocaleString('zh-CN', { 
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}

class StorageService {
  constructor(kv) {
    this.kv = kv;
  }

  /**
   * 获取存储的模型数据
   */
  async getModelData(providerId) {
    const key = `models_${providerId}`;
    const data = await this.kv.get(key);
    return data ? JSON.parse(data) : null;
  }

  /**
   * 保存模型数据
   */
  async saveModelData(providerId, data) {
    const key = `models_${providerId}`;
    await this.kv.put(key, JSON.stringify(data));
  }

  /**
   * 删除模型数据
   */
  async deleteModelData(providerId) {
    const key = `models_${providerId}`;
    await this.kv.delete(key);
  }

  /**
   * 清除所有数据
   */
  async clearAll(providers) {
    const promises = providers.map(p => this.deleteModelData(p.id));
    await Promise.all(promises);
  }
}

// ======================== 监控协调器 ========================

class MonitorOrchestrator {
  constructor(env) {
    this.env = env;
    this.storage = new StorageService(env.MODEL_MONITOR);
    this.notifier = new NotificationService(env);
  }

  /**
   * 执行监控
   */
  async execute() {
    const results = [];
    const configuredProviders = this.getConfiguredProviders();
    
    Logger.info('Starting models monitoring', { 
      providers: configuredProviders.length 
    });

    // 批量并发处理
    const batches = this.createBatches(configuredProviders, CONFIG.BATCH_SIZE);
    
    for (const batch of batches) {
      const batchResults = await this.processBatch(batch);
      results.push(...batchResults);
      
      // 批次间延迟
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.BATCH_DELAY));
      }
    }

    Logger.info('Models monitoring completed', { 
      total: results.length,
      successful: results.filter(r => r.success).length 
    });

    return results;
  }

  /**
   * 获取已配置的提供商
   */
  getConfiguredProviders() {
    return PROVIDERS.filter(provider => {
      const isConfigured = EnvironmentHelper.isProviderConfigured(provider, this.env);
      if (!isConfigured) {
        const requiredVars = EnvironmentHelper.extractEnvVars(provider.headers);
        Logger.debug(`Skipping ${provider.name}`, { 
          missingVars: requiredVars 
        });
      }
      return isConfigured;
    });
  }

  /**
   * 创建批次
   */
  createBatches(items, batchSize) {
    const batches = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * 处理批次
   */
  async processBatch(providers) {
    const promises = providers.map(provider => this.processProvider(provider));
    return Promise.all(promises);
  }

  /**
   * 处理单个提供商
   */
  async processProvider(provider) {
    try {
      Logger.info(`Processing ${provider.name}`);
      
      // 获取新数据
      const fetcher = new ModelFetcher(provider, this.env);
      const newData = await fetcher.fetch();
      
      if (!newData.success) {
        // 发送错误通知
        const errorMessage = this.notifier.formatErrorNotification(provider, newData);
        await this.notifier.send(errorMessage);
        return newData;
      }
      
      // 获取旧数据并比较
      const oldData = await this.storage.getModelData(provider.id);
      const changes = ModelComparator.compare(oldData, newData);
      
      // 如果有变化，发送通知并保存
      if (changes.isFirstTime || changes.hasChanges) {
        const notification = this.notifier.formatChangeNotification(provider, changes, newData);
        await this.notifier.send(notification);
        await this.storage.saveModelData(provider.id, newData);
      }
      
      return {
        ...newData,
        changes
      };
      
    } catch (error) {
      Logger.error(`Error processing ${provider.name}`, { 
        error: error.message 
      });
      
      return {
        success: false,
        provider: provider.id,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * 获取当前状态
   */
  async getStatus() {
    const status = {};
    
    for (const provider of PROVIDERS) {
      const data = await this.storage.getModelData(provider.id);
      
      if (data) {
        status[provider.id] = {
          name: provider.name,
          count: data.count,
          lastUpdate: data.timestamp,
          success: data.success,
          configured: EnvironmentHelper.isProviderConfigured(provider, this.env)
        };
      } else {
        status[provider.id] = {
          name: provider.name,
          configured: EnvironmentHelper.isProviderConfigured(provider, this.env),
          status: 'not_monitored'
        };
      }
    }
    
    return status;
  }
}

// ======================== HTTP路由处理 ========================

class Router {
  constructor(env) {
    this.env = env;
    this.orchestrator = new MonitorOrchestrator(env);
    this.storage = new StorageService(env.MODEL_MONITOR);
  }

  /**
   * 处理请求
   */
  async handle(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // 路由映射
    const routes = {
      'GET /': () => this.handleIndex(),
      'GET /monitor': () => this.handleMonitor(),
      'GET /status': () => this.handleStatus(),
      'POST /clear': () => this.handleClear(),
      'GET /health': () => this.handleHealth(),
    };

    const routeKey = `${method} ${path}`;
    const handler = routes[routeKey];

    if (handler) {
      return handler();
    }

    return this.notFound();
  }

  /**
   * 首页
   */
  handleIndex() {
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM Models Monitor</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            background: white;
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 {
            color: #333;
            margin-bottom: 8px;
        }
        .subtitle {
            color: #666;
            margin-bottom: 32px;
        }
        .endpoints {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 24px;
        }
        .endpoint {
            display: flex;
            align-items: center;
            margin-bottom: 16px;
            padding: 12px;
            background: white;
            border-radius: 6px;
            transition: transform 0.2s;
        }
        .endpoint:hover {
            transform: translateX(4px);
        }
        .method {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 12px;
            margin-right: 12px;
            min-width: 50px;
            text-align: center;
        }
        .method.get { background: #e3f2fd; color: #1976d2; }
        .method.post { background: #e8f5e9; color: #388e3c; }
        .path {
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            color: #333;
            font-weight: 500;
            margin-right: 16px;
        }
        .description {
            color: #666;
            font-size: 14px;
        }
        .footer {
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            color: #999;
            font-size: 14px;
        }
        a {
            color: #667eea;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 LLM Models Monitor</h1>
        <p class="subtitle">Monitor the model list changes of major LLM providers</p>
        
        <div class="endpoints">
            <h3>Endpoints</h3>
            
            <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/monitor</span>
                <span class="description">Manually trigger model monitoring</span>
            </div>
            
            <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/status</span>
                <span class="description">View current monitoring status</span>
            </div>
            
            <div class="endpoint">
                <span class="method post">POST</span>
                <span class="path">/clear</span>
                <span class="description">Clear all cached data</span>
            </div>
            
            <div class="endpoint">
                <span class="method get">GET</span>
                <span class="path">/health</span>
                <span class="description">Health check</span>
            </div>
        </div>
    </div>
</body>
</html>
    `;
    
    return new Response(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }

  /**
   * 手动监控
   */
  async handleMonitor() {
    const results = await this.orchestrator.execute();
    
    return this.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary: {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        changed: results.filter(r => r.changes && r.changes.hasChanges).length
      },
      results
    });
  }

  /**
   * 状态查询
   */
  async handleStatus() {
    const status = await this.orchestrator.getStatus();
    
    return this.json({
      success: true,
      timestamp: new Date().toISOString(),
      providers: status
    });
  }

  /**
   * 清除缓存
   */
  async handleClear() {
    await this.storage.clearAll(PROVIDERS);
    
    return this.json({
      success: true,
      message: 'All cached data cleared',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * 健康检查
   */
  handleHealth() {
    return this.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '2.0.0'
    });
  }

  /**
   * 404响应
   */
  notFound() {
    return this.json({
      error: 'Not Found',
      message: 'The requested endpoint does not exist'
    }, 404);
  }

  /**
   * JSON响应助手
   */
  json(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
  }
}

// ======================== Worker入口 ========================

export default {
  /**
   * HTTP请求处理
   */
  async fetch(request, env, ctx) {
    const router = new Router(env);
    
    try {
      return await router.handle(request);
    } catch (error) {
      Logger.error('Unhandled error', { error: error.message });
      
      return new Response(JSON.stringify({
        error: 'Internal Server Error',
        message: error.message
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  },
  
  /**
   * Cron定时任务处理
   */
  async scheduled(event, env, ctx) {
    Logger.info('Scheduled monitoring started', {
      cron: event.cron,
      scheduledTime: event.scheduledTime
    });
    
    try {
      const orchestrator = new MonitorOrchestrator(env);
      await orchestrator.execute();
      Logger.info('Scheduled monitoring completed');
    } catch (error) {
      Logger.error('Scheduled monitoring failed', { 
        error: error.message 
      });
    }
  }
};
