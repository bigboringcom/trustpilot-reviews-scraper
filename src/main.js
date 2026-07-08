import { CheerioCrawler, log } from 'crawlee';
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
    // If user just passed a domain, construct the Trustpilot URL
    const domain = startUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
    startUrl = `https://www.trustpilot.com/review/${domain}`;
}

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

const crawler = new CheerioCrawler({
    maxRequestRetries: 3,
    maxConcurrency: 3,
    maxRequestsPerMinute: 30,
    proxyConfiguration,
    additionalHttpErrorStatusCodes: [403],
    preNavigationHooks: [
        (crawlingContext, gotOptions) => {
            gotOptions.headers = {
                ...gotOptions.headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            };
        },
    ],
    async requestHandler({ $, request, enqueueLinks }) {
        if (itemCount >= maxItems) return;

        log.info(`Processing: ${request.url}`);

        // Extract company info from the page header
        const companyName = $('[class*="title_displayName"], h1[class*="title"], [data-company-name]').first().text().trim() ||
            $('meta[property="og:title"]').attr('content')?.split('|')?.[0]?.trim() || '';
        const overallRating = $('[class*="overallRating"], [data-rating-typography]').first().text().trim() || '';
        const totalReviews = $('[class*="numberOfReviews"], [class*="reviewCount"]').first().text().trim() || '';

        // Extract individual reviews
        const reviewCards = $('[class*="review-card"], article[class*="paper"], [data-review-id], [class*="styles_cardWrapper"]');

        reviewCards.each((i, el) => {
            if (itemCount >= maxItems) return false;

            // Star rating
            const ratingEl = $(el).find('[class*="star-rating"], img[alt*="star"], [data-service-review-rating]');
            let rating = ratingEl.attr('data-service-review-rating') || '';
            if (!rating) {
                const altText = ratingEl.find('img').attr('alt') || ratingEl.attr('alt') || '';
                const ratingMatch = altText.match(/(\d)/);
                if (ratingMatch) rating = ratingMatch[1];
            }
            if (!rating) {
                // Try counting filled stars
                const filledStars = $(el).find('[class*="star--filled"], [class*="StarRating"] img').length;
                if (filledStars > 0) rating = String(filledStars);
            }

            // Review title and body
            const title = $(el).find('[class*="title"], h2, [data-service-review-title-typography]').first().text().trim();
            const body = $(el).find('[class*="content"], [class*="text"], p[class*="styles_reviewContent"], [data-service-review-text-typography]').first().text().trim();

            // Reviewer info
            const reviewerName = $(el).find('[class*="consumer-information"] a, [class*="displayName"], [data-consumer-name-typography]').first().text().trim();
            const reviewerLocation = $(el).find('[class*="consumerLocation"], [class*="location"], [data-consumer-country-typography]').first().text().trim();

            // Date
            const dateEl = $(el).find('time, [class*="date"], [datetime]');
            const reviewDate = dateEl.attr('datetime') || dateEl.text().trim() || '';

            // Reply from company
            const hasReply = $(el).find('[class*="reply"], [class*="businessReply"]').length > 0;

            // Verification
            const isVerified = $(el).find('[class*="verified"], [class*="Verified"]').length > 0;

            if (title || body || rating) {
                const record = {
                    companyName: companyName || '',
                    companyUrl: request.url.split('?')[0],
                    reviewerName: reviewerName || 'Anonymous',
                    reviewerLocation: reviewerLocation || '',
                    rating: rating ? parseInt(rating) : null,
                    title: title || '',
                    body: body || '',
                    date: reviewDate || '',
                    isVerified: isVerified,
                    hasCompanyReply: hasReply,
                    companyOverallRating: overallRating || '',
                    companyTotalReviews: totalReviews || '',
                    sourceUrl: request.url,
                    extractedAt: new Date().toISOString()
                };

                Actor.pushData(record);
                itemCount++;
            }
        });

        log.info(`✅ Extracted ${reviewCards.length} reviews from page (total: ${itemCount})`);

        // Handle pagination - follow "next page" links
        if (itemCount < maxItems) {
            const nextPageLink = $('a[name="pagination-button-next"], a[href*="page="], [class*="pagination"] a[rel="next"]').attr('href');
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
