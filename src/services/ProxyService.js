class ProxyService {
    constructor(proxies, logger) {
        this.proxies = proxies;
        this.logger = logger;
        this.index = 0;
    }

    getNext() {
        if (this.proxies.length === 0) return null;
        const proxy = this.proxies[this.index];
        this.index = (this.index + 1) % this.proxies.length;
        this.logger.info(`Using proxy: ${proxy}`);
        return proxy;
    }

    getProxiesCount() {
        return this.proxies.length;
    }
}

module.exports = ProxyService;
