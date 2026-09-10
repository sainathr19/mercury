import { errorFrom, statusLabel, SETTLED, type OrderStatus } from './flashnet';

describe('errorFrom', () => {
  it('reads Orchestra’s nested error shape', () => {
    // The real 400 body for an under-minimum amount.
    const e = errorFrom({ error: { code: 'amount_too_small', message: 'Amount too small' } }, 400);
    expect(e.message).toBe('Amount too small');
    expect(e.code).toBe('amount_too_small');
    expect(e.status).toBe(400);
  });

  it('never puts an object in the message', () => {
    // The bug this exists for: reading `body.error` straight into new Error()
    // rendered "[object Object]" on screen where the reason should have been.
    const e = errorFrom({ error: { detail: { nested: true } } }, 500);
    expect(e.message).toBe('Flashnet returned 500.');
    expect(e.message).not.toContain('object Object');
  });

  it('accepts a flat shape too', () => {
    expect(errorFrom({ message: 'Nope' }, 400).message).toBe('Nope');
    expect(errorFrom({ error: 'Nope' }, 400).message).toBe('Nope');
    expect(errorFrom({ detail: 'Nope' }, 400).message).toBe('Nope');
  });

  it('falls back on an empty, null or non-object body', () => {
    expect(errorFrom({}, 502).message).toBe('Flashnet returned 502.');
    expect(errorFrom(null, 502).message).toBe('Flashnet returned 502.');
    expect(errorFrom('boom', 502).message).toBe('Flashnet returned 502.');
  });

  it('ignores a blank message rather than showing an empty error', () => {
    expect(errorFrom({ error: { message: '   ' } }, 400).message).toBe('Flashnet returned 400.');
  });
});

describe('order status', () => {
  it('labels every status the API can return', () => {
    const all: OrderStatus[] = [
      'processing', 'confirming', 'bridging', 'swapping', 'awaiting_approval',
      'refunding', 'delivering', 'completed', 'failed', 'expired', 'unfulfilled', 'refunded',
    ];
    for (const s of all) {
      expect(statusLabel(s)).toBeTruthy();
      // Raw enum values must never reach a screen.
      expect(statusLabel(s)).not.toContain('_');
    }
  });

  it('treats exactly the terminal states as settled', () => {
    expect([...SETTLED].sort()).toEqual(
      ['completed', 'expired', 'failed', 'refunded', 'unfulfilled'].sort(),
    );
    // Polling must continue through these, or a swap stops updating mid-flight.
    for (const s of ['processing', 'bridging', 'swapping', 'delivering'] as OrderStatus[]) {
      expect(SETTLED.has(s)).toBe(false);
    }
  });
});
