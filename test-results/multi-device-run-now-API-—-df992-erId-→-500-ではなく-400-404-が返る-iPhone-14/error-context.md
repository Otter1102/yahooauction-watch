# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: multi-device.spec.ts >> run-now API — 500エラー検出 >> 無効userId → 500 ではなく 400/404 が返る
- Location: tests/e2e/multi-device.spec.ts:40:7

# Error details

```
TimeoutError: apiRequestContext.post: Timeout 15000ms exceeded.
Call log:
  - → POST https://yahooauction-watch-trial.vercel.app/api/run-now
    - user-agent: Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.4 Mobile/15E148 Safari/604.1
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - Content-Type: application/json
    - Origin: https://yahooauction-watch-trial.vercel.app
    - content-length: 51

```

```
Error: apiRequestContext._wrapApiCall: ENOENT: no such file or directory, open '/Users/sawadaakira/Library/Mobile Documents/com~apple~CloudDocs/Obsidian Vault/services/web-apps/ヤフオクwatch-app/test-results/.playwright-artifacts-15/traces/5b619a01be40fa46dfa7-81db73d89ff2cb7edaa0.trace'
```