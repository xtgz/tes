const { chromium } = require('playwright');
const fs = require('fs');
const { faker } = require('@faker-js/faker');

class StripePaymentService {
    constructor(httpClient, logger) {
        this.httpClient = httpClient;
        this.logger = logger;
        this.executablePath = this.detectBrave();
    }

    detectBrave() {
        const bravePaths = [
            "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            "C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
            process.env.LOCALAPPDATA + "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
        ];
        for (const p of bravePaths) {
            if (fs.existsSync(p)) {
                return p;
            }
        }
        return undefined; // Falls back to standard chromium if not found
    }

    async processStripeCheckout(checkoutUrl, card) {
        this.logger.info('🚀 Starting browser-based Stripe checkout...');
        
        let proxy = undefined;
        if (this.httpClient.proxyUrl) {
            try {
                const u = new URL(this.httpClient.proxyUrl);
                proxy = {
                    server: `${u.protocol}//${u.host}`,
                    username: u.username,
                    password: u.password
                };
            } catch(e) {
                this.logger.warn(`Failed to parse proxy URL: ${this.httpClient.proxyUrl}`);
            }
        }

        const launchOpts = {
            headless: false, // Visible for monitoring and better bot detection bypass
            executablePath: this.executablePath,
            args: ['--incognito', '--disable-blink-features=AutomationControlled']
        };
        // Note: Proxy disabled as per user request for Stripe Checkout performance


        let browser, context, page;
        try {
            browser = await chromium.launch(launchOpts);
            context = await browser.newContext({
                viewport: { width: 1280, height: 720 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            });
            page = await context.newPage();

            this.logger.info(`🌐 Navigating to checkout URL${proxy ? ' (via proxy)' : ''}...`);
            await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Explicitly click 'Card' tab if present
            try {
                const cardTab = page.locator('[data-testid="hosted-payment-method-card"], [value="card"], text="Card"').first();
                await cardTab.waitFor({ state: 'visible', timeout: 10000 });
                await cardTab.click();
                this.logger.info("✅ Selected Card payment method");
            } catch(e) {
                this.logger.info("ℹ️ Proceeding with default payment method (no separate card tab found)");
            }

            // Wait for form to be interactive
            await page.waitForTimeout(2000);

            this.logger.info("🧾 Filling card details...");
            let targetFrame = null;

            // Search iframes for card inputs
            for (let i = 0; i < 30; i++) {
                for (const f of page.frames()) {
                    const count = await f.locator('input[autocomplete="cc-number"], input[name="cardnumber"], input[name="cardNumber"]').count().catch(() => 0);
                    if (count > 0) {
                        targetFrame = f;
                        this.logger.info(`✅ Found card input frame`);
                        break;
                    }
                }
                if (targetFrame) break;
                if (i % 5 === 4) this.logger.info(`⏳ Still searching for card form... (${i+1}s)`);
                await page.waitForTimeout(1000);
            }

            if (!targetFrame) {
                throw new Error("Could not find checkout form inputs within 30s");
            }

            // Format expiry: Stripe takes MMYY (e.g., 0428 for April 2028)
            const expYear = card.expYear.length === 4 ? card.expYear.substring(2) : card.expYear;
            const expMonth = card.expMonth.padStart(2, '0');

            await targetFrame.locator('input[autocomplete="cc-number"], input[name="cardnumber"], input[name="cardNumber"]').first().fill(card.number, { timeout: 15000 });
            
            // For expiry, clear first then type character by character to handle Stripe's input mask
            const expiryInput = targetFrame.locator('input[autocomplete="cc-exp"], input[name="exp-date"], input[name="cardExpiry"]').first();
            await expiryInput.click();
            await expiryInput.pressSequentially(expMonth + expYear, { delay: 150 });
            this.logger.info(`📅 Typed expiry: ${expMonth}/${expYear}`);
            
            await targetFrame.locator('input[autocomplete="cc-csc"], input[name="cvc"], input[name="cardCvc"]').first().fill(card.cvc, { timeout: 15000 });

            // Apply promotion code (with retry logic)
            let promoApplied = false;
            for (let attempt = 1; attempt <= 3 && !promoApplied; attempt++) {
                try {
                    this.logger.info(`🎟️ Attempting to apply promotion code (Attempt ${attempt}/3)...`);
                    
                    const promoInputSelectors = [
                        'input[name="promoCode"]',
                        'input[placeholder*="Promotion"]',
                        'input[placeholder*="promo"]',
                        'input[placeholder*="Promo"]',
                        'input[placeholder*="coupon"]',
                        'input[id*="promo"]',
                        'input[id*="coupon"]',
                        '.PromoCode-Input input',
                        '[data-testid*="promo"] input'
                    ].join(', ');

                    let promoInput = null;
                    let promoContext = page;

                    for (const ctx of [page, ...page.frames()]) {
                        const inp = ctx.locator(promoInputSelectors).first();
                        if (await inp.isVisible().catch(() => false)) {
                            promoInput = inp;
                            promoContext = ctx;
                            break;
                        }
                    }

                    if (!promoInput) {
                        const btnSelectors = [
                            'button:has-text("Add promotion code")',
                            'button:has-text("Add promo")',
                            'button:has-text("Have a coupon")',
                            '[aria-label="Add promotion code"]',
                            '.PromoCode-Add'
                        ].join(', ');

                        for (const ctx of [page, ...page.frames()]) {
                            const btn = ctx.locator(btnSelectors).first();
                            if (await btn.isVisible().catch(() => false)) {
                                await btn.click();
                                promoContext = ctx;
                                await page.waitForTimeout(1000);
                                promoInput = ctx.locator(promoInputSelectors).first();
                                break;
                            }
                        }
                    }

                    if (promoInput && await promoInput.isVisible().catch(() => false)) {
                        await promoInput.fill('BLINKCLAW-PRO50-9527');
                        const applyBtn = promoContext.locator('button:has-text("Apply"), .PromoCode-ApplyButton').first();
                        if (await applyBtn.isVisible().catch(() => false)) {
                            await applyBtn.click();
                        } else {
                            await promoInput.press('Enter');
                        }
                        
                        await page.waitForTimeout(3000); // Wait for validation
                        
                        // Verify if applied (should see discount or removal of input)
                        const errorMsg = promoContext.locator('.ErrorCode, .ErrorMessage, .text-danger').first();
                        if (await errorMsg.isVisible().catch(() => false)) {
                            const text = await errorMsg.innerText();
                            this.logger.warn(`⚠️ Promo error on attempt ${attempt}: ${text}`);
                            throw new Error(`Promo code not accepted: ${text}`);
                        }

                        this.logger.info("✅ Applied code: BLINKCLAW-PRO50-9527");
                        promoApplied = true;
                    } else {
                        if (attempt === 3) this.logger.info("ℹ️ No promotion code field found after 3 attempts.");
                    }
                } catch (e) {
                    this.logger.warn(`⚠️ Promo attempt ${attempt} failed: ${e.message}`);
                    if (attempt < 3) await page.waitForTimeout(2000);
                }
            }

            // Fill name if it exists (Search frames too)
            const name = faker.person.fullName();
            const nameSelectors = 'input[autocomplete="cc-name"], input[name="name"], #billingName, #name';
            
            let nameInput = page.locator(nameSelectors).first();
            if (!(await nameInput.isVisible().catch(() => false)) && targetFrame) {
                nameInput = targetFrame.locator(nameSelectors).first();
            }

            if (await nameInput.isVisible().catch(() => false)) {
                await nameInput.fill(name).catch(() => {});
            }

            this.logger.info("💳 Submitting payment...");
            
            // Define all possible button selectors
            const submitSelectors = [
                'button:has-text("Subscribe")',
                'button:has-text("Pay")',
                'button:has-text("Submit")',
                'button:has-text("Subscribe now")',
                'button:has-text("Start trial")',
                'button.SubmitButton',
                'button[type="submit"]',
                '[data-testid="hosted-payment-submit-button"]',
                '.SubmitButton',
                'button:has(span:has-text("Subscribe"))',
                'button:has(span:has-text("Pay"))'
            ];

            let submitBtn = null;

            // Search across main page and all frames for any of the selectors
            for (let i = 0; i < 20; i++) { // Retry for 20 seconds
                for (const ctx of [page, ...page.frames()]) {
                    for (const sel of submitSelectors) {
                        const loc = ctx.locator(sel).first();
                        if (await loc.isVisible().catch(() => false)) {
                            submitBtn = loc;
                            break;
                        }
                    }
                    if (submitBtn) break;
                }
                if (submitBtn) break;
                
                // If not found, check for validation errors that might be blocking the button
                const errorSelectors = ['.ErrorCode', '.ErrorMessage', '.text-danger', '.FieldError', '[role="alert"]', '.Icon--error'];
                for (const ctx of [page, ...page.frames()]) {
                    for (const sel of errorSelectors) {
                        const err = ctx.locator(sel).first();
                        if (await err.isVisible().catch(() => false)) {
                            const text = await err.innerText();
                            if (text && text.trim().length > 0) {
                                this.logger.error(`❌ Payment blocked by form error: ${text}`);
                                throw new Error(`Stripe validation error: ${text}`);
                            }
                        }
                    }
                }
                
                await page.waitForTimeout(1000);
            }

            if (!submitBtn) {
                this.logger.error("❌ Submit button not found/visible after 20s.");
                const screenPath = `error-submit-${Date.now()}.png`;
                await page.screenshot({ path: screenPath });
                this.logger.info(`📸 Error screenshot saved to: ${screenPath}`);
                throw new Error("Could not find the Submit/Subscribe button.");
            }

            this.logger.info("🖱️ Clicking Submit/Subscribe button...");
            await submitBtn.click({ force: true });

            this.logger.info("⏳ Waiting for success confirmation...");
            try {
                await page.waitForFunction(() => {
                    const text = document.body.innerText.toLowerCase();
                    const url = window.location.href.toLowerCase();
                    return !url.includes('checkout.stripe.com') ||
                           text.includes('success') ||
                           text.includes('successful') ||
                           text.includes('thank you') ||
                           document.querySelector('.Success, .Checkmark, [class*="success"]');
                }, { timeout: 60000 });
                this.logger.success("✅ Payment confirmed by browser!");
                await page.waitForTimeout(3000); // Give it a moment to stabilize
            } catch (waitErr) {
                this.logger.warn("⚠️ Success confirmation timed out. Closing browser and checking status via API.");
            }

        } catch (error) {
            this.logger.error(`❌ Browser automation error: ${error.message}`);
            throw error;
        } finally {
            if (browser) await browser.close();
        }
    }
}

module.exports = StripePaymentService;
