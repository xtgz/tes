const fs = require('fs');
const path = require('path');
const HttpClient = require('./utils/HttpClient');
const MailjsService = require('./services/MailjsService');
const BlinkAuthService = require('./services/BlinkAuthService');
const StripePaymentService = require('./services/StripePaymentService');
const { faker } = require('@faker-js/faker');

class BlinkAutoBot {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
    }

    async run() {
        this.logger.info(`Starting Blink Auto Bot in REGISTRATION mode with ${this.config.credits.length} cards...`);
        for (const card of this.config.credits) {
            try {
                await this.processCard(card);
            } catch (error) {
                this.logger.error(`Failed to process card ${card.number}`, error);
            }
        }
        
        this.logger.info('All tasks processed.');
    }

    async processCard(card) {
        this.logger.info(`--- Processing Card: ${card.number} ---`);
        
        const proxy = this.config.proxyService ? this.config.proxyService.getNext() : null;
        const httpClient = new HttpClient(proxy);
        
        const mailjs = new MailjsService(this.logger);
        const blinkAuth = new BlinkAuthService(httpClient, this.logger);
        const stripePayment = new StripePaymentService(httpClient, this.logger);

        // 1. Create temp email
        const inbox = await mailjs.createInbox();
        
        // 2. Send magic link
        await blinkAuth.sendMagicLink(inbox.address);
        
        // 3. Wait for email
        const email = await mailjs.waitForEmail('Sign in to Blink');
        
        // 4. Extract and verify magic link
        const magicTokenUrl = mailjs.extractMagicTokenUrl(email.body || email.html);
        if (!magicTokenUrl) {
            throw new Error('Could not find magic token URL in email');
        }
        const tokens = await blinkAuth.verifyMagicToken(magicTokenUrl);
        
        // 5. Get checkout URL and process payment
        const checkoutUrl = await blinkAuth.getCheckoutSession();
        await stripePayment.processStripeCheckout(checkoutUrl, card);
        
        // 6. Refresh Firebase token to reflect subscription status
        await blinkAuth.refreshFirebaseToken();
        
        // 7. Finalize session (Migrate + Session Data + Agent + API Key)
        const sessionInfo = await this.finalizeAccountSession(blinkAuth);
        
        // 7. Save success data
        this.saveAccount({
            email: inbox.address,
            emailPassword: inbox.password,
            idToken: blinkAuth.idToken,
            firebaseRefreshToken: blinkAuth.firebaseRefreshToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken, // This is the App refresh token
            blinkApiKey: sessionInfo.blinkApiKey,
            plan: sessionInfo.plan,
            credits: sessionInfo.credits,
            card: card.number,
            workspaceId: blinkAuth.workspaceId,
            workspaceSlug: blinkAuth.workspaceSlug,
            timestamp: new Date().toISOString()
        });
        
        this.logger.success(`Account created and paid successfully: ${email.metadata?.address || inbox.address}`);
    }

    async finalizeAccountSession(blinkAuth) {
        let blinkApiKey = null;
        
        // 1. Migrate credits (ensures Pro status is active in DB)
        await blinkAuth.migrateCredits();
        
        // 2. Fetch and log session data
        const sessionData = await blinkAuth.getSessionData();
        if (sessionData && sessionData.user) {
            this.logger.info(`Session User: ${sessionData.user.name} (${sessionData.user.email})`);
            this.logger.info(`Workspace: ${sessionData.workspace?.name} (${sessionData.workspace?.slug})`);
            this.logger.info(`Plan: ${sessionData.workspace?.tier} | Credits: ${sessionData.workspace?.usage?.billing_period_credits_limit}`);
            
            // 3. Create initial agent automatically
            const agentName = `agent-${faker.word.adjective()}-${faker.word.noun()}`.toLowerCase();
            const agent = await blinkAuth.createAgent(sessionData.workspace.id, agentName);
            
            if (agent && agent.id) {
                // 4. Wait for provisioning with retry logic (resilience against 503 errors)
                this.logger.info(`⏳ Waiting for agent ${agent.id} to provision...`);
                let health = null;
                const maxRetries = 5;
                
                for (let i = 0; i < maxRetries; i++) {
                    const waitTime = i === 0 ? 12000 : 15000; // Increased base wait and retry wait
                    this.logger.info(`Wait attempt ${i + 1}/${maxRetries} (${waitTime/1000}s)...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    
                    health = await blinkAuth.getAgentHealth(agent.id);
                    if (health && health.healthy) {
                        this.logger.info(`🤖 Agent Health: ✅ Healthy | State: ${health.machineState}`);
                        break;
                    } else if (health) {
                        this.logger.warn(`🤖 Agent State: ${health.machineState || 'unknown'} - Retrying...`);
                    } else {
                        this.logger.error(`🤖 Agent Health check failed (possibly 503/Timeout) - Retrying...`);
                    }
                }
                
                if (health && health.healthy) {
                    // 5. Retrieve BLINK_API_KEY from environment
                    this.logger.info('🔑 Retrieving BLINK_API_KEY from agent...');
                    const cmdResult = await blinkAuth.executeCommand(agent.id, "echo $BLINK_API_KEY");
                    if (cmdResult && cmdResult.stdout) {
                        blinkApiKey = cmdResult.stdout.trim();
                        this.logger.info(`✅ Key Captured: ${blinkApiKey.substring(0, 10)}...`);
                    }
                } else {
                    this.logger.error('❌ Agent failed to reach healthy state in time.');
                }
            }
        }
        
        return { 
            blinkApiKey,
            plan: sessionData?.workspace?.tier || 'free',
            credits: sessionData?.workspace?.usage?.billing_period_credits_limit || 0
        };
    }

    loadAccounts() {
        const filePath = path.join(process.cwd(), 'result', 'accounts.json');
        if (!fs.existsSync(filePath)) return [];
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            return [];
        }
    }

    saveAccount(account) {
        const resultDir = path.join(process.cwd(), 'result');
        if (!fs.existsSync(resultDir)) fs.mkdirSync(resultDir);
        
        const filePath = path.join(resultDir, 'accounts.json');
        let accounts = this.loadAccounts();
        
        // Keep unique by email
        accounts = accounts.filter(a => a.email !== account.email);
        accounts.push(account);
        
        fs.writeFileSync(filePath, JSON.stringify(accounts, null, 2));
    }
}

module.exports = BlinkAutoBot;
