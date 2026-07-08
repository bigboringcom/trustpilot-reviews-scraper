import { CheerioCrawler, log } from 'crawlee';
import { Actor } from 'apify';

await Actor.init();

const input = await Actor.getInput() || {};
const companyUrl = input.companyUrl || 'https://www.trustpilot.com/review/example.com';
const maxItems = input.maxItems || 100;
const maxRunTimeMinutes = input.maxRunTimeMinutes || 5;

let itemCount = 0;
let buildId = null;

// Normalize the URL to get the company domain
let companyDomain = companyUrl;
if (companyDomain.includes('trustpilot.com/review/')) {
    companyDomain = companyDomain.split('trustpilot.com/review/')[1].split('?')[0].replace(/\/$/, '');
} else {
    companyDomain = companyDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const proxyConfiguration = await Actor.createProxyConfiguration({
    groups: ['RESIDENTIAL'],
    countryCode: 'US',
});

const crawler = new CheerioCrawler({
    maxRequestRetries: 5,
    maxConcurrency: 2,
    maxRequestsPerMinute: 15,
    proxyConfiguration,
    preNavigationHooks: [
        (crawlingContext, gotOptions) => {
            gotOptions.headers = {
                ...gotOptions.headers,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://www.google.com/',
                'DNT': '1',
            };
        },
    ],
    async requestHandler({ $, request, body }) {
        if (itemCount >= maxItems) return;

        log.info(`Processing: ${request.url}`);

        // ─── METHOD 1: Extract __NEXT_DATA__ JSON blob ───
        const nextDataScript = $('script#__NEXT_DATA__').html();
        
        if (nextDataScript) {
            try {
                const nextData = JSON.parse(nextDataScript);
                
                // Get buildId for API-based pagination
                if (!buildId && nextData.buildId) {
                    buildId = nextData.buildId;
                    log.info(`Found buildId: ${buildId}`);
                }

                const pageProps = nextData?.props?.pageProps || {};
                const reviews = pageProps.reviews || [];
                const businessUnit = pageProps.businessUnit || {};
                const companyName = businessUnit.displayName || businessUnit.identifyingName || companyDomain;
                const overallRating = businessUnit.trustScore || '';
                const totalReviews = businessUnit.numberOfReviews || '';

                for (const review of reviews) {
                    if (itemCount >= maxItems) break;

                    const record = {
                        companyName,
                        companyUrl: `https://www.trustpilot.com/review/${companyDomain}`,
                        reviewerName: review.consumer?.displayName || 'Anonymous',
                        reviewerLocation: review.consumer?.countryCode || '',
                        rating: review.rating || null,
                        title: review.title || '',
                        body: review.text || '',
                        date: review.dates?.publishedDate || '',
                        experienceDate: review.dates?.experiencedDate || '',
                        isVerified: review.labels?.verification?.isVerified || false,
                        hasCompanyReply: !!(review.reply),
                        companyOverallRating: String(overallRating),
                        companyTotalReviews: String(totalReviews),
                        reviewId: review.id || '',
                        sourceUrl: request.url,
                        extractedAt: new Date().toISOString()
                    };

                    await Actor.pushData(record);
                    itemCount++;
                }

                log.info(`✅ Extracted ${reviews.length} reviews via __NEXT_DATA__ (total: ${itemCount})`);

                // ─── PAGINATION: Use _next/data API if we have buildId ───
                if (itemCount < maxItems && buildId) {
                    const pagination = pageProps.filters?.pagination || {};
                    const currentPage = pagination.currentPage || 1;
                    const totalPages = pagination.totalPages || 1;

                    if (currentPage < totalPages) {
                        const nextPage = currentPage + 1;
                        const apiUrl = `https://www.trustpilot.com/_next/data/${buildId}/review/${companyDomain}.json?businessUnit=${companyDomain}&page=${nextPage}&sort=recency`;
                        await crawler.addRequests([{ url: apiUrl, userData: { isApi: true } }]);
                    }
                }
            } catch (e) {
                log.warning(`Failed to parse __NEXT_DATA__: ${e.message}`);
            }
        }

        // ─── METHOD 2: Handle _next/data JSON API responses ───
        if (request.userData?.isApi || request.url.includes('/_next/data/')) {
            try {
                const jsonData = JSON.parse(body);
                const pageProps = jsonData?.pageProps || {};
                const reviews = pageProps.reviews || [];
                const businessUnit = pageProps.businessUnit || {};
                const companyName = businessUnit.displayName || companyDomain;

                for (const review of reviews) {
                    if (itemCount >= maxItems) break;

                    const record = {
                        companyName,
                        companyUrl: `https://www.trustpilot.com/review/${companyDomain}`,
                        reviewerName: review.consumer?.displayName || 'Anonymous',
                        reviewerLocation: review.consumer?.countryCode || '',
                        rating: review.rating || null,
                        title: review.title || '',
                        body: review.text || '',
                        date: review.dates?.publishedDate || '',
                        experienceDate: review.dates?.experiencedDate || '',
                        isVerified: review.labels?.verification?.isVerified || false,
                        hasCompanyReply: !!(review.reply),
                        companyOverallRating: String(businessUnit.trustScore || ''),
                        companyTotalReviews: String(businessUnit.numberOfReviews || ''),
                        reviewId: review.id || '',
                        sourceUrl: request.url,
                        extractedAt: new Date().toISOString()
                    };

                    await Actor.pushData(record);
                    itemCount++;
                }

                log.info(`✅ Extracted ${reviews.length} reviews via API (total: ${itemCount})`);

                // Continue pagination
                if (itemCount < maxItems) {
                    const pagination = pageProps.filters?.pagination || {};
                    const currentPage = pagination.currentPage || 1;
                    const totalPages = pagination.totalPages || 1;

                    if (currentPage < totalPages) {
                        const nextPage = currentPage + 1;
                        const apiUrl = `https://www.trustpilot.com/_next/data/${buildId}/review/${companyDomain}.json?businessUnit=${companyDomain}&page=${nextPage}&sort=recency`;
                        await crawler.addRequests([{ url: apiUrl, userData: { isApi: true } }]);
                    }
                }
            } catch (e) {
                log.warning(`Failed to parse API JSON: ${e.message}`);
            }
        }

        // ─── METHOD 3: Fallback HTML parsing if __NEXT_DATA__ is not available ───
        if (!nextDataScript && !request.userData?.isApi) {
            log.warning(`No __NEXT_DATA__ found. Page might be blocked. Status may be 403.`);
        }
    }
});

// ─── GRACEFUL KILL SWITCH ───
const killTimer = setTimeout(() => {
    log.warning(`⏰ Maximum run time of ${maxRunTimeMinutes} minutes reached. Tearing down gracefully.`);
    crawler.teardown();
}, maxRunTimeMinutes * 60 * 1000);

const startUrl = `https://www.trustpilot.com/review/${companyDomain}`;
log.info(`🚀 Trustpilot Reviews Scraper starting (company: ${companyDomain}, maxItems: ${maxItems})`);
await crawler.run([startUrl]);

clearTimeout(killTimer);
await Actor.exit();
