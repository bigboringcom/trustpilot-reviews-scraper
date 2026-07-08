# Trustpilot Reviews Scraper

## What does this scraper do?
The **Trustpilot Reviews Scraper** extracts customer reviews from any company's Trustpilot page. It collects star ratings, review titles, full review text, reviewer names, locations, dates, verification status, and whether the company has replied. Just provide a Trustpilot URL or company domain.

## Why scrape Trustpilot reviews?
- **Reputation Monitoring:** Track your own company's reviews over time to measure customer satisfaction trends.
- **Competitor Analysis:** Analyze competitors' reviews to identify their strengths and weaknesses from customer feedback.
- **Sentiment Analysis:** Feed review data into NLP/AI tools for automated sentiment scoring and topic extraction.
- **Market Research:** Understand what customers value most in your industry based on real feedback.
- **Lead Generation:** Identify unhappy customers of competitors who might be open to switching.
- **Product Development:** Mine reviews for feature requests and common pain points.

## Input Parameters

| Field | Type | Description |
| ----- | ---- | ----------- |
| `companyUrl` | String | Trustpilot URL (e.g., https://www.trustpilot.com/review/example.com) or just a domain (e.g., example.com) |
| `maxItems` | Integer | Maximum number of reviews to scrape. Default: 100 |
| `maxRunTimeMinutes` | Integer | Graceful kill switch. Default: 5 minutes |

*Example Input:*
```json
{
    "companyUrl": "https://www.trustpilot.com/review/amazon.com",
    "maxItems": 500,
    "maxRunTimeMinutes": 15
}
```

## Output Example
```json
{
    "companyName": "Amazon",
    "companyUrl": "https://www.trustpilot.com/review/amazon.com",
    "reviewerName": "John Smith",
    "reviewerLocation": "United States",
    "rating": 4,
    "title": "Great selection but delivery was slow",
    "body": "I found exactly what I was looking for at a great price. The only issue was that delivery took longer than expected...",
    "date": "2026-07-01T00:00:00.000Z",
    "isVerified": true,
    "hasCompanyReply": false,
    "companyOverallRating": "3.8",
    "companyTotalReviews": "125,432",
    "sourceUrl": "https://www.trustpilot.com/review/amazon.com?page=1",
    "extractedAt": "2026-07-08T10:30:00.000Z"
}
```

## Pricing
This actor uses **Pay-Per-Result** pricing.
- **Price:** $0.002 per review (~$2 per 1,000 reviews)

## Graceful Kill Switch
Built-in safety mechanism prevents runaway costs. The scraper saves all collected data and shuts down cleanly when `maxRunTimeMinutes` is reached.
