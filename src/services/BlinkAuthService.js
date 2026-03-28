const { faker } = require('@faker-js/faker');

class BlinkAuthService {
    constructor(httpClient, logger) {
        this.httpClient = httpClient;
        this.logger = logger;
        this.baseUrl = 'https://blink.new';
        this.idToken = null;
        this.refreshToken = null; // App refresh token
        this.firebaseRefreshToken = null; // Actual Firebase refresh token
        this.workspaceId = null;
        this.workspaceSlug = null;
    }

    async sendMagicLink(email) {
        this.logger.info(`Sending magic link to ${email}...`);
        try {
            const payload = {
                email: email,
                redirectUrl: "/"
            };
            const response = await this.httpClient.post(`${this.baseUrl}/api/auth/main-app/magic-link`, payload);
            if (response.data && response.data.success) {
                this.logger.info('Magic link sent successfully');
                return true;
            }
            throw new Error(response.data.message || 'Failed to send magic link');
        } catch (error) {
            this.logger.error('Error sending magic link', error);
            throw error;
        }
    }

    async verifyMagicToken(magicTokenUrl) {
        this.logger.info('Verifying magic token and initializing session...');
        try {
            // Parse url to get tokens
            const parsedUrl = new URL(magicTokenUrl);
            const token = parsedUrl.searchParams.get('magic_token');
            const email = parsedUrl.searchParams.get('email');
            
            // 1. Get Custom Token
            const magicLinkApiPath = `/api/auth/main-app/magic-link?token=${token}&email=${encodeURIComponent(email)}`;
            const magicResponse = await this.httpClient.get(`${this.baseUrl}${magicLinkApiPath}`);
            
            if (!magicResponse.data || !magicResponse.data.customToken) {
                throw new Error('Failed to get custom token from magic link');
            }
            
            const customToken = magicResponse.data.customToken;
            const uid = magicResponse.data.user.id;
            const workspaceSlug = magicResponse.data.workspaceSlug;

            // Set the workspace slug cookie manually (usually done by frontend)
            if (workspaceSlug) {
                this.logger.info(`Injecting workspace_slug cookie: ${workspaceSlug}`);
                await this.httpClient.setCookie(`workspace_slug=${workspaceSlug}; Path=/; Domain=blink.new`, 'https://blink.new');
            }

            // 2. Exchange Custom Token for ID Token via Firebase
            const apiKey = 'AIzaSyDW_pdI4eFUtrtmrwRG0a2dvMAgBsLq_hU';
            const identityUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`;
            
            this.logger.info('Exchanging custom token for Firebase ID token...');
            const identityResponse = await this.httpClient.post(identityUrl, {
                token: customToken,
                returnSecureToken: true
            });
            
            if (!identityResponse.data || !identityResponse.data.idToken) {
                throw new Error('Failed to exchange custom token for ID token');
            }
            
            const idToken = identityResponse.data.idToken;
            this.firebaseRefreshToken = identityResponse.data.refreshToken; // Capture original Firebase refresh token

            // 3. Create User Profile
            this.logger.info('Creating user profile with random identity...');
            const fullName = faker.person.fullName();
            const username = faker.internet.username().toLowerCase().replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 1000);
            
            const createPayload = {
                email: email,
                name: fullName,
                photo_url: null,
                username: username,
                email_verified: false,
                referred_by: null,
                user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36",
                is_same_browser: false,
                provider_id: null,
                geoip: {
                    country_name: faker.location.country(),
                    country_code: faker.location.countryCode(),
                    city: faker.location.city(),
                    region: faker.location.state(),
                    region_code: faker.location.state({ abbreviated: true }),
                    postal_code: faker.location.zipCode(),
                    latitude: faker.location.latitude(),
                    longitude: faker.location.longitude(),
                    timezone: faker.location.timeZone()
                },
                signup_source: "auth_page"
            };
            
            const createResponse = await this.httpClient.post(`${this.baseUrl}/api/users/create`, createPayload, {
                headers: {
                    'Authorization': `Bearer ${idToken}`,
                    'Content-Type': 'application/json'
                }
            });

            if (createResponse.data && createResponse.data.active_workspace_id) {
                this.workspaceId = createResponse.data.active_workspace_id;
                this.workspaceSlug = createResponse.data.workspace?.slug || workspaceSlug;
                this.logger.info(`Workspace identified: ${this.workspaceId} (${this.workspaceSlug})`);
            }
            
            this.idToken = idToken;
            
            // 4. Create Fastify Session
            this.logger.info('Initializing fastify session cookie...');
            await this.httpClient.post(`${this.baseUrl}/api/auth/session`, { idToken: idToken }, {
                headers: { 'Content-Type': 'application/json' }
            });

            // 5. Get App Access Token
            this.logger.info('Getting app access token...');
            const tokenResponse = await this.httpClient.post(`${this.baseUrl}/api/auth/token`, { idToken: idToken }, {
                headers: { 'Content-Type': 'application/json' }
            });

            this.refreshToken = tokenResponse.data?.refresh_token;

            this.logger.info('Account verified and session initialized successfully');
            return {
                idToken: idToken,
                accessToken: tokenResponse.data?.access_token,
                refreshToken: tokenResponse.data?.refresh_token
            };
        } catch (error) {
            this.logger.error('Error verifying magic token', error);
            throw error;
        }
    }

    async getCheckoutSession() {
        this.logger.info('Fetching checkout session (via /api/stripe/checkout)...');
        try {
            const payload = {
                priceId: "price_1S2oW1IChkSeVZoQl1420r64",
                planId: "pro",
                toltReferralId: null,
                workspaceId: this.workspaceId,
                cancelUrl: `${this.baseUrl}/${this.workspaceSlug}?showPricing=true`
            };
            
            const response = await this.httpClient.post(`${this.baseUrl}/api/stripe/checkout`, payload, {
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.idToken}` // Added as seen in logs
                }
            });

            if (response.data && response.data.url) {
                this.logger.info('Checkout session found: ' + response.data.url);
                return response.data.url;
            } else if (response.data && response.data.sessionId) {
                return `https://checkout.stripe.com/c/pay/${response.data.sessionId}`;
            }

            throw new Error(`Failed to create checkout session. Response: ${JSON.stringify(response.data)}`);
        } catch (error) {
            this.logger.error('Error creating checkout session', error);
            throw error;
        }
    }

    async migrateCredits() {
        this.logger.info('Migrating credits post-payment...');
        try {
            const response = await this.httpClient.post(`${this.baseUrl}/api/credits/migrate`, {}, { validateStatus: false });
            if (response.status === 200 || response.status === 201) {
                this.logger.success('Credits migrated successfully');
                return true;
            }
            this.logger.warn(`Credit migration returned status ${response.status}`);
            return false;
        } catch (error) {
            this.logger.error('Error migrating credits', error);
            // Non-fatal, so we just return false
            return false;
        }
    }

    async getSessionData() {
        this.logger.info('Fetching session data from /api/auth/session-data...');
        try {
            const response = await this.httpClient.get(`${this.baseUrl}/api/auth/session-data`, {
                headers: {
                    'Authorization': `Bearer ${this.idToken}`
                }
            });
            return response.data;
        } catch (error) {
            this.logger.error('Error fetching session data', error);
            return null;
        }
    }

    async createAgent(workspaceId, name) {
        this.logger.info(`Creating agent "${name}" in workspace ${workspaceId}...`);
        try {
            const payload = {
                workspaceId: workspaceId,
                name: name,
                model: "anthropic/claude-sonnet-4.6",
                machine_size: "starter"
            };
            
            const response = await this.httpClient.post(`${this.baseUrl}/api/claw/agents`, payload, {
                headers: {
                    'Authorization': `Bearer ${this.idToken}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.data && response.data.id) {
                this.logger.success(`✅ Agent created: ${response.data.id} (status: ${response.data.status})`);
                return response.data;
            }
            throw new Error(`Failed to create agent: ${JSON.stringify(response.data)}`);
        } catch (error) {
            this.logger.error('Error creating agent', error);
            return null;
        }
    }

    async getAgentHealth(agentId) {
        this.logger.info(`Checking health for agent ${agentId}...`);
        try {
            const response = await this.httpClient.get(`${this.baseUrl}/api/claw/agents/${agentId}/health`, {
                headers: {
                    'Authorization': `Bearer ${this.idToken}`
                }
            });
            return response.data; // { healthy: true, machineState: "started" }
        } catch (error) {
            this.logger.error(`Error checking health for agent ${agentId}`, error);
            return null;
        }
    }

    async executeCommand(agentId, cmd) {
        this.logger.info(`Executing command on agent ${agentId}: "${cmd}"`);
        try {
            const payload = {
                cmd: cmd,
                timeout: 60,
                cwd: "/data/workspace"
            };
            
            const response = await this.httpClient.post(`${this.baseUrl}/api/claw/agents/${agentId}/exec`, payload, {
                headers: {
                    'Authorization': `Bearer ${this.idToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return response.data; // { stdout, stderr, exit_code, ... }
        } catch (error) {
            this.logger.error(`Error executing command on agent ${agentId}`, error);
            return null;
        }
    }

    async refreshFirebaseToken() {
        this.logger.info('Refreshing Firebase ID token after payment...');
        if (!this.firebaseRefreshToken) {
            this.logger.warn('No firebase refresh token available to perform refresh.');
            return false;
        }

        try {
            const apiKey = 'AIzaSyDW_pdI4eFUtrtmrwRG0a2dvMAgBsLq_hU';
            const url = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;
            
            // Use URLSearchParams for application/x-www-form-urlencoded
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', this.firebaseRefreshToken);
            
            const response = await this.httpClient.post(url, params.toString(), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (response.data && response.data.id_token) {
                this.idToken = response.data.id_token;
                this.firebaseRefreshToken = response.data.refresh_token || this.firebaseRefreshToken;
                this.logger.success('Firebase ID token refreshed successfully');
                
                // Update the session cookie in main app with new ID token
                await this.httpClient.post(`${this.baseUrl}/api/auth/session`, { idToken: this.idToken });
                
                return true;
            }
            throw new Error('Failed to refresh ID token: ' + JSON.stringify(response.data));
        } catch (error) {
            this.logger.error('Error refreshing Firebase token', error);
            return false;
        }
    }
}

module.exports = BlinkAuthService;
