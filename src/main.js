import { PlaywrightCrawler, log } from 'crawlee';
import { Actor } from 'apify';

await Actor.init();

const input = await Actor.getInput() || {};
const companyUrl = input.companyUrl || 'https://www.trustpilot.com/review/example.com';
const maxItems = input.maxItems || 100;
const maxRunTimeMinutes = input.maxRunTimeMinutes || 5;

let itemCount = 0;

// Normalize the URL to ensure it's a valid Trustpilot review page
let startUrl = companyUrl;
if (!startUrl.includes('trustpilot.com')) {
    const domain = startUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    startUrl = `https://www.trustpilot.com/review/${domain}`;
}

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

const crawler = new PlaywrightCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 1,
    maxRequestsPerMinute: 10,
    proxyConfiguration,
    headless: true,
    navigationTimeoutSecs: 60,
    requestHandlerTimeoutSecs: 120,
    async requestHandler({ page, request }) {
        if (itemCount >= maxItems) return;

        log.info(`Processing: ${request.url}`);

        // Wait for reviews to render
        await page.waitForSelector('article, [class*="review-card"], [data-service-review-rating]', { timeout: 15000 }).catch(() => {
            log.warning('Review elements not found, page may be blocked or empty');
        });

        // Extract company info
        const companyName = await page.$eval('h1, [class*="title_displayName"]', el => el.textContent.trim()).catch(() => '');
        const overallRating = await page.$eval('[class*="overallRating"], [data-rating-typography]', el => el.textContent.trim()).catch(() => '');
        const totalReviews = await page.$eval('[class*="numberOfReviews"], [class*="reviewCount"]', el => el.textContent.trim()).catch(() => '');

        // Extract reviews
        const reviews = await page.$$eval('article, [class*="paper_paper"], [data-review-id]', (elements) => {
            return elements.map(el => {
                // Rating
                const ratingEl = el.querySelector('[data-service-review-rating], img[alt*="star"], [class*="star-rating"]');
                let rating = ratingEl?.getAttribute('data-service-review-rating') || '';
                if (!rating) {
                    const alt = ratingEl?.querySelector('img')?.getAttribute('alt') || ratingEl?.getAttribute('alt') || '';
                    const match = alt.match(/(\d)/);
                    if (match) rating = match[1];
                }

                // Title and body
                const title = el.querySelector('h2, [data-service-review-title-typography], [class*="title"]')?.textContent?.trim() || '';
                const body = el.querySelector('[data-service-review-text-typography], [class*="reviewContent"], p[class*="text"]')?.textContent?.trim() || '';

                // Reviewer
                const reviewerName = el.querySelector('[data-consumer-name-typography], [class*="displayName"], [class*="consumer-information"] a')?.textContent?.trim() || '';
                const reviewerLocation = el.querySelector('[data-consumer-country-typography], [class*="consumerLocation"]')?.textContent?.trim() || '';

                // Date
                const dateEl = el.querySelector('time, [datetime]');
                const date = dateEl?.getAttribute('datetime') || dateEl?.textContent?.trim() || '';

                // Reply and verification
                const hasReply = !!el.querySelector('[class*="reply"], [class*="businessReply"]');
                const isVerified = !!el.querySelector('[class*="verified"], [class*="Verified"]');

                return { rating, title, body, reviewerName, reviewerLocation, date, hasReply, isVerified };
            });
        }).catch(() => []);

        for (const review of reviews) {
            if (itemCount >= maxItems) break;
            if (!review.title && !review.body && !review.rating) continue;

            const record = {
                companyName: companyName || '',
                companyUrl: request.url.split('?')[0],
                reviewerName: review.reviewerName || 'Anonymous',
                reviewerLocation: review.reviewerLocation || '',
                rating: review.rating ? parseInt(review.rating) : null,
                title: review.title || '',
                body: review.body || '',
                date: review.date || '',
                isVerified: review.isVerified,
                hasCompanyReply: review.hasReply,
                companyOverallRating: overallRating || '',
                companyTotalReviews: totalReviews || '',
                sourceUrl: request.url,
                extractedAt: new Date().toISOString()
            };

            await Actor.pushData(record);
            itemCount++;
        }

        log.info(`✅ Extracted ${reviews.length} reviews from page (total: ${itemCount})`);

        // Pagination
        if (itemCount < maxItems) {
            const nextPageLink = await page.$eval(
                'a[name="pagination-button-next"], a[href*="page="][rel="next"]',
                el => el.getAttribute('href')
            ).catch(() => null);

            if (nextPageLink) {
                const nextUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://www.trustpilot.com${nextPageLink}`;
                await crawler.addRequests([{ url: nextUrl }]);
            }
        }
    }
});

// ─── GRACEFUL KILL SWITCH ───
const killTimer = setTimeout(() => {
    log.warning(`⏰ Maximum run time of ${maxRunTimeMinutes} minutes reached. Tearing down gracefully.`);
    crawler.teardown();
}, maxRunTimeMinutes * 60 * 1000);

log.info(`🚀 Trustpilot Reviews Scraper starting (url: ${startUrl}, maxItems: ${maxItems})`);
await crawler.run([startUrl]);

clearTimeout(killTimer);
await Actor.exit();
