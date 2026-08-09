# Contributing

Thanks for helping make streaming tools more open and humane.

## Before opening a change

For a bug, search existing issues and include the OBS version/platform,
OpenStreamAlert commit, expected behavior, actual behavior, and reproducible
steps. Use a private security advisory for vulnerabilities.

For a feature, explain the streamer problem before proposing controls or an
integration. Version one intentionally protects a small “connect, style, copy”
workflow; additions should earn their complexity.

## Local workflow

```bash
npm ci
cp .env.example .env  # optional for demo UI work
npm run dev
```

Before submitting:

```bash
npm run format:check
npm run lint
npm run check
npm test
npm run build
npm run test:e2e
```

Install Chromium once with `npx playwright install chromium`. Twitch behavior
changes should include fixture-based unit coverage and be checked against
official current documentation. Visual changes should be tested at 320, 500,
and 1920 px widths, with reduced motion, and in OBS 31+ when possible.

Keep commits focused and explain trust-boundary changes in the pull request.
Never include real Twitch credentials, overlay URLs, `.env`, or database files.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
