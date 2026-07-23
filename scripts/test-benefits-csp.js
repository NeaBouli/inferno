#!/usr/bin/env node

const { chromium, devices } = require('playwright');

const BASE_URL = process.env.BENEFITS_BASE_URL || 'http://127.0.0.1:3000';
const ROUTES = [
  '/',
  '/?mode=seller',
  '/guide',
  '/scan',
  '/b/csp-compatibility-check',
  '/s/csp-compatibility-check',
  '/r/csp-compatibility-check',
  '/p/csp-compatibility-check',
];

const DEVICES = [
  {
    name: 'desktop 1440x1000',
    use: {
      viewport: { width: 1440, height: 1000 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    },
  },
  {
    name: 'iPad Pro 11',
    use: devices['iPad Pro 11'].viewport
      ? {
          ...devices['iPad Pro 11'],
          userAgent: devices['iPad Pro 11'].userAgent,
          viewport: devices['iPad Pro 11'].viewport,
        }
      : devices['iPad Pro 11'],
  },
  {
    name: 'Galaxy S9+',
    use: devices['Galaxy S9+'].viewport
      ? {
          ...devices['Galaxy S9+'],
          userAgent: devices['Galaxy S9+'].userAgent,
          viewport: devices['Galaxy S9+'].viewport,
        }
      : devices['Galaxy S9+'],
  },
];

const REQUIRED_CSP_DIRECTIVES = {
  'base-uri': "'self'",
  'object-src': "'none'",
  'frame-ancestors': "'none'",
  'form-action': "'self'",
};

const REQUIRED_REPORT_ONLY_DIRECTIVES = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self'",
  'img-src': "'self'",
  'connect-src': "'self'",
  'worker-src': "'self'",
  'frame-src': "'self'",
  'manifest-src': "'self'",
};

const FORBIDDEN_PATTERNS = [
  /unsafe-eval/i,
  /\breport-uri\b/i,
  /\breport-to\b/i,
  /\*|\b\*\b/, // wildcard
  /(^|[\s;])http:/i,
  /(^|[\s;])ws:/i,
];

function normalizeHeaderMap(response) {
  const rawHeaders = response.headers();
  const lower = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    lower[key.toLowerCase()] = value || '';
  }
  return lower;
}

function parseDirectiveMap(cspHeader) {
  const result = {};
  if (!cspHeader) {
    return result;
  }

  const parts = cspHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const directive = tokens.shift()?.toLowerCase();
    if (!directive) {
      continue;
    }
    result[directive] = tokens;
  }

  return result;
}

function includesSelf(values) {
  return values.includes("'self'") || values.includes('self') || values.includes('"self"');
}

function includesNone(values) {
  return values.includes("'none'") || values.includes('none') || values.includes('"none"');
}

function addFailure(failures, deviceName, route, category, detail) {
  failures.push({
    device: deviceName,
    route,
    category,
    detail,
  });
}

function assertCspDirectives({ failures, deviceName, route, headerValue, requiredMap, headerName }) {
  const directives = parseDirectiveMap(headerValue || '');

  for (const [name, requiredValue] of Object.entries(requiredMap)) {
    const values = directives[name] || [];
    if (values.length === 0) {
      addFailure(
        failures,
        deviceName,
        route,
        `${headerName}:missing-directive`,
        `${headerName} header missing required directive "${name}".`,
      );
      continue;
    }

    if (requiredValue === "'self'") {
      if (!includesSelf(values)) {
        addFailure(
          failures,
          deviceName,
          route,
          `${headerName}:directive-value`,
          `${headerName} ${name} is missing ${requiredValue}: "${values.join(' ')}".`,
        );
      }
      continue;
    }

    if (requiredValue === "'none'") {
      if (values.length !== 1 || !includesNone(values)) {
        addFailure(
          failures,
          deviceName,
          route,
          `${headerName}:directive-value`,
          `${headerName} ${name} must contain only ${requiredValue}: "${values.join(' ')}".`,
        );
      }
    }
  }
}

function assertForbiddenTokens({ failures, deviceName, route, headerName, headerValue }) {
  const headerLower = (headerValue || '').toLowerCase();

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(headerLower)) {
      addFailure(
        failures,
        deviceName,
        route,
        `${headerName}:forbidden-token`,
        `${headerName} contains forbidden token matching ${pattern}: "${headerValue}".`,
      );
      break;
    }
  }
}

function isCspRefusalConsoleMessage(text) {
  const value = (text || '').toLowerCase();
  return value.includes('content security policy') || value.includes('csp');
}

function verifyGateGuardrails() {
  for (const insecurePolicy of [
    "connect-src 'self' http://insecure.example",
    "connect-src 'self' ws://insecure.example",
  ]) {
    if (!FORBIDDEN_PATTERNS.some((pattern) => pattern.test(insecurePolicy))) {
      throw new Error(`CSP gate does not reject insecure test policy: ${insecurePolicy}`);
    }
  }

  const failures = [];
  assertCspDirectives({
    failures,
    deviceName: 'guardrail',
    route: 'guardrail',
    headerValue: "object-src 'none' https:",
    requiredMap: { 'object-src': "'none'" },
    headerName: 'Content-Security-Policy',
  });
  if (failures.length !== 1) {
    throw new Error("CSP gate must reject a 'none' directive combined with another source.");
  }
}

async function runRoute({ page, deviceName, route, failures, baseUrl }) {
  const targetUrl = new URL(route, baseUrl).toString();
  const routeLabel = route;

  const consoleEvents = [];
  const onConsole = (message) => {
    const text = message.text();
    if (message.type() === 'error' && isCspRefusalConsoleMessage(text)) {
      consoleEvents.push({
        type: message.type(),
        text,
      });
    }
  };

  page.on('console', onConsole);

  try {
    const response = await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    if (!response) {
      addFailure(failures, deviceName, routeLabel, 'navigation:no-response', `No response for ${routeLabel}.`);
      return;
    }

    if (response.status() >= 400) {
      addFailure(
        failures,
        deviceName,
        routeLabel,
        'navigation:status',
        `Navigation status ${response.status()} for ${routeLabel} is not below 400.`,
      );
    }

    const headers = normalizeHeaderMap(response);
    const csp = headers['content-security-policy'] || '';
    const cspRo = headers['content-security-policy-report-only'] || '';

    if (!csp) {
      addFailure(failures, deviceName, routeLabel, 'header:missing', 'Missing Content-Security-Policy header.');
    }

    if (!cspRo) {
      addFailure(
        failures,
        deviceName,
        routeLabel,
        'header:missing',
        'Missing Content-Security-Policy-Report-Only header.',
      );
    }

    if (csp) {
      assertCspDirectives({
        failures,
        deviceName,
        route: routeLabel,
        headerValue: csp,
        requiredMap: REQUIRED_CSP_DIRECTIVES,
        headerName: 'Content-Security-Policy',
      });
      assertForbiddenTokens({
        failures,
        deviceName,
        route: routeLabel,
        headerName: 'Content-Security-Policy',
        headerValue: csp,
      });
    }

    if (cspRo) {
      assertCspDirectives({
        failures,
        deviceName,
        route: routeLabel,
        headerValue: cspRo,
        requiredMap: REQUIRED_REPORT_ONLY_DIRECTIVES,
        headerName: 'Content-Security-Policy-Report-Only',
      });
      assertForbiddenTokens({
        failures,
        deviceName,
        route: routeLabel,
        headerName: 'Content-Security-Policy-Report-Only',
        headerValue: cspRo,
      });
    }

    if (route === '/') {
      const manifestResult = await page.evaluate(async () => {
        try {
          const response = await fetch('/manifest.json');
          return {
            status: response.status,
            ok: response.ok,
            contentType: response.headers.get('content-type') || '',
          };
        } catch (error) {
          return {
            error: String(error),
          };
        }
      });

      if (!manifestResult.ok) {
        addFailure(
          failures,
          deviceName,
          routeLabel,
          'pwa:manifest',
          `Failed to fetch /manifest.json: ${JSON.stringify(manifestResult)}.`,
        );
      }

      const swResult = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) {
          return {
            supported: false,
          };
        }

        try {
          const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
          const ready = await navigator.serviceWorker.ready;
          return {
            supported: true,
            scriptURL: ready?.active?.scriptURL || ready?.installing?.scriptURL || '',
            scope: registration.scope,
            state: ready?.active?.state || ready?.installing?.state || 'unknown',
          };
        } catch (error) {
          return {
            supported: true,
            error: String(error),
          };
        }
      });

      if (swResult.error) {
        addFailure(
          failures,
          deviceName,
          routeLabel,
          'pwa:sw-register',
          `Service Worker register/ready failed: ${JSON.stringify(swResult)}.`,
        );
      }
    }

    await page.waitForLoadState('load', { timeout: 60000 });
    await page.waitForTimeout(1000);

    const navViolations = await page.evaluate(() => window.__cspViolations || []);

    if (navViolations.length > 0) {
      addFailure(
        failures,
        deviceName,
        routeLabel,
        'csp-violation',
        `securitypolicyviolation events: ${JSON.stringify(navViolations)}`,
      );
    }

    if (consoleEvents.length > 0) {
      addFailure(
        failures,
        deviceName,
        routeLabel,
        'console:csp-refusal',
        `console CSP refusals: ${JSON.stringify(consoleEvents)}`,
      );
    }
  } finally {
    page.off('console', onConsole);
  }
}

(async () => {
  verifyGateGuardrails();
  const failures = [];

  const browser = await chromium.launch({ headless: true });

  try {
    for (const device of DEVICES) {
      for (const route of ROUTES) {
        const context = await browser.newContext({
          viewport: device.use.viewport || undefined,
          userAgent: device.use.userAgent,
          isMobile: !!device.use.isMobile,
          hasTouch: !!device.use.hasTouch,
          deviceScaleFactor: device.use.deviceScaleFactor,
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
          window.__cspViolations = [];
          document.addEventListener('securitypolicyviolation', (event) => {
            window.__cspViolations.push({
              disposition: event.disposition,
              effectiveDirective: event.effectiveDirective,
              blockedURI: event.blockedURI,
              sourceFile: event.sourceFile,
              lineNumber: event.lineNumber,
            });
          });
        });

        try {
          await runRoute({
            page,
            deviceName: device.name,
            route,
            failures,
            baseUrl: BASE_URL,
          });
        } finally {
          await page.close();
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    const grouped = failures.map((failure) =>
      `[${failure.device}] route=${failure.route} category=${failure.category} detail=${failure.detail}`,
    );

    console.error('CSP compatibility gate failed:\n' + grouped.join('\n'));
    process.exitCode = 1;
    return;
  }

  console.log('CSP compatibility gate passed.');
})();
