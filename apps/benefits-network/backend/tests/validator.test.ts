import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../src/middleware/validator';

function request(body: unknown) {
  return { body } as Request;
}

function response() {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();
  return { res: { status, json } as unknown as Response, status, json };
}

describe('request validation', () => {
  it('returns 400 with issue paths for an invalid request without calling the handler', () => {
    const schema = z.object({ customer: z.object({ walletAddress: z.string() }) }).strict();
    const { res, status, json } = response();
    const next = jest.fn();

    validate(schema)(request({ customer: { walletAddress: 42 } }), res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: [{ path: 'customer.walletAddress', message: expect.any(String) }],
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes the parsed body to the handler for a valid request', () => {
    const schema = z.object({ name: z.string().trim().min(1) });
    const req = request({ name: ' Coffee ', ignored: true });
    const { res, status, json } = response();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(req.body).toEqual({ name: 'Coffee' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  it('forwards non-validation failures rather than turning them into client errors', () => {
    const failure = new Error('Unexpected transform failure');
    const schema = z.string().transform(() => { throw failure; });
    const { res, status, json } = response();
    const next = jest.fn();

    validate(schema)(request('Coffee'), res, next);

    expect(next).toHaveBeenCalledWith(failure);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });

  // GHSA-mrhx-c7xc-m3w5: four elements are enough to detect parsing before the size check.
  it.each([
    ['valid elements', ['a', 'b', 'c', 'd']],
    ['invalid elements', [null, {}, [], 42]],
  ])('rejects an oversized array of %s before processing its elements', (_label, items) => {
    const inspectElement = jest.fn((value: unknown) => value);
    const schema = z.object({ items: z.array(z.preprocess(inspectElement, z.string())).max(1) });
    const { res, status, json } = response();
    const next = jest.fn();

    validate(schema)(request({ items }), res, next);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: [{ path: 'items', message: expect.any(String) }],
    });
    expect(inspectElement).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('processes a legitimate array at its size limit exactly once', () => {
    const inspectElement = jest.fn((value: unknown) => value);
    const schema = z.object({ items: z.array(z.preprocess(inspectElement, z.string())).max(1) });
    const req = request({ items: ['Coffee'] });
    const { res, status, json } = response();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(inspectElement).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({ items: ['Coffee'] });
    expect(next).toHaveBeenCalledWith();
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
