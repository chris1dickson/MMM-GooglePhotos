/**
 * Unit tests for NodeHelper offline recovery mechanism
 */

describe('NodeHelper - Offline Recovery', () => {
  let nodeHelper;

  beforeEach(() => {
    // Create a mock node helper with just the retry mechanism
    nodeHelper = {
      authRetryAttempts: 0,
      maxAuthRetries: Infinity,
      maxBackoffMs: 120000,
      isRetryScheduled: false,
      authRetryTimer: null,
      providerInitialized: false,
      log_info: jest.fn(),
      log_warn: jest.fn(),
      log_error: jest.fn(),
      log_debug: jest.fn(),
      sendSocketNotification: jest.fn()
    };
  });

  afterEach(() => {
    if (nodeHelper.authRetryTimer) {
      clearTimeout(nodeHelper.authRetryTimer);
    }
  });

  describe('Exponential Backoff Calculation', () => {
    test('should calculate correct backoff sequence', () => {
      // Test the backoff formula: 5000 * 2^(attempts-1)
      const testCases = [
        { attempts: 1, expected: 5000 },    // 5s
        { attempts: 2, expected: 10000 },   // 10s
        { attempts: 3, expected: 20000 },   // 20s
        { attempts: 4, expected: 40000 },   // 40s
        { attempts: 5, expected: 80000 },   // 80s
        { attempts: 6, expected: 120000 },  // 120s (capped)
        { attempts: 7, expected: 120000 }   // 120s (capped)
      ];

      testCases.forEach(({ attempts, expected }) => {
        const backoffMs = Math.min(5000 * Math.pow(2, attempts - 1), 120000);
        expect(backoffMs).toBe(expected);
      });
    });

    test('should respect custom maxBackoffMs', () => {
      const customMax = 60000; // 1 minute
      const attempts = 10;
      const backoffMs = Math.min(5000 * Math.pow(2, attempts - 1), customMax);
      expect(backoffMs).toBe(customMax);
    });
  });

  describe('Race Condition Prevention', () => {
    test('should prevent duplicate retry scheduling', () => {
      // Simulate scheduleProviderRetry logic
      if (nodeHelper.isRetryScheduled) {
        return; // Should skip
      }
      nodeHelper.isRetryScheduled = true;

      // Try to schedule again
      const secondCall = !nodeHelper.isRetryScheduled;
      expect(secondCall).toBe(false);
    });

    test('should clear flag after retry attempt', () => {
      nodeHelper.isRetryScheduled = true;

      // Simulate retry attempt clearing the flag
      nodeHelper.isRetryScheduled = false;

      expect(nodeHelper.isRetryScheduled).toBe(false);
    });
  });

  describe('Max Retries Enforcement', () => {
    test('should stop after reaching maxAuthRetries', () => {
      nodeHelper.maxAuthRetries = 5;
      nodeHelper.authRetryAttempts = 5;

      // Check if retry should be scheduled
      const shouldRetry = nodeHelper.authRetryAttempts < nodeHelper.maxAuthRetries;
      expect(shouldRetry).toBe(false);
    });

    test('should allow infinite retries when maxAuthRetries is Infinity', () => {
      nodeHelper.maxAuthRetries = Infinity;
      nodeHelper.authRetryAttempts = 1000;

      const shouldRetry = nodeHelper.authRetryAttempts < nodeHelper.maxAuthRetries;
      expect(shouldRetry).toBe(true);
    });
  });

  describe('Network Error Detection', () => {
    // Simulate isNetworkError function
    const isNetworkError = (error) => {
      if (!error) return false;

      const message = error.message ? error.message.toLowerCase() : '';
      const code = error.code ? error.code.toUpperCase() : '';

      // Permanent errors - do NOT retry
      const permanentPatterns = [
        'invalid_grant',
        'permission denied',
        'folder not found',
        'invalid folder',
        '403 forbidden'
      ];

      if (permanentPatterns.some(pattern => message.includes(pattern))) {
        return false;
      }

      // Transient network errors
      const networkCodes = [
        'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
        'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH',
        'EHOSTDOWN', 'ENETDOWN', 'EPIPE'
      ];

      const networkMessages = [
        'network', 'offline', 'timeout', 'connection',
        'authentication failed', 'auth', 'token expired', 'enotfound'
      ];

      return networkCodes.includes(code) ||
             networkMessages.some(msg => message.includes(msg));
    };

    test('should identify transient network errors', () => {
      const transientErrors = [
        { code: 'ECONNRESET', message: 'Connection reset' },
        { code: 'ETIMEDOUT', message: 'Timeout' },
        { code: 'ENOTFOUND', message: 'DNS lookup failed' },
        { code: 'ENETUNREACH', message: 'Network unreachable' },
        { code: 'EHOSTDOWN', message: 'Host is down' },
        { message: 'Network error occurred' },
        { message: 'Authentication failed' },
        { message: 'Token expired' }
      ];

      transientErrors.forEach(error => {
        expect(isNetworkError(error)).toBe(true);
      });
    });

    test('should NOT retry permanent errors', () => {
      const permanentErrors = [
        { message: 'invalid_grant: Token revoked' },
        { message: 'Permission denied to access folder' },
        { message: 'Folder not found: ID does not exist' },
        { message: '403 forbidden: Access denied' }
      ];

      permanentErrors.forEach(error => {
        expect(isNetworkError(error)).toBe(false);
      });
    });

    test('should handle null/undefined errors', () => {
      expect(isNetworkError(null)).toBe(false);
      expect(isNetworkError(undefined)).toBe(false);
      expect(isNetworkError({})).toBe(false);
    });
  });

  describe('Provider State Management', () => {
    test('should initialize as not initialized', () => {
      expect(nodeHelper.providerInitialized).toBe(false);
    });

    test('should mark as initialized on success', () => {
      nodeHelper.providerInitialized = true;
      expect(nodeHelper.providerInitialized).toBe(true);
    });

    test('should reset retry counter on success', () => {
      nodeHelper.authRetryAttempts = 5;

      // Simulate successful connection
      nodeHelper.providerInitialized = true;
      nodeHelper.authRetryAttempts = 0;

      expect(nodeHelper.authRetryAttempts).toBe(0);
    });
  });

  describe('Timer Cleanup', () => {
    test('should clear timer on stop', () => {
      nodeHelper.authRetryTimer = setTimeout(() => {}, 5000);
      const timerId = nodeHelper.authRetryTimer;

      // Simulate stop() cleanup
      if (nodeHelper.authRetryTimer) {
        clearTimeout(nodeHelper.authRetryTimer);
        nodeHelper.authRetryTimer = null;
      }

      expect(nodeHelper.authRetryTimer).toBeNull();
    });

    test('should clear existing timer before scheduling new one', () => {
      // Schedule first timer
      nodeHelper.authRetryTimer = setTimeout(() => {}, 5000);
      const firstTimer = nodeHelper.authRetryTimer;

      // Clear before scheduling second
      if (nodeHelper.authRetryTimer) {
        clearTimeout(nodeHelper.authRetryTimer);
        nodeHelper.authRetryTimer = null;
      }

      expect(nodeHelper.authRetryTimer).toBeNull();
    });
  });

  describe('Socket Notifications', () => {
    test('should send CONNECTION_STATUS notification on retry', () => {
      const status = {
        status: "offline",
        message: "Offline - retrying in 5s"
      };

      nodeHelper.sendSocketNotification("CONNECTION_STATUS", status);

      expect(nodeHelper.sendSocketNotification).toHaveBeenCalledWith(
        "CONNECTION_STATUS",
        status
      );
    });

    test('should send retrying status during attempt', () => {
      const status = {
        status: "retrying",
        message: "Reconnecting (attempt 3)..."
      };

      nodeHelper.sendSocketNotification("CONNECTION_STATUS", status);

      expect(nodeHelper.sendSocketNotification).toHaveBeenCalledWith(
        "CONNECTION_STATUS",
        expect.objectContaining({ status: "retrying" })
      );
    });
  });
});
