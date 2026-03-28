const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { HttpsProxyAgent } = require('https-proxy-agent');

class HttpClient {
    constructor(proxyUrl = null) {
        this.jar = new CookieJar();
        this.proxyUrl = proxyUrl;
        
        const config = {
            timeout: 60000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        };

        this.client = axios.create(config);

        // Unified request interceptor for proxy and cookies
        this.client.interceptors.request.use(async (config) => {
            const url = config.url.startsWith('http') ? config.url : `${config.baseURL || ''}${config.url}`;
            
            // Use proxy for all EXCEPT tempmail.lol
            if (this.proxyUrl && !url.includes('tempmail.lol')) {
                config.httpsAgent = new HttpsProxyAgent(this.proxyUrl, { 
                    rejectUnauthorized: false,
                    keepAlive: false // Disabled to avoid socket reuse issues with some proxies
                });
                config.proxy = false;
            } else {
                config.httpsAgent = null;
                config.proxy = false;
            }

            // Add cookies
            const cookieString = await this.jar.getCookieString(url);
            if (cookieString) {
                config.headers['Cookie'] = cookieString;
            }
            return config;
        });

        // Add simple retry logic for network errors
        this.client.interceptors.response.use(null, async (error) => {
            const { config } = error;
            if (!config || !config.retryCount) config.retryCount = 0;
            
            if (config.retryCount < 2 && (error.code === 'ECONNRESET' || error.message.includes('disconnected') || error.message.includes('EPROTO'))) {
                config.retryCount++;
                const delay = config.retryCount * 2000;
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.client(config);
            }
            return Promise.reject(error);
        });

        // Interceptor to save cookies from response
        this.client.interceptors.response.use(async (response) => {
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                const url = response.config.url.startsWith('http') ? response.config.url : `${response.config.baseURL || ''}${response.config.url}`;
                for (const header of (Array.isArray(setCookie) ? setCookie : [setCookie])) {
                    await this.jar.setCookie(header, url);
                }
            }
            return response;
        });
    }

    async get(url, config = {}) {
        return this.client.get(url, config);
    }

    async post(url, data, config = {}) {
        return this.client.post(url, data, config);
    }

    async setCookie(cookieString, url) {
        return this.jar.setCookie(cookieString, url);
    }
}

module.exports = HttpClient;
