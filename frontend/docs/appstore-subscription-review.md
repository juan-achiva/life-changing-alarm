# App Store Subscription Review Notes

## In-App Review Check

Use the in-app community expansion modal screen.

Recommended capture flow:

1. Open the app.
2. Go to `공동체`.
3. Tap `8명 이상 함께하기`.
4. Capture the modal showing all of the following:
   - Service title: `오늘은혜 공동체 확장 플랜`
   - Subscription length
   - Subscription price
   - Terms of Use link
   - Privacy Policy link
   - Purchase / Restore buttons

Do not use a screenshot that includes a RevenueCat error dialog.

## Review Notes (English)

```text
The subscription can be accessed from the Community tab.
Tap "8명 이상 함께하기" to open the community expansion subscription sheet.

The purchase flow now includes:
- subscription title
- subscription length
- subscription price
- Terms of Use link
- Privacy Policy link

This subscription expands the community size from 7 members to up to 20 members during the active subscription period.
```

## Suggested Reply To App Review (English)

```text
Thank you for the review.

We have updated the app and metadata to address the reported issues.

For Guideline 3.1.2(c):
- The subscription screen now shows the subscription title, subscription length, subscription price, and the service description.
- Functional links to the Terms of Use and Privacy Policy are now included directly in the in-app purchase flow.
- We also updated the App Store metadata to include the required Terms of Use / EULA and Privacy Policy links.

For Guideline 2.1(b):
- We improved the subscription-loading logic so the app can resolve the purchasable package more reliably during App Review sandbox testing.

For Guideline 4.3(a):
- We reviewed storefront availability and will ensure this app does not overlap in storefront availability with our other similar submission.

We are including a screen recording in the App Review Notes showing the updated subscription flow.
```

## Metadata Copy

- Subscription display name: `공동체 확장 플랜 월간`
- Description: `8명 이상 함께 기록할 수 있는 공동체 확장 구독`
- Product ID: `todaygrace_monthly`
- Privacy Policy field: add your live privacy-policy URL
- EULA / Terms of Use:
  - If using a custom terms page, add that link in App Store Connect
  - If using Apple Standard EULA, add `https://www.apple.com/legal/internet-services/itunes/dev/stdeula/` to the app description or EULA field

## Duplicate App Checklist

- Do not keep overlapping storefronts with the other similar app.
- In App Store Connect, open `Pricing and Availability` for one of the apps and restrict countries/regions so the storefronts do not overlap.
- If only one app should remain public, remove storefront availability from the duplicate app instead of shipping both to the same regions.
