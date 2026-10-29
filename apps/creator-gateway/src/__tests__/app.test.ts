import { expect, test, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';

vi.mock('../config', () => ({ CONFIG: {
  isProduction: true, allowedOrigins: ['https://client.example.invalid'],
} }));
vi.mock('../routes/auth', async () => ({ default: (await import('express')).Router() }));
vi.mock('../routes/access', async () => ({ default: (await import('express')).Router() }));

test('health is minimal, uncached, and still works after the public budget is exhausted', async () => {
  for (let i = 0; i < 60; i++) await request(app).get('/not-found');
  expect((await request(app).get('/not-found')).status).toBe(429);
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['x-powered-by']).toBeUndefined();
});

test('only configured origins receive CORS permission behind the single proxy hop', async () => {
  expect(app.get('trust proxy')).toBe(1);
  const allowed = await request(app).get('/health').set('Origin', 'https://client.example.invalid');
  expect(allowed.headers['access-control-allow-origin']).toBe('https://client.example.invalid');
  const foreign = await request(app).get('/health').set('Origin', 'https://foreign.example.invalid');
  expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
});
