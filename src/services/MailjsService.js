const Mailjs = require("@cemalgnlts/mailjs");

class MailjsService {
    constructor(logger) {
        this.logger = logger;
        this.mailjs = new Mailjs();
    }

    /**
     * Create a new random account on mail.tm
     * @returns {Promise<{address: string, password: string}>}
     */
    async createInbox() {
        this.logger.info('Creating Mailjs (mail.tm) account...');
        try {
            const acc = await this.mailjs.createOneAccount();
            if (!acc.status) {
                throw new Error(`Failed to create Mailjs account: ${acc.message}`);
            }
            
            this.logger.info(`Mailjs account created: ${acc.data.username}`);
            return {
                address: acc.data.username,
                password: acc.data.password
            };
        } catch (error) {
            this.logger.error('Error creating Mailjs inbox', error);
            throw error;
        }
    }

    /**
     * Login to an existing account
     * @param {string} email 
     * @param {string} password 
     */
    async login(email, password) {
        this.logger.info(`Logging into Mailjs account: ${email}`);
        const result = await this.mailjs.login(email, password);
        if (!result.status) {
            throw new Error(`Failed to login to Mailjs: ${result.message}`);
        }
    }

    /**
     * Wait for an email with specific subject/intro
     * @param {string} subjectFilter 
     * @param {number} maxRetries 
     * @returns {Promise<{body: string, id: string}>}
     */
    async waitForEmail(subjectFilter, maxRetries = 20) {
        this.logger.info(`Waiting for email with subject containing: "${subjectFilter}" (mail.tm)...`);
        
        for (let i = 0; i < maxRetries; i++) {
            const res = await this.mailjs.getMessages();
            
            if (res.status && res.data && res.data.length > 0) {
                // Check messages
                const msg = res.data.find(m => m.subject.includes(subjectFilter) || m.intro.includes(subjectFilter));
                if (msg) {
                    this.logger.info('Verification email found! Fetching full content...');
                    const fullMsg = await this.mailjs.getMessage(msg.id);
                    if (fullMsg.status) {
                        return {
                            id: msg.id,
                            body: fullMsg.data.text || fullMsg.data.html || '',
                            html: fullMsg.data.html || ''
                        };
                    }
                }
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        throw new Error('Timeout waiting for verification email on mail.tm');
    }

    /**
     * Extract Blink magic token URL from email body
     * @param {string} emailBody 
     * @returns {string|null}
     */
    extractMagicTokenUrl(emailBody) {
        // Sign In to Blink https://blink.new/auth?magic_token=...&email=...
        const regex = /https:\/\/blink\.new\/auth\?magic_token=[^ \n\r\t"]+/;
        const match = emailBody.match(regex);
        return match ? match[0] : null;
    }
}

module.exports = MailjsService;
